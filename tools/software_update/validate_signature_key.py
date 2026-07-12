from __future__ import annotations

import base64
import json
from pathlib import Path


def minisign_key_id(encoded_box: str, label: str) -> bytes:
    try:
        decoded_box = base64.b64decode(encoded_box, validate=True).decode("utf-8")
        lines = [line.strip() for line in decoded_box.splitlines() if line.strip()]
        raw_key_or_signature = base64.b64decode(lines[1], validate=True)
    except (IndexError, UnicodeDecodeError, ValueError) as error:
        raise ValueError(f"invalid {label} minisign box") from error
    if len(raw_key_or_signature) < 10:
        raise ValueError(f"invalid {label} minisign payload")
    return raw_key_or_signature[2:10]


def validate_signature_keys(config: dict[str, object]) -> list[Path]:
    repo_root = Path(config["repo_root"])
    tauri_config = json.loads(Path(config["tauri_config"]).read_text())
    public_key = tauri_config["plugins"]["updater"]["pubkey"]
    expected_key_id = minisign_key_id(public_key, "updater public key")
    signature_paths = sorted(repo_root.glob(str(config["signature_glob"])))
    if not signature_paths:
        raise FileNotFoundError("no updater signatures were found after signing")

    for signature_path in signature_paths:
        package_path = signature_path.with_suffix("")
        if not package_path.is_file():
            raise FileNotFoundError(f"signature has no matching package: {signature_path}")
        signature_key_id = minisign_key_id(
            signature_path.read_text().strip(),
            f"updater signature {signature_path}",
        )
        if signature_key_id != expected_key_id:
            raise ValueError(
                "updater signature key does not match plugins.updater.pubkey: "
                f"{signature_path}"
            )
    return signature_paths


REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG = {
    "repo_root": REPO_ROOT,
    "tauri_config": REPO_ROOT / "apps/desktop/src-tauri/tauri.conf.json",
    "signature_glob": "target/**/Metis_*.sig",
}


if __name__ == "__main__":
    for validated_path in validate_signature_keys(CONFIG):
        print(validated_path)
