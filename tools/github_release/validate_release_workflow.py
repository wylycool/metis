import json
import re
import tomllib
from pathlib import Path

import yaml


CONFIG = {
    "expected_version": "1.5.0",
    "workflow": Path(".github/workflows/desktop-preview.yml"),
    "release_notes": Path("docs/release-notes/desktop.md"),
    "release_checklist": Path("docs/release-checklist.md"),
    "cargo_manifest": Path("Cargo.toml"),
    "cargo_lock": Path("Cargo.lock"),
    "desktop_package": Path("apps/desktop/package.json"),
    "tauri_config": Path("apps/desktop/src-tauri/tauri.conf.json"),
}

SEMVER_PATTERN = re.compile(
    r"(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
)


def is_prerelease(version: str) -> bool:
    match = SEMVER_PATTERN.fullmatch(version)
    if match is None:
        raise ValueError(f"invalid SemVer: {version}")
    return match.group(4) is not None


def workspace_versions() -> dict[str, str]:
    cargo_manifest = tomllib.loads(CONFIG["cargo_manifest"].read_text())
    cargo_lock = tomllib.loads(CONFIG["cargo_lock"].read_text())
    desktop_package = json.loads(CONFIG["desktop_package"].read_text())
    tauri_config = json.loads(CONFIG["tauri_config"].read_text())
    metis_packages = {
        package["name"]: package["version"]
        for package in cargo_lock["package"]
        if package["name"]
        in {
            "metis-adapters",
            "metis-core",
            "metis-desktop",
            "metis-git-provider",
            "metis-security",
            "metis-storage",
        }
    }

    return {
        "workspace": cargo_manifest["workspace"]["package"]["version"],
        "desktop_package": desktop_package["version"],
        "tauri": tauri_config["version"],
        **metis_packages,
    }


def main() -> None:
    expected_version = CONFIG["expected_version"]
    workflow_text = CONFIG["workflow"].read_text()
    workflow = yaml.safe_load(workflow_text)
    jobs = workflow["jobs"]
    validate = jobs["validate"]
    build = jobs["build"]
    release = jobs["release"]
    release_script = next(
        step["run"]
        for step in release["steps"]
        if step["name"] == "Create or update GitHub Release"
    )

    assert workflow["name"] == "Desktop Release Packages"
    assert validate["name"] == "Validate desktop release version"
    assert build["needs"] == "validate"
    assert set(release["needs"]) == {"validate", "build"}

    assert "refs/tags/desktop-v" in release["if"]
    assert "actions/download-artifact@v4" in workflow_text
    assert "SHA256SUMS" in workflow_text
    assert '"Metis_${release_version}_universal.dmg"' in workflow_text
    assert '"Metis_${release_version}_x64-setup.exe"' in workflow_text
    assert '"Metis_${release_version}_amd64.deb"' in workflow_text
    assert '"Metis_${release_version}_amd64.AppImage"' in workflow_text
    assert "Missing required release asset" in workflow_text
    assert "Upload desktop package" in workflow_text
    assert "Download desktop packages" in workflow_text
    assert "preview bundle" not in workflow_text.lower()
    assert 'release_version="${GITHUB_REF_NAME#desktop-v}"' in workflow_text
    assert "re.fullmatch(" in workflow_text
    assert "Desktop version is not valid SemVer" in workflow_text
    assert "does not match package version" in workflow_text

    assert "gh release create" in release_script
    assert "gh release edit" in release_script
    assert "gh release upload" in release_script
    assert "--prerelease=false" in release_script
    assert "--prerelease" in release_script
    assert "--latest=false" in release_script
    assert "--latest" in release_script
    assert "--draft=false" in release_script
    assert "--notes-file docs/release-notes/desktop.md" in release_script
    assert '--title "Metis ${release_version}"' in release_script
    assert 'version_without_build="${release_version%%+*}"' in release_script
    assert '[[ "$version_without_build" == *-* ]]' in release_script

    assert is_prerelease("1.5.0") is False
    assert is_prerelease("1.5.0-beta.1") is True
    assert is_prerelease("1.5.0-rc.1") is True
    try:
        is_prerelease("1.5")
    except ValueError:
        pass
    else:
        raise AssertionError("malformed release versions must be rejected")

    assert CONFIG["release_notes"].is_file()
    assert CONFIG["release_checklist"].is_file()
    assert "Beta" not in CONFIG["release_notes"].read_text()
    assert not Path("docs/release-notes/desktop-beta.md").exists()
    assert not Path("docs/beta-release-checklist.md").exists()

    versions = workspace_versions()
    assert versions.keys() >= {
        "workspace",
        "desktop_package",
        "tauri",
        "metis-adapters",
        "metis-core",
        "metis-desktop",
        "metis-git-provider",
        "metis-security",
        "metis-storage",
    }
    assert set(versions.values()) == {expected_version}, versions


if __name__ == "__main__":
    main()
