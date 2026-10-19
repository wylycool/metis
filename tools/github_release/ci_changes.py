"""Select full CI unless every changed path is explicitly documentation."""

import os
import re
import subprocess
from pathlib import Path, PurePosixPath


PUBLIC_DOCUMENTS = {
    "README.md", "CONTRIBUTING.md", "SECURITY.md", "SUPPORT.md", "CODE_OF_CONDUCT.md",
}
DOCUMENT_EXTENSIONS = {".md", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}


def requires_full_checks(config: dict) -> bool:
    base, head = config["base"], config["head"]
    if config["event"] not in {"pull_request", "push"}:
        return True
    if not all(re.fullmatch(r"[0-9a-f]{40}", sha) and sha != "0" * 40 for sha in (base, head)):
        return True

    def git(*args):
        return subprocess.check_output(
            ["git", *args], cwd=config["repository"], stderr=subprocess.DEVNULL,
            timeout=30,
        )

    try:
        if config["event"] == "pull_request":
            base = git("merge-base", base, head).decode("ascii").strip()
        # Include both old and new names so moving code into docs cannot bypass CI.
        paths = git("diff", "--name-only", "--no-renames", "-z", base, head, "--").split(b"\0")
    except (subprocess.SubprocessError, OSError, UnicodeError):
        return True

    changed = [os.fsdecode(path) for path in paths if path]
    return not changed or any(
        path not in PUBLIC_DOCUMENTS
        and not (path.startswith("docs/") and PurePosixPath(path).suffix in DOCUMENT_EXTENSIONS)
        for path in changed
    )


def main(config: dict) -> None:
    full_checks = requires_full_checks(config)
    with config["output"].open("a") as output:
        output.write(f"full_checks={str(full_checks).lower()}\n")
    print("Full checks required." if full_checks else "Documentation only; full checks skipped.")


if __name__ == "__main__":
    main({
        "repository": Path.cwd(),
        "event": os.environ["CI_EVENT"],
        "base": os.environ["CI_BASE_SHA"],
        "head": os.environ["CI_HEAD_SHA"],
        "output": Path(os.environ["GITHUB_OUTPUT"]),
    })
