use crate::fetch::{GitCliProvider, GitCommandRunner, GitProviderError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitDiffRequest {
    pub repo_path: String,
    pub current_commit: String,
    pub target_commit: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitDiffSummary {
    pub files_added: u32,
    pub files_modified: u32,
    pub files_deleted: u32,
    pub total_changes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitDiffDetail {
    pub current_commit: String,
    pub target_commit: String,
    pub files: Vec<GitFileDiff>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitFileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: GitDiffStatus,
    pub patch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitDiffStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

impl<R: GitCommandRunner> GitCliProvider<R> {
    pub fn diff_summary(
        &self,
        request: &GitDiffRequest,
    ) -> Result<GitDiffSummary, GitProviderError> {
        let output = if request.repo_path.is_empty() {
            self.runner().run_git(&[
                "diff",
                "--name-status",
                &request.current_commit,
                &request.target_commit,
            ])?
        } else {
            self.runner().run_git(&[
                "diff",
                "--name-status",
                &request.current_commit,
                &request.target_commit,
                "--",
                &request.repo_path,
            ])?
        };

        parse_name_status_summary(&output.stdout).map_err(|()| GitProviderError::InvalidOutput {
            output: output.stdout,
        })
    }

    pub fn commits_behind(&self, request: &GitDiffRequest) -> Result<u32, GitProviderError> {
        let range = format!("{}..{}", request.current_commit, request.target_commit);
        let output = self.runner().run_git(&["rev-list", "--count", &range])?;
        output
            .stdout
            .trim()
            .parse::<u32>()
            .map_err(|_| GitProviderError::InvalidOutput {
                output: output.stdout,
            })
    }

    pub fn diff_detail(&self, request: &GitDiffRequest) -> Result<GitDiffDetail, GitProviderError> {
        let name_status_output = if request.repo_path.is_empty() {
            self.runner().run_git(&[
                "diff",
                "--name-status",
                &request.current_commit,
                &request.target_commit,
            ])?
        } else {
            self.runner().run_git(&[
                "diff",
                "--name-status",
                &request.current_commit,
                &request.target_commit,
                "--",
                &request.repo_path,
            ])?
        };
        let patch_output = if request.repo_path.is_empty() {
            self.runner().run_git(&[
                "diff",
                "--patch",
                &request.current_commit,
                &request.target_commit,
            ])?
        } else {
            self.runner().run_git(&[
                "diff",
                "--patch",
                &request.current_commit,
                &request.target_commit,
                "--",
                &request.repo_path,
            ])?
        };
        let mut files = parse_name_status_files(&name_status_output.stdout).map_err(|()| {
            GitProviderError::InvalidOutput {
                output: name_status_output.stdout,
            }
        })?;
        let patches = split_patch_sections(&patch_output.stdout);

        for file in &mut files {
            file.patch = patches
                .iter()
                .find(|(path, _)| path == &file.path)
                .map(|(_, patch)| patch.clone());
        }

        Ok(GitDiffDetail {
            current_commit: request.current_commit.clone(),
            target_commit: request.target_commit.clone(),
            files,
        })
    }
}

fn parse_name_status_summary(output: &str) -> Result<GitDiffSummary, ()> {
    let mut summary = GitDiffSummary {
        files_added: 0,
        files_modified: 0,
        files_deleted: 0,
        total_changes: 0,
    };

    for line in output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let columns = line.split('\t').collect::<Vec<_>>();
        let status = columns.first().ok_or(())?;

        match status.chars().next().ok_or(())? {
            'A' if columns.len() >= 2 => summary.files_added += 1,
            'M' if columns.len() >= 2 => summary.files_modified += 1,
            'D' if columns.len() >= 2 => summary.files_deleted += 1,
            'R' if columns.len() >= 3 => summary.files_modified += 1,
            _ => return Err(()),
        }

        summary.total_changes += 1;
    }

    Ok(summary)
}

fn parse_name_status_files(output: &str) -> Result<Vec<GitFileDiff>, ()> {
    let mut files = Vec::new();

    for line in output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let columns = line.split('\t').collect::<Vec<_>>();
        let status = columns.first().ok_or(())?;
        let file = match status.chars().next().ok_or(())? {
            'A' if columns.len() >= 2 => GitFileDiff {
                path: columns[1].to_string(),
                old_path: None,
                status: GitDiffStatus::Added,
                patch: None,
            },
            'M' if columns.len() >= 2 => GitFileDiff {
                path: columns[1].to_string(),
                old_path: None,
                status: GitDiffStatus::Modified,
                patch: None,
            },
            'D' if columns.len() >= 2 => GitFileDiff {
                path: columns[1].to_string(),
                old_path: None,
                status: GitDiffStatus::Deleted,
                patch: None,
            },
            'R' if columns.len() >= 3 => GitFileDiff {
                path: columns[2].to_string(),
                old_path: Some(columns[1].to_string()),
                status: GitDiffStatus::Renamed,
                patch: None,
            },
            _ => return Err(()),
        };
        files.push(file);
    }

    Ok(files)
}

fn split_patch_sections(output: &str) -> Vec<(String, String)> {
    let mut sections = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_lines: Vec<String> = Vec::new();

    for line in output.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            if let Some(path) = current_path.take() {
                sections.push((path, current_lines.join("\n") + "\n"));
                current_lines.clear();
            }
            current_path = parse_diff_git_path(rest);
        }
        current_lines.push(line.to_string());
    }

    if let Some(path) = current_path {
        sections.push((path, current_lines.join("\n") + "\n"));
    }

    sections
}

fn parse_diff_git_path(rest: &str) -> Option<String> {
    let columns = rest.split_whitespace().collect::<Vec<_>>();
    let path = columns.get(1).or_else(|| columns.first())?;
    Some(
        path.strip_prefix("b/")
            .or_else(|| path.strip_prefix("a/"))
            .unwrap_or(path)
            .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fetch::{GitCommandOutput, GitCommandRunner, GitProviderError};
    use std::cell::RefCell;

    struct FakeRunner {
        calls: RefCell<Vec<Vec<String>>>,
        results: RefCell<Vec<Result<GitCommandOutput, GitProviderError>>>,
    }

    impl FakeRunner {
        fn with_stdout(stdout: &str) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                results: RefCell::new(vec![Ok(GitCommandOutput {
                    stdout: stdout.to_string(),
                    stderr: String::new(),
                })]),
            }
        }

        fn with_outputs(outputs: &[&str]) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                results: RefCell::new(
                    outputs
                        .iter()
                        .map(|stdout| {
                            Ok(GitCommandOutput {
                                stdout: stdout.to_string(),
                                stderr: String::new(),
                            })
                        })
                        .collect(),
                ),
            }
        }
    }

    impl GitCommandRunner for FakeRunner {
        fn run_git(&self, args: &[&str]) -> Result<GitCommandOutput, GitProviderError> {
            self.calls
                .borrow_mut()
                .push(args.iter().map(|arg| arg.to_string()).collect());
            self.results.borrow_mut().remove(0)
        }
    }

    #[test]
    fn diff_summary_runs_name_status_diff_and_counts_changes() {
        let runner = FakeRunner::with_stdout(
            "A\tskills/example/new.md\n\
             M\tskills/example/SKILL.md\n\
             D\tskills/example/old.md\n",
        );
        let provider = GitCliProvider::new(runner);

        let summary = provider
            .diff_summary(&GitDiffRequest {
                repo_path: "skills/example".to_string(),
                current_commit: "abc123".to_string(),
                target_commit: "def456".to_string(),
            })
            .expect("diff summary should parse");

        assert_eq!(
            summary,
            GitDiffSummary {
                files_added: 1,
                files_modified: 1,
                files_deleted: 1,
                total_changes: 3,
            }
        );
        assert_eq!(
            provider.runner().calls.borrow().as_slice(),
            &[vec![
                "diff".to_string(),
                "--name-status".to_string(),
                "abc123".to_string(),
                "def456".to_string(),
                "--".to_string(),
                "skills/example".to_string(),
            ]]
        );
    }

    #[test]
    fn diff_summary_counts_renames_as_modified() {
        let runner =
            FakeRunner::with_stdout("R100\tskills/example/old.md\tskills/example/new.md\n");
        let provider = GitCliProvider::new(runner);

        let summary = provider
            .diff_summary(&GitDiffRequest {
                repo_path: "skills/example".to_string(),
                current_commit: "abc123".to_string(),
                target_commit: "def456".to_string(),
            })
            .expect("rename summary should parse");

        assert_eq!(
            summary,
            GitDiffSummary {
                files_added: 0,
                files_modified: 1,
                files_deleted: 0,
                total_changes: 1,
            }
        );
    }

    #[test]
    fn diff_summary_rejects_unknown_status() {
        let runner = FakeRunner::with_stdout("X\tskills/example/file.md\n");
        let provider = GitCliProvider::new(runner);

        let error = provider
            .diff_summary(&GitDiffRequest {
                repo_path: "skills/example".to_string(),
                current_commit: "abc123".to_string(),
                target_commit: "def456".to_string(),
            })
            .expect_err("unknown status should fail");

        assert!(matches!(error, GitProviderError::InvalidOutput { .. }));
    }

    #[test]
    fn commits_behind_runs_rev_list_count_and_parses_number() {
        let runner = FakeRunner::with_stdout("3\n");
        let provider = GitCliProvider::new(runner);

        let behind = provider
            .commits_behind(&GitDiffRequest {
                repo_path: "skills/example".to_string(),
                current_commit: "abc123".to_string(),
                target_commit: "def456".to_string(),
            })
            .expect("behind count should parse");

        assert_eq!(behind, 3);
        assert_eq!(
            provider.runner().calls.borrow().as_slice(),
            &[vec![
                "rev-list".to_string(),
                "--count".to_string(),
                "abc123..def456".to_string(),
            ]]
        );
    }

    #[test]
    fn diff_detail_returns_file_statuses_and_patch_sections() {
        let runner = FakeRunner::with_outputs(&[
            "M\tskills/example/SKILL.md\nA\tskills/example/new.md\n",
            "diff --git a/skills/example/SKILL.md b/skills/example/SKILL.md\n\
             --- a/skills/example/SKILL.md\n\
             +++ b/skills/example/SKILL.md\n\
             @@ -1 +1 @@\n\
             -old\n\
             +new\n\
             diff --git a/skills/example/new.md b/skills/example/new.md\n\
             new file mode 100644\n",
        ]);
        let provider = GitCliProvider::new(runner);

        let request = GitDiffRequest {
            repo_path: "skills/example".to_string(),
            current_commit: "abc123".to_string(),
            target_commit: "def456".to_string(),
        };

        let detail = provider
            .diff_detail(&request)
            .expect("diff detail should parse");

        assert_eq!(detail.current_commit, "abc123");
        assert_eq!(detail.target_commit, "def456");
        assert_eq!(detail.files.len(), 2);
        assert_eq!(detail.files[0].path, "skills/example/SKILL.md");
        assert_eq!(detail.files[0].status, GitDiffStatus::Modified);
        assert!(detail.files[0]
            .patch
            .as_deref()
            .expect("patch should exist")
            .contains("diff --git"));
    }
}
