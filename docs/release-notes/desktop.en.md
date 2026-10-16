# Metis Desktop

English | [简体中文](https://github.com/wylycool/metis/releases/latest)

Metis is a cross-platform, local-first Agent Skill manager.

### Downloads

- macOS: universal `.dmg` for Apple Silicon and Intel Mac
- Windows: installer `.exe`
- Linux: `.deb` or `.AppImage`
- `SHA256SUMS`: checksums for release assets

### Highlights

- Discover Skills installed for Codex, Claude Code, OpenClaw, Hermes, opencode, Cursor, Qoder, Gemini CLI, and custom paths.
- Bind local Skills to Git sources and check for updates on demand.
- Review file changes and local modifications before updating.
- Create backups before replacement and restore previous versions.
- Install a remote Skill to selected Agent paths.
- Copy an existing local Skill to another Agent without accessing the remote or overwriting an existing directory.
- Manage Agent paths, custom paths, trusted sources, and the one-click update list in Settings.

### System Git requirement

Local scanning, browsing, and local copying do not require Git. Source preview, connection tests, remote installation, update checks, remote diffs, and source updates require a working system Git. Private repository authentication uses the user's existing SSH agent or Git credential helper; Metis does not store repository credentials.

### Network and installation behavior

Local scanning does not access a remote Git server. Git access occurs after an explicit source preview, connection test, update check, diff request, or update action. The optional startup application-update check can be disabled in Settings.

Metis does not silently install, elevate privileges, or restart itself. A downloaded application update is saved to the system Downloads directory for the user to install manually.

### Signing notice

Current macOS packages are not signed and notarized with Apple Developer ID, and Windows packages are not signed with Authenticode. Gatekeeper or SmartScreen may display an unknown-developer warning. Download only from this repository and verify `SHA256SUMS`.
