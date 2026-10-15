import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib

sys.dont_write_bytecode = True


CONFIG = {
    "expected_version": "1.5.0",
    "ci_workflow": Path(".github/workflows/ci.yml"),
    "workflow": Path(".github/workflows/desktop-preview.yml"),
    "release_notes": Path("docs/release-notes/desktop.md"),
    "cargo_manifest": Path("Cargo.toml"),
    "cargo_lock": Path("Cargo.lock"),
    "desktop_package": Path("apps/desktop/package.json"),
    "nvmrc": Path(".nvmrc"),
    "desktop_manifest": Path("apps/desktop/src-tauri/Cargo.toml"),
    "tauri_config": Path("apps/desktop/src-tauri/tauri.conf.json"),
    "latest_json_generator": Path("tools/software_update/generate_latest_json.py"),
    "signature_key_validator": Path("tools/software_update/validate_signature_key.py"),
}

ACTION_PINS = {
    "actions/checkout": ("9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0", "v7.0.0"),
    "dtolnay/rust-toolchain": ("4cda84d5c5c54efe2404f9d843567869ab1699d4", "stable"),
    "pnpm/action-setup": ("0ebf47130e4866e96fce0953f49152a61190b271", "v6.0.9"),
    "actions/setup-node": ("820762786026740c76f36085b0efc47a31fe5020", "v7.0.0"),
    "actions/upload-artifact": ("043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", "v7.0.1"),
    "actions/download-artifact": ("3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c", "v8.0.1"),
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


def validate_action_pins(
    workflow_text: str,
    expected_actions: set[str] | None = None,
) -> None:
    uses_lines = re.findall(r"(?m)^\s*uses:\s*([^\s#]+)(?:\s+#\s*(\S+))?\s*$", workflow_text)
    assert uses_lines, "release workflow must use pinned Actions"

    observed_actions: set[str] = set()
    for action_ref, version_comment in uses_lines:
        action, separator, commit_sha = action_ref.partition("@")
        assert separator == "@", f"Action reference is missing @: {action_ref}"
        assert action in ACTION_PINS, f"unexpected Action reference: {action}"
        expected_sha, expected_comment = ACTION_PINS[action]
        assert re.fullmatch(r"[0-9a-f]{40}", commit_sha), (
            f"Action must use a full commit SHA: {action_ref}"
        )
        assert commit_sha == expected_sha, f"unexpected commit SHA for {action}: {commit_sha}"
        assert version_comment == expected_comment, (
            f"Action pin must retain the {expected_comment} version comment: {action_ref}"
        )
        observed_actions.add(action)

    if expected_actions is None:
        expected_actions = set(ACTION_PINS)
    assert observed_actions == expected_actions, observed_actions


def main() -> None:
    expected_version = CONFIG["expected_version"]
    ci_workflow_text = CONFIG["ci_workflow"].read_text()
    ci_workflow = yaml.safe_load(ci_workflow_text)
    workflow_text = CONFIG["workflow"].read_text()
    workflow = yaml.safe_load(workflow_text)
    triggers = workflow.get("on", workflow.get(True))
    signed_rehearsal = triggers["workflow_dispatch"]["inputs"]["signed_rehearsal"]
    assert signed_rehearsal["type"] == "boolean"
    assert signed_rehearsal["default"] is False
    assert "rehearsal" in workflow["jobs"]
    tauri_config = json.loads(CONFIG["tauri_config"].read_text())
    desktop_package = json.loads(CONFIG["desktop_package"].read_text())
    desktop_manifest = tomllib.loads(CONFIG["desktop_manifest"].read_text())
    jobs = workflow["jobs"]
    validate = jobs["validate"]
    build = jobs["build"]
    release = jobs["release"]
    rehearsal = jobs["rehearsal"]
    sign_step = next(
        step for step in build["steps"] if step["name"] == "Sign updater package"
    )
    upload_step = next(
        step for step in build["steps"] if step["name"] == "Upload desktop package"
    )
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

    assert ci_workflow["name"] == "CI"
    assert ci_workflow["permissions"] == {"contents": "read"}
    assert set(ci_workflow["jobs"]) == {"rust", "windows-rust", "desktop"}
    windows_rust = ci_workflow["jobs"]["windows-rust"]
    assert windows_rust["name"] == "Windows Rust tests"
    assert windows_rust["runs-on"] == "windows-latest"
    assert windows_rust["timeout-minutes"] == 20
    assert [step["name"] for step in windows_rust["steps"]] == [
        "Checkout",
        "Setup Rust",
        "Run Windows Rust tests",
    ]
    assert windows_rust["steps"][-1]["run"] == "cargo test -p metis-desktop"
    assert re.search(r"(?m)^  pull_request:\s*$", ci_workflow_text)
    assert re.search(r"(?m)^  push:\s*$", ci_workflow_text)
    assert "branches: [main]" in ci_workflow_text
    assert "pull_request_target" not in ci_workflow_text
    assert "workflow_dispatch" not in ci_workflow_text
    assert "contents: write" not in ci_workflow_text
    assert "secrets." not in ci_workflow_text
    assert "upload-artifact" not in ci_workflow_text
    assert "cargo fmt --check" in ci_workflow_text
    assert "cargo test" in ci_workflow_text
    assert "cargo clippy --all-targets --all-features" in ci_workflow_text
    assert "pnpm test:e2e" in ci_workflow_text
    assert "pnpm build" in ci_workflow_text
    assert "tools/github_release/validate_release_workflow.py" in ci_workflow_text
    assert CONFIG["nvmrc"].read_text().strip() == "24"
    assert desktop_package["packageManager"] == "pnpm@10.34.5"
    assert desktop_package["engines"] == {
        "node": ">=24 <25",
        "pnpm": "10.34.5",
    }
    assert ci_workflow_text.count("node-version: 24") == 1
    assert ci_workflow_text.count("version: 10.34.5") == 1
    assert "node-version: 22" not in ci_workflow_text
    validate_action_pins(
        ci_workflow_text,
        {
            "actions/checkout",
            "dtolnay/rust-toolchain",
            "pnpm/action-setup",
            "actions/setup-node",
        },
    )

    assert workflow["name"] == "Desktop Release Packages"
    assert workflow["permissions"] == {"contents": "read"}
    assert validate["name"] == "Validate desktop release version"
    assert build["needs"] == "validate"
    assert set(release["needs"]) == {"validate", "build"}

    release_condition = (
        "github.event_name == 'push' && "
        "startsWith(github.ref, 'refs/tags/desktop-v')"
    )
    rehearsal_condition = (
        "github.event_name == 'workflow_dispatch' && inputs.signed_rehearsal && "
        "github.ref == 'refs/heads/main'"
    )
    assert release["if"] == release_condition
    assert sign_step["if"] == f"({release_condition}) || ({rehearsal_condition})"
    guard = next(
        step for step in validate["steps"]
        if step["name"] == "Restrict signed rehearsal to main"
    )
    assert guard["if"] == (
        "github.event_name == 'workflow_dispatch' && inputs.signed_rehearsal"
    )
    assert guard["shell"] == "bash"
    assert validate["steps"].index(guard) < next(
        i for i, step in enumerate(validate["steps"])
        if step["name"] == "Validate package versions and tag"
    )
    for ref, expected in {
        "refs/heads/main": 0,
        "refs/heads/feat/example-change": 1,
        "refs/tags/desktop-v1.5.0": 1,
    }.items():
        result = subprocess.run(
            ["bash", "-c", guard["run"]],
            env={"GITHUB_REF": ref}, capture_output=True, text=True, check=False,
        )
        assert result.returncode == expected, (
            f"signed rehearsal guard accepted unexpected ref: {ref}"
        )
    assert rehearsal["if"] == rehearsal_condition
    assert set(rehearsal["needs"]) == {"validate", "build"}
    assert rehearsal["permissions"] == {"contents": "read"}
    assert [step["name"] for step in rehearsal["steps"]] == [
        "Checkout",
        "Download signed rehearsal packages",
        "Prepare release assets",
        "Upload signed rehearsal assets",
    ]
    rehearsal_download = rehearsal["steps"][1]
    assert rehearsal_download["with"]["pattern"] == "metis-desktop-*-signed-rehearsal"
    rehearsal_upload = rehearsal["steps"][-1]
    assert rehearsal_upload["with"] == {
        "name": "metis-desktop-signed-rehearsal-assets",
        "path": "release-assets/*",
        "if-no-files-found": "error",
        "retention-days": 3,
    }
    release_prepare = next(
        step["run"] for step in release["steps"]
        if step["name"] == "Prepare release assets"
    )
    rehearsal_prepare = next(
        step["run"] for step in rehearsal["steps"]
        if step["name"] == "Prepare release assets"
    )
    assert rehearsal_prepare == release_prepare.replace(
        'release_version="${GITHUB_REF_NAME#desktop-v}"',
        '''release_version="$(python3 -c 'import json; print(json.load(open("apps/desktop/package.json"))["version"])')"''',
    ), "rehearsal and release must prepare identical assets"
    with tempfile.TemporaryDirectory(prefix="metis-rehearsal-assets-") as directory:
        fixture = Path(directory)
        package = fixture / "apps/desktop/package.json"
        package.parent.mkdir(parents=True)
        package.write_text(json.dumps({"version": expected_version}))
        generator = fixture / "tools/software_update/generate_latest_json.py"
        generator.parent.mkdir(parents=True)
        shutil.copyfile(CONFIG["latest_json_generator"], generator)
        notes = fixture / "docs/release-notes/desktop.md"
        notes.parent.mkdir(parents=True)
        notes.write_text("Rehearsal fixture notes\n")
        downloads = fixture / "release-downloads"
        downloads.mkdir()
        names = [
            f"Metis_{expected_version}_universal.dmg",
            f"Metis_{expected_version}_x64-setup.exe",
            f"Metis_{expected_version}_amd64.AppImage",
            f"Metis_{expected_version}_amd64.deb",
        ]
        for name in names:
            (downloads / name).write_bytes(b"installer fixture")
        for name in names[:3]:
            (downloads / (name + ".sig")).write_text("fixture-signature")
        prepared = subprocess.run(
            ["bash", "-c", rehearsal_prepare], cwd=fixture,
            capture_output=True, text=True, check=False,
        )
        assert prepared.returncode == 0, "signed rehearsal asset assembly failed"
        assets = fixture / "release-assets"
        assert len(list(assets.iterdir())) == 9
        assert len((assets / "SHA256SUMS").read_text().splitlines()) == 8
        assert (
            json.loads((assets / "latest.json").read_text())["version"]
            == expected_version
        )
        shutil.rmtree(assets)
        (downloads / (names[0] + ".sig")).unlink()
        rejected = subprocess.run(
            ["bash", "-c", rehearsal_prepare], cwd=fixture,
            capture_output=True, text=True, check=False,
        )
        assert rejected.returncode != 0, (
            "unsigned packages must not pass signed asset assembly"
        )
    assert [
        name for name, job in jobs.items()
        if job.get("permissions", {}).get("contents") == "write"
    ] == ["release"]
    assert [
        name for name, job in jobs.items() if "secrets." in json.dumps(job)
    ] == ["build"]
    secret_build_steps = [
        step["name"]
        for step in build["steps"]
        if "secrets." in json.dumps(step, sort_keys=True)
    ]
    assert secret_build_steps == ["Sign updater package"]
    assert "unsigned-preview" in upload_step["with"]["name"]
    assert "signed-rehearsal" in upload_step["with"]["name"]
    assert (
        "inputs.signed_rehearsal && github.ref == 'refs/heads/main'"
        in upload_step["with"]["name"]
    )
    assert upload_step["with"]["retention-days"] == 3
    assert workflow_text.count("node-version: 24") == 1
    assert workflow_text.count("version: 10.34.5") == 1
    assert "node-version: 22" not in workflow_text
    validate_action_pins(workflow_text)
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
