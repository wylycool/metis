from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import quote


SEMVER_PATTERN = re.compile(
    r"(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)\."
    r"(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
)


def build_latest_manifest(config: dict[str, object]) -> dict[str, object]:
    package_path = Path(config["desktop_package"])
    release_assets = Path(config["release_assets"])
    release_notes = Path(config["release_notes"])
    repository = str(config["repository"])

    version = json.loads(package_path.read_text())["version"]
    if SEMVER_PATTERN.fullmatch(version) is None:
        raise ValueError(f"desktop package version is not valid SemVer: {version}")

    tag = f"desktop-v{version}"
    encoded_tag = quote(tag, safe="-+")
    asset_names = {
        "macos": f"Metis_{version}_universal.dmg",
        "windows": f"Metis_{version}_x64-setup.exe",
        "linux": f"Metis_{version}_amd64.AppImage",
    }
    signatures = {
        platform: read_signature(release_assets / f"{asset_name}.sig")
        for platform, asset_name in asset_names.items()
    }

    def platform_entry(platform: str) -> dict[str, str]:
        asset_name = asset_names[platform]
        encoded_asset_name = quote(asset_name, safe="._-+")
        return {
            "url": (
                f"https://github.com/{repository}/releases/download/"
                f"{encoded_tag}/{encoded_asset_name}"
            ),
            "signature": signatures[platform],
        }

    return {
        "version": version,
        "notes": release_notes.read_text().strip(),
        "platforms": {
            "darwin-aarch64": platform_entry("macos"),
            "darwin-x86_64": platform_entry("macos"),
            "windows-x86_64": platform_entry("windows"),
            "linux-x86_64": platform_entry("linux"),
        },
    }


def read_signature(path: Path) -> str:
    if not path.is_file():
        raise FileNotFoundError(f"missing updater signature: {path}")
    signature = path.read_text().strip()
    if not signature or any(character.isspace() for character in signature):
        raise ValueError(f"invalid updater signature: {path}")
    return signature


def write_latest_manifest(config: dict[str, object]) -> Path:
    manifest = build_latest_manifest(config)
    output_path = Path(config["output"])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return output_path


REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG = {
    "desktop_package": REPO_ROOT / "apps/desktop/package.json",
    "release_assets": REPO_ROOT / "release-assets",
    "release_notes": REPO_ROOT / "docs/release-notes/desktop.md",
    "repository": "wylycool/metis",
    "output": REPO_ROOT / "release-assets/latest.json",
}


if __name__ == "__main__":
    print(write_latest_manifest(CONFIG))
