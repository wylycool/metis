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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fetch::{GitCommandOutput, GitCommandRunner, GitProviderError};
    use std::cell::RefCell;

    struct FakeRunner {
        calls: RefCell<Vec<Vec<String>>>,
        result: RefCell<Result<GitCommandOutput, GitProviderError>>,
    }

    impl FakeRunner {
        fn with_stdout(stdout: &str) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                result: RefCell::new(Ok(GitCommandOutput {
                    stdout: stdout.to_string(),
                    stderr: String::new(),
                })),
            }
        }
    }

    impl GitCommandRunner for FakeRunner {
        fn run_git(&self, args: &[&str]) -> Result<GitCommandOutput, GitProviderError> {
            self.calls
                .borrow_mut()
                .push(args.iter().map(|arg| arg.to_string()).collect());
            self.result.borrow().clone()
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
}
