# User Guide

English | [简体中文](../zh-CN/user-guide.md)

## Skills workspace

- Scan: discover `SKILL.md` files in configured Agent paths.
- Sources: bind a local Skill to a Git URL, repository path, and ref.
- Update checks: access the remote only after an explicit user action.
- Diff: inspect file changes before updating.
- Update: replace local files after confirmation and create a backup first.
- Rollback: restore an existing backup while preserving the pre-rollback state.
- Cross-Agent installation: install from a remote source to multiple Agents, or copy an existing local Skill to a location where it is not installed.

## Settings workspace

- View and edit built-in Agent Skill paths.
- Add named custom paths.
- Check the local Git environment.
- Manage trusted sources and the one-click update list.
- Check for Metis application updates.

## Credentials and network access

Metis does not store Git tokens or SSH private keys. Private repository authentication relies on system Git, an SSH agent, or a Git credential helper. Local scans do not require network access; remote access occurs when you preview a source, check for updates, inspect remote changes, or apply an update.
