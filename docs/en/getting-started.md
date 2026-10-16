# Getting Started

English | [简体中文](../zh-CN/getting-started.md)

## 1. Install Metis

Open [GitHub Releases](https://github.com/wylycool/metis/releases) and choose a release containing a package for your platform. `Source code` archives are not installers. If the package is absent, wait until it is published.

Choose the package for your platform:

- macOS: universal `.dmg`
- Windows: installer `.exe`
- Linux: `.deb` or `.AppImage`

On macOS, open the DMG, drag Metis to Applications, eject the DMG after copying, then open Metis from Applications. On Windows, run the EXE installer and follow its instructions.

Metis 1.5.0 macOS and Windows packages do not yet have operating-system code signing, so the first launch may show an unknown-developer warning. Download only from the official Releases page and verify `SHA256SUMS`.

If a Linux AppImage is not executable, run:

```bash
chmod +x Metis_*.AppImage
```

## 2. Requirements

- Scanning and browsing local Skills, and copying an installed Skill to another local location, do not require system Git.
- Source preview, connection tests, remote installation, update checks, remote diffs, and source updates require a working system Git.
- Use `Settings` to check whether Git is available. Metis 1.5.0 does not support remote repository features when system Git is unavailable.
- Private repository authentication relies on system Git, an SSH agent, or a Git credential helper. Metis has no token field and does not store credentials.

## 3. Scan local Skills

Open Metis, go to `Skills`, and run a new scan. Metis checks Codex, Claude Code, OpenClaw, Hermes, opencode, Cursor, Qoder, Gemini CLI, and custom paths.

If nothing is found, check the Agent paths in `Settings` and confirm that the target directory contains `SKILL.md`.

## 4. Bind a Git source

Open a Skill and enter its Git repository URL, repository subdirectory, and ref. For a private repository, configure an SSH agent or Git credential helper first. Metis does not store tokens or private keys.

## 5. Check and apply updates

After checking for updates, review the result, local modifications, and file diff before applying the update. A replacement update creates a backup first, and you can restore that backup later if needed.

## 6. Add or copy a Skill

- Remote installation: choose “Add Skill”, paste a GitHub Skill directory page or repository URL, preview it, and select target paths.
- Local copy: expand installation locations on the detail page and copy the current content to another Agent. This action does not access the remote or overwrite an existing directory.

See the [User Guide](user-guide.md) and [Troubleshooting](troubleshooting.md) for more details.
