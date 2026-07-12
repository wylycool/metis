# Troubleshooting

English | [简体中文](../zh-CN/troubleshooting.md)

## A Skill is not discovered

- Confirm that the target directory contains `SKILL.md`.
- Check the Agent path in Settings.
- Confirm that the current user can read the directory.

## A Git source cannot be reached

- Run the Git check in Settings.
- Confirm in a terminal that `git` can access the same repository.
- Configure an SSH agent or Git credential helper for private repositories.
- Verify the repository URL, ref, and Skill subdirectory.

## Installation or update fails

- Confirm that the target Agent path exists and is writable.
- Metis does not overwrite a conflicting directory that is not a valid Skill; inspect it manually.
- Review the security warning and error message. Never attach tokens, private repository URLs, or complete local paths to a public Issue.

If the problem continues, open a GitHub Issue with the Metis version, operating system, reproduction steps, and sanitized logs.
