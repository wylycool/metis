# Frequently Asked Questions

English | [简体中文](../zh-CN/faq.md)

## Does Metis upload my Skills?

No. The Skill index, settings, backups, and audit data stay on the local machine. Metis does not collect telemetry or upload Skill contents or local paths.

## Does scanning access the network?

No. Scanning and browsing local Skills read local files only. Remote Git access occurs when you preview a source, check for updates, inspect remote changes, or apply an update. The startup check for Metis application updates can be disabled in Settings.

## Does Metis store Git tokens or SSH private keys?

No. Private repository authentication relies on system Git, an SSH agent, or a Git credential helper.

## Can one-click update overwrite local modifications?

No. It processes only trusted Skills that are in the list and have no local modifications. A manual update can replace local changes after explicit confirmation and creates a backup first.

## Can I manage an Agent that is not built in?

You can try adding its Skill root as a custom path. Skills in that directory must use `SKILL.md`.

## Why does the installer show an unknown developer?

Current macOS and Windows packages do not yet have operating-system code signing. Download only from this repository's GitHub Releases and verify `SHA256SUMS`. See the [Security Policy](../../SECURITY.md) for details.

## Does uninstalling Metis delete my Agent Skills?

Metis manages existing Agent Skill directories. A normal application uninstall should not delete those directories, but clearing application data may remove the Metis index and backups. Confirm your backup needs before using system cleanup tools.
