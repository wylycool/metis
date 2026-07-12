# Troubleshooting

English | [简体中文](../zh-CN/troubleshooting.md)

## A Skill is not discovered

- Confirm that the first level of the target path contains a Skill directory with `SKILL.md`.
- Check the Agent or custom path in Settings.
- Confirm that the current user can read the directory.
- Save changed paths and run a new scan.

## The Git check fails

- Confirm that `git --version` works in a terminal.
- If Metis was launched from the desktop, make sure Git is available through the system PATH.
- For a private repository, run `git ls-remote <repository-url>` in a terminal first to verify the SSH agent or credential helper.

## Source preview or update check fails

- Verify the repository URL, ref, and Skill subdirectory.
- Confirm that the target subdirectory contains `SKILL.md`.
- Check the network, proxy, enterprise certificate, and Git-host permissions.
- Do not place a token directly in the repository URL.

## Installation, copy, or update fails

- Confirm that the target Agent path exists and is readable and writable.
- An unrelated conflicting directory is not overwritten; inspect or move it manually.
- Local copy does not overwrite an installed location. Use the source-update workflow to update an existing Skill.
- Check the target Agent and path in the confirmation dialog when the same Skill has multiple installations.

## Understanding security warnings

Info usually indicates scripts or executable files. Warning may indicate download-and-execute patterns, sensitive-path access, or possible secrets. These are static hints: they do not prove that a file is malicious, and they do not guarantee that a file is safe. Review diffs and file contents for unfamiliar sources.

## Application update or installer issues

- A failed startup update check does not affect local Skill management; retry manually in Settings later.
- Current macOS and Windows packages do not have operating-system code signing and may show an unknown-developer warning.
- Use packages only from this repository's Releases and verify `SHA256SUMS`.
- Metis does not install a downloaded update automatically; complete installation manually from Downloads.

## Reporting a problem

If the problem continues, open a GitHub Issue with the Metis version, operating system, reproduction steps, and sanitized logs. Remove tokens, private repository URLs, personal data, and complete local paths. Report vulnerabilities privately through [SECURITY.md](../../SECURITY.md).
