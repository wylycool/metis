import subprocess
import tempfile
import unittest
from pathlib import Path

from ci_changes import requires_full_checks


class ChangeSelectionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Example")
        self.git("config", "user.email", "example@example.invalid")
        self.commit("README.md")
        self.base = self.git("rev-parse", "HEAD")

    def git(self, *args):
        return subprocess.check_output(
            ["git", *args], cwd=self.root, text=True, stderr=subprocess.DEVNULL
        ).strip()

    def commit(self, name):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(path.read_text() + "change\n" if path.exists() else "change\n")
        self.git("add", "--", name)
        self.git("commit", "-m", "Update example")
        return self.git("rev-parse", "HEAD")

    def requires_full(self, event="push", base=None, head=None):
        return requires_full_checks({
            "repository": self.root,
            "event": event,
            "base": base or self.base,
            "head": head or self.git("rev-parse", "HEAD"),
        })

    def test_public_docs_and_documentation_images_skip_full_checks(self):
        for name in ("README.md", "CONTRIBUTING.md", "SECURITY.md", "SUPPORT.md",
                     "CODE_OF_CONDUCT.md", "docs/zh-CN/user-guide.md",
                     "docs/images/screen shot.png", "docs/images/card.svg"):
            self.commit(name)
        self.assertFalse(self.requires_full())

    def test_code_dependencies_workflows_and_unknown_paths_run_full_checks(self):
        for name in ("crates/core/src/lib.rs", "apps/desktop/package.json",
                     ".github/workflows/ci.yml", "tools/example.py",
                     "docs/example.py", "docs/config.yml", "notes.md",
                     "apps/desktop/public/icon.svg", "apps/desktop/src/help.md",
                     "docs/images/odd\nname.py"):
            with self.subTest(name=name):
                base = self.git("rev-parse", "HEAD")
                self.commit(name)
                self.assertTrue(self.requires_full(base=base))

    def test_push_checks_all_commits_including_earlier_code(self):
        self.commit("Cargo.toml")
        self.commit("README.md")
        self.assertTrue(self.requires_full())

    def test_pr_uses_merge_base_without_including_target_only_changes(self):
        self.git("checkout", "-b", "docs-change")
        head = self.commit("README.md")
        self.git("checkout", "main")
        target = self.commit("Cargo.toml")
        self.assertFalse(self.requires_full("pull_request", target, head))

    def test_deleted_code_and_cross_directory_renames_run_full_checks(self):
        base = self.commit("source.svg")
        (self.root / "docs").mkdir()
        self.git("mv", "source.svg", "docs/moved.svg")
        self.git("commit", "-m", "Move example")
        self.assertTrue(self.requires_full(base=base))
        base = self.commit("source.rs")
        self.git("rm", "source.rs")
        self.git("commit", "-m", "Remove example")
        self.assertTrue(self.requires_full(base=base))

    def test_missing_invalid_or_empty_baselines_run_full_checks(self):
        for event, base, head in (
            ("push", "0" * 40, self.base),
            ("push", "f" * 40, self.base),
            ("push", "--help", self.base),
            ("push", self.base, "--help"),
            ("push", self.base, self.base),
            ("unknown", self.base, self.base),
        ):
            with self.subTest(event=event, base=base, head=head):
                self.assertTrue(self.requires_full(event, base, head))


if __name__ == "__main__":
    unittest.main()
