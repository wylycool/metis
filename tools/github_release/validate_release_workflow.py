from pathlib import Path

import yaml


CONFIG = {
    "workflow": Path(".github/workflows/desktop-preview.yml"),
}


def main() -> None:
    workflow_text = CONFIG["workflow"].read_text()
    workflow = yaml.safe_load(workflow_text)
    jobs = workflow["jobs"]
    release = jobs["release"]

    assert release["needs"] == "build"
    assert "refs/tags/desktop-v" in release["if"]
    assert "actions/download-artifact@v4" in workflow_text
    assert "SHA256SUMS" in workflow_text
    assert "gh release create" in workflow_text
    assert "gh release upload" in workflow_text


if __name__ == "__main__":
    main()
