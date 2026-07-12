# User Guide

English | [简体中文](../zh-CN/user-guide.md)

## Skills workspace

A scan reads the Agent paths configured in Settings and discovers first-level directories containing `SKILL.md`. Scanning reads local files only and does not contact a Git remote.

When the same Skill is installed for multiple Agents, the home page groups its installation locations. The detail page lets you inspect and manage those locations.

## Sources and updates

A source includes a Git repository URL, the Skill subdirectory inside the repository, and a branch or other ref. Update checks are explicit user actions; opening a detail page does not fetch in the background.

Before replacing files, confirm that:

- The source URL and Skill subdirectory are correct.
- The file diff matches your expectations.
- Local modifications can be replaced.
- Security warnings do not reveal unexpected scripts, executables, sensitive paths, or possible secrets.

A replacement update creates a backup first. A manual update can overwrite local modifications, so check the target Agent and path in the confirmation dialog.

## Backups and rollback

Metis saves a backup before a replacement update. Existing backups can be restored from the detail page. A rollback also preserves the current state before restoring the selected backup.

Backups are local data. Before deleting application data or cleaning backup directories manually, confirm that you no longer need an older version.

## Adding a remote Skill

“Add Skill” accepts a GitHub Skill directory page, repository page, or clone URL. A directory page can usually provide the repository subdirectory automatically; a repository page may require you to enter it.

After previewing the source, select Agent or custom target paths. An existing valid Skill is replaced only after explicit confirmation; an unrelated conflicting directory is not treated as a Skill.

## Copying locally to another Agent

Installation locations on the detail page use the current local Skill as the copy source:

- No remote update check is performed.
- No clone, fetch, or checkout is performed.
- Existing directories are not overwritten.
- The target must be an allowed Agent or custom path from Settings.

## Settings workspace

- View and edit built-in Agent paths.
- Add, edit, or remove named custom paths.
- Check whether local Git is available.
- Manage trusted sources and the one-click update list.
- Control startup checks for Metis application updates and run a manual check.

One-click update processes only trusted Skills that are in the list and have no local modifications. Other cases still require a manual check and confirmation.

## Private repositories

Metis does not provide a token field and does not store credentials. Configure and verify system Git, an SSH agent, or a Git credential helper in a terminal before testing the same source in Metis.
