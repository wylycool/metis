import importlib.util
import json
import re
import sys
import tempfile
import tomllib
from pathlib import Path

import yaml

sys.dont_write_bytecode = True


CONFIG = {
    "expected_version": "1.5.0",
    "workflow": Path(".github/workflows/desktop-preview.yml"),
    "release_notes": Path("docs/release-notes/desktop.md"),
    "cargo_manifest": Path("Cargo.toml"),
    "cargo_lock": Path("Cargo.lock"),
    "desktop_package": Path("apps/desktop/package.json"),
    "desktop_manifest": Path("apps/desktop/src-tauri/Cargo.toml"),
    "tauri_config": Path("apps/desktop/src-tauri/tauri.conf.json"),
    "latest_json_generator": Path("tools/software_update/generate_latest_json.py"),
    "signature_key_validator": Path("tools/software_update/validate_signature_key.py"),
}

SEMVER_PATTERN = re.compile(
    r"(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
)


def load_latest_manifest_builder():
    module_path = CONFIG["latest_json_generator"]
    spec = importlib.util.spec_from_file_location("metis_generate_latest_json", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load latest.json generator: {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.build_latest_manifest


def is_prerelease(version: str) -> bool:
    match = SEMVER_PATTERN.fullmatch(version)
    if match is None:
        raise ValueError(f"invalid SemVer: {version}")
    return match.group(4) is not None


def stable_release_can_be_latest(current_version: str, latest_version: str) -> bool:
    def core(version: str) -> tuple[int, int, int]:
        match = SEMVER_PATTERN.fullmatch(version)
        if match is None or match.group(4) is not None:
            raise ValueError(f"expected stable SemVer: {version}")
        return tuple(int(match.group(index)) for index in range(1, 4))

    return core(current_version) >= core(latest_version)


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
    tauri_config = json.loads(CONFIG["tauri_config"].read_text())
    desktop_manifest = tomllib.loads(CONFIG["desktop_manifest"].read_text())
    jobs = workflow["jobs"]
    validate = jobs["validate"]
    build = jobs["build"]
    release = jobs["release"]
    release_script = next(
        step["run"]
        for step in release["steps"]
        if step["name"] == "Create or update GitHub Release"
    )
    latest_upload_script = next(
        step["run"]
        for step in release["steps"]
        if step["name"] == "Upload latest updater manifest"
    )
    finalize_script = next(
        step["run"]
        for step in release["steps"]
        if step["name"] == "Finalize GitHub Release"
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
    assert "Sign updater package" in workflow_text
    assert "TAURI_SIGNING_PRIVATE_KEY" in workflow_text
    assert "TAURI_SIGNING_PRIVATE_KEY_PASSWORD" in workflow_text
    assert "pnpm --dir apps/desktop tauri signer sign" in workflow_text
    assert "tools/software_update/validate_signature_key.py" in workflow_text
    assert "ci_updater_signatures_verify_against_configured_public_key" in workflow_text
    assert '"Metis_${release_version}_universal.dmg.sig"' in workflow_text
    assert '"Metis_${release_version}_x64-setup.exe.sig"' in workflow_text
    assert '"Metis_${release_version}_amd64.AppImage.sig"' in workflow_text
    assert "tools/software_update/generate_latest_json.py" in workflow_text
    assert "latest.json" in workflow_text
    assert "Upload latest updater manifest" in workflow_text
    assert "preview bundle" not in workflow_text.lower()
    assert 'release_version="${GITHUB_REF_NAME#desktop-v}"' in workflow_text
    assert "re.fullmatch(" in workflow_text
    assert "Desktop version is not valid SemVer" in workflow_text
    assert "does not match package version" in workflow_text

    assert "gh release create" in release_script
    assert "gh release upload" in release_script
    assert "--notes-file docs/release-notes/desktop.md" in release_script
    assert '--title "Metis ${release_version}"' in release_script
    assert "--draft" in release_script
    assert 'gh release edit "$GITHUB_REF_NAME" --draft=true' in release_script
    assert "release-assets/latest.json" not in release_script

    assert "gh release upload" in latest_upload_script
    assert "release-assets/latest.json" in latest_upload_script

    assert "gh release edit" in finalize_script
    assert "--prerelease=false" in finalize_script
    assert "--prerelease" in finalize_script
    assert "--latest=false" in finalize_script
    assert "--latest" in finalize_script
    assert "--draft=false" in finalize_script
    assert "--notes-file docs/release-notes/desktop.md" in finalize_script
    assert '--title "Metis ${release_version}"' in finalize_script
    assert 'version_without_build="${release_version%%+*}"' in finalize_script
    assert '[[ "$version_without_build" == *-* ]]' in finalize_script
    assert "repos/${GITHUB_REPOSITORY}/releases/latest" in finalize_script
    assert 'latest_version="${latest_tag#desktop-v}"' in finalize_script
    assert "current_core >= latest_core" in finalize_script

    updater = tauri_config["plugins"]["updater"]
    assert updater["endpoints"] == [
        "https://github.com/wylycool/metis/releases/latest/download/latest.json"
    ]
    assert len(updater["pubkey"]) > 80
    assert "createUpdaterArtifacts" not in tauri_config["bundle"]
    assert desktop_manifest["dependencies"]["tauri-plugin-updater"] == "2.10.1"
    assert desktop_manifest["dependencies"]["tauri-plugin-opener"] == "2.5.4"

    assert CONFIG["latest_json_generator"].is_file()
    generator_text = CONFIG["latest_json_generator"].read_text()
    assert '"darwin-aarch64"' in generator_text
    assert '"darwin-x86_64"' in generator_text
    assert '"windows-x86_64"' in generator_text
    assert '"linux-x86_64"' in generator_text
    assert '"signature"' in generator_text
    assert CONFIG["signature_key_validator"].is_file()
    signature_validator_text = CONFIG["signature_key_validator"].read_text()
    assert "plugins" in signature_validator_text
    assert "updater" in signature_validator_text
    assert "pubkey" in signature_validator_text
    assert "signature key does not match" in signature_validator_text

    with tempfile.TemporaryDirectory(prefix="metis-latest-json-") as temp_dir:
        temp_root = Path(temp_dir)
        assets = temp_root / "release-assets"
        assets.mkdir()
        package = temp_root / "package.json"
        notes = temp_root / "release-notes.md"
        package.write_text(json.dumps({"version": "1.5.1"}))
        notes.write_text("Metis updater test notes\n")
        for asset_name, signature in {
            "Metis_1.5.1_universal.dmg.sig": "mac-signature",
            "Metis_1.5.1_x64-setup.exe.sig": "windows-signature",
            "Metis_1.5.1_amd64.AppImage.sig": "linux-signature",
        }.items():
            (assets / asset_name).write_text(signature)
        latest = load_latest_manifest_builder()(
            {
                "desktop_package": package,
                "release_assets": assets,
                "release_notes": notes,
                "repository": "wylycool/metis",
            }
        )
        platforms = latest["platforms"]
        assert latest["version"] == "1.5.1"
        assert platforms["darwin-aarch64"] == platforms["darwin-x86_64"]
        assert platforms["darwin-aarch64"]["signature"] == "mac-signature"
        assert platforms["windows-x86_64"]["signature"] == "windows-signature"
        assert platforms["linux-x86_64"]["signature"] == "linux-signature"
        assert platforms["darwin-aarch64"]["url"].endswith(
            "/desktop-v1.5.1/Metis_1.5.1_universal.dmg"
        )

        package.write_text(json.dumps({"version": "1.5.1+build.1"}))
        for asset_name, signature in {
            "Metis_1.5.1+build.1_universal.dmg.sig": "mac-build-signature",
            "Metis_1.5.1+build.1_x64-setup.exe.sig": "windows-build-signature",
            "Metis_1.5.1+build.1_amd64.AppImage.sig": "linux-build-signature",
        }.items():
            (assets / asset_name).write_text(signature)
        build_metadata_latest = load_latest_manifest_builder()(
            {
                "desktop_package": package,
                "release_assets": assets,
                "release_notes": notes,
                "repository": "wylycool/metis",
            }
        )
        build_metadata_url = build_metadata_latest["platforms"]["darwin-aarch64"]["url"]
        assert "+build.1" in build_metadata_url
        assert "%2B" not in build_metadata_url

    assert is_prerelease("1.5.0") is False
    assert is_prerelease("1.5.0-beta.1") is True
    assert is_prerelease("1.5.0-rc.1") is True
    try:
        is_prerelease("1.5")
    except ValueError:
        pass
    else:
        raise AssertionError("malformed release versions must be rejected")
    assert stable_release_can_be_latest("1.5.1", "1.5.0") is True
    assert stable_release_can_be_latest("1.5.1+build.2", "1.5.1+build.1") is True
    assert stable_release_can_be_latest("1.5.0", "1.5.1") is False

    assert CONFIG["release_notes"].is_file()
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
