# Getting Started

English | [简体中文](../zh-CN/getting-started.md)

## 1. Install Metis

Download the package for your platform from [GitHub Releases](https://github.com/wylycool/metis/releases):

- macOS: universal `.dmg`
- Windows: installer `.exe`
- Linux: `.deb` or `.AppImage`

Current macOS and Windows packages do not yet have operating-system code signing, so the first launch may show an unknown-developer warning. Download only from the official Releases page and verify `SHA256SUMS`.

If a Linux AppImage is not executable, run:

```bash
chmod +x Metis_*.AppImage
```

## 2. Scan local Skills

Open Metis, go to `Skills`, and run a new scan. Metis checks Codex, Claude Code, OpenClaw, Hermes, opencode, and custom paths.

If nothing is found, check the Agent paths in `Settings` and confirm that the target directory contains `SKILL.md`.

## 3. Bind a Git source

Open a Skill and enter its Git repository URL, repository subdirectory, and ref. For a private repository, configure an SSH agent or Git credential helper first. Metis does not store tokens or private keys.

## 4. Check and apply updates

After checking for updates, review the result, local modifications, and file diff before applying the update. A replacement update creates a backup first, and you can restore that backup later if needed.

## 5. Add or copy a Skill

- Remote installation: choose “Add Skill”, paste a GitHub Skill directory page or repository URL, preview it, and select target paths.
- Local copy: expand installation locations on the detail page and copy the current content to another Agent. This action does not access the remote or overwrite an existing directory.

See the [User Guide](user-guide.md) and [Troubleshooting](troubleshooting.md) for more details.
