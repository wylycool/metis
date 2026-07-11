use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitRemoteRef {
    pub url: String,
    pub ref_: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteCommit {
    pub commit: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteDefaultBranch {
    pub branch: String,
    pub commit: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitCommandOutput {
    pub stdout: String,
    pub stderr: String,
}

pub trait GitCommandRunner {
    fn run_git(&self, args: &[&str]) -> Result<GitCommandOutput, GitProviderError>;

    fn run_git_in(
        &self,
        cwd: Option<&str>,
        args: &[&str],
    ) -> Result<GitCommandOutput, GitProviderError> {
        if let Some(cwd) = cwd {
            let mut scoped_args = Vec::with_capacity(args.len() + 2);
            scoped_args.push("-C");
            scoped_args.push(cwd);
            scoped_args.extend_from_slice(args);
            self.run_git(&scoped_args)
        } else {
            self.run_git(args)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GitProviderError {
    #[error("git unavailable: {reason}")]
    GitUnavailable { reason: String },

    #[error("git command failed: {command}: {stderr}")]
    CommandFailed { command: String, stderr: String },

    #[error("remote ref not found: {url} {ref_}")]
    RemoteRefNotFound { url: String, ref_: String },

    #[error("invalid git output: {output}")]
    InvalidOutput { output: String },

    #[error("path not found: {path}")]
    PathNotFound { path: String },

    #[error("invalid repo_path: {repo_path}")]
    InvalidRepoPath { repo_path: String },
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemGitRunner;

impl GitCommandRunner for SystemGitRunner {
    fn run_git(&self, args: &[&str]) -> Result<GitCommandOutput, GitProviderError> {
        run_system_git(args, &[])
    }
}

#[derive(Debug, Clone, Default)]
pub struct EnvironmentGitRunner {
    environment: Vec<(String, String)>,
}

impl EnvironmentGitRunner {
    pub fn new(environment: Vec<(String, String)>) -> Self {
        Self { environment }
    }

    pub fn environment(&self) -> &[(String, String)] {
        &self.environment
    }
}

impl GitCommandRunner for EnvironmentGitRunner {
    fn run_git(&self, args: &[&str]) -> Result<GitCommandOutput, GitProviderError> {
        run_system_git(args, &self.environment)
    }
}

fn run_system_git(
    args: &[&str],
    environment: &[(String, String)],
) -> Result<GitCommandOutput, GitProviderError> {
    let merged_environment = merged_git_environment(environment);
    let output = Command::new("git")
        .args(args)
        .envs(merged_environment.iter().map(|(key, value)| (key, value)))
        .output()
        .map_err(|error| GitProviderError::GitUnavailable {
            reason: error.to_string(),
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(GitProviderError::CommandFailed {
            command: format!("git {}", args.join(" ")),
            stderr,
        });
    }

    Ok(GitCommandOutput { stdout, stderr })
}

fn merged_git_environment(environment: &[(String, String)]) -> Vec<(String, String)> {
    let mut merged = vec![
        ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
        ("GIT_ASKPASS".to_string(), String::new()),
        ("SSH_ASKPASS".to_string(), String::new()),
        (
            "GIT_SSH_COMMAND".to_string(),
            "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes".to_string(),
        ),
    ];

    for (key, value) in environment {
        if let Some((_, existing_value)) = merged
            .iter_mut()
            .find(|(existing_key, _)| existing_key == key)
        {
            *existing_value = value.clone();
        } else {
            merged.push((key.clone(), value.clone()));
        }
    }

    merged
}

#[derive(Debug, Clone)]
pub struct GitCliProvider<R> {
    runner: R,
    cache_root: Option<String>,
}

impl<R: GitCommandRunner> GitCliProvider<R> {
    pub fn new(runner: R) -> Self {
        Self {
            runner,
            cache_root: None,
        }
    }

    pub fn with_cache_root(runner: R, cache_root: impl Into<String>) -> Self {
        Self {
            runner,
            cache_root: Some(cache_root.into()),
        }
    }

    pub fn runner(&self) -> &R {
        &self.runner
    }

    pub fn cache_root(&self) -> Option<&str> {
        self.cache_root.as_deref()
    }

    pub fn check_git_available(&self) -> Result<(), GitProviderError> {
        self.runner.run_git(&["--version"])?;
        Ok(())
    }

    pub fn remote_commit(&self, remote: &GitRemoteRef) -> Result<RemoteCommit, GitProviderError> {
        let output = self
            .runner
            .run_git(&["ls-remote", &remote.url, &remote.ref_])?;
        let commit = parse_ls_remote_commit(&output.stdout).map_err(|error| match error {
            ParseLsRemoteError::Empty => GitProviderError::RemoteRefNotFound {
                url: remote.url.clone(),
                ref_: remote.ref_.clone(),
            },
            ParseLsRemoteError::Invalid => GitProviderError::InvalidOutput {
                output: output.stdout,
            },
        })?;

        Ok(RemoteCommit { commit })
    }

    pub fn remote_default_branch(
        &self,
        url: &str,
    ) -> Result<RemoteDefaultBranch, GitProviderError> {
        let output = self
            .runner
            .run_git(&["ls-remote", "--symref", url, "HEAD"])?;
        parse_ls_remote_default_branch(&output.stdout).map_err(|error| match error {
            ParseLsRemoteError::Empty => GitProviderError::RemoteRefNotFound {
                url: url.to_string(),
                ref_: "HEAD".to_string(),
            },
            ParseLsRemoteError::Invalid => GitProviderError::InvalidOutput {
                output: output.stdout,
            },
        })
    }
}

pub type SystemGitCliProvider = GitCliProvider<SystemGitRunner>;

impl Default for SystemGitCliProvider {
    fn default() -> Self {
        Self::new(SystemGitRunner)
    }
}

enum ParseLsRemoteError {
    Empty,
    Invalid,
}

fn parse_ls_remote_commit(output: &str) -> Result<String, ParseLsRemoteError> {
    let first_line = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .ok_or(ParseLsRemoteError::Empty)?;
    let parts = first_line.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 2 {
        return Err(ParseLsRemoteError::Invalid);
    }
    let commit = parts[0];

    if commit.is_empty() || !commit.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(ParseLsRemoteError::Invalid);
    }

    Ok(commit.to_string())
}

fn parse_ls_remote_default_branch(output: &str) -> Result<RemoteDefaultBranch, ParseLsRemoteError> {
    let mut branch = None;
    let mut commit = None;
    for line in output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let parts = line.split_whitespace().collect::<Vec<_>>();
        if parts.len() == 3 && parts[0] == "ref:" && parts[2] == "HEAD" {
            let branch_name = parts[1]
                .strip_prefix("refs/heads/")
                .ok_or(ParseLsRemoteError::Invalid)?;
            if branch_name.is_empty() {
                return Err(ParseLsRemoteError::Invalid);
            }
            branch = Some(branch_name.to_string());
        } else if parts.len() >= 2 && parts[1] == "HEAD" {
            let commit_text = parts[0];
            if commit_text.is_empty() || !commit_text.chars().all(|ch| ch.is_ascii_hexdigit()) {
                return Err(ParseLsRemoteError::Invalid);
            }
            commit = Some(commit_text.to_string());
        }
    }

    let branch = branch.ok_or(ParseLsRemoteError::Empty)?;
    Ok(RemoteDefaultBranch { branch, commit })
}

#[cfg(test)]
mod tests {
    use super::*;
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

        fn with_error(error: GitProviderError) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                result: RefCell::new(Err(error)),
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
    fn remote_commit_runs_ls_remote_and_parses_first_commit() {
        let runner =
            FakeRunner::with_stdout("abc123def456\trefs/heads/main\nignored\trefs/other\n");
        let provider = GitCliProvider::new(runner);

        let commit = provider
            .remote_commit(&GitRemoteRef {
                url: "https://github.com/example/metis-skills.git".to_string(),
                ref_: "main".to_string(),
            })
            .expect("remote commit should resolve");

        assert_eq!(commit.commit, "abc123def456");
        assert_eq!(
            provider.runner().calls.borrow().as_slice(),
            &[vec![
                "ls-remote".to_string(),
                "https://github.com/example/metis-skills.git".to_string(),
                "main".to_string()
            ]]
        );
    }

    #[test]
    fn remote_default_branch_runs_ls_remote_symref_and_parses_branch_name() {
        let runner = FakeRunner::with_stdout("ref: refs/heads/main\tHEAD\nabc123def456\tHEAD\n");
        let provider = GitCliProvider::new(runner);

        let default_branch = provider
            .remote_default_branch("https://github.com/example/metis-skills.git")
            .expect("default branch should resolve");

        assert_eq!(default_branch.branch, "main");
        assert_eq!(default_branch.commit.as_deref(), Some("abc123def456"));
        assert_eq!(
            provider.runner().calls.borrow().as_slice(),
            &[vec![
                "ls-remote".to_string(),
                "--symref".to_string(),
                "https://github.com/example/metis-skills.git".to_string(),
                "HEAD".to_string()
            ]]
        );
    }

    #[test]
    fn remote_commit_returns_ref_not_found_for_empty_output() {
        let runner = FakeRunner::with_stdout("");
        let provider = GitCliProvider::new(runner);

        let error = provider
            .remote_commit(&GitRemoteRef {
                url: "https://github.com/example/metis-skills.git".to_string(),
                ref_: "missing".to_string(),
            })
            .expect_err("empty ls-remote output should fail");

        assert!(matches!(error, GitProviderError::RemoteRefNotFound { .. }));
    }

    #[test]
    fn remote_commit_returns_invalid_output_without_commit_column() {
        let runner = FakeRunner::with_stdout("\trefs/heads/main\n");
        let provider = GitCliProvider::new(runner);

        let error = provider
            .remote_commit(&GitRemoteRef {
                url: "https://github.com/example/metis-skills.git".to_string(),
                ref_: "main".to_string(),
            })
            .expect_err("invalid ls-remote output should fail");

        assert!(matches!(error, GitProviderError::InvalidOutput { .. }));
    }

    #[test]
    fn remote_commit_propagates_command_failure() {
        let runner = FakeRunner::with_error(GitProviderError::CommandFailed {
            command: "git ls-remote".to_string(),
            stderr: "auth failed".to_string(),
        });
        let provider = GitCliProvider::new(runner);

        let error = provider
            .remote_commit(&GitRemoteRef {
                url: "https://github.com/example/private.git".to_string(),
                ref_: "main".to_string(),
            })
            .expect_err("runner failure should propagate");

        assert!(matches!(error, GitProviderError::CommandFailed { .. }));
    }

    #[test]
    fn default_git_environment_disables_interactive_prompts() {
        let environment = merged_git_environment(&[]);

        assert_eq!(
            environment
                .iter()
                .find(|(key, _)| key == "GIT_TERMINAL_PROMPT")
                .map(|(_, value)| value.as_str()),
            Some("0")
        );
        assert_eq!(
            environment
                .iter()
                .find(|(key, _)| key == "GIT_ASKPASS")
                .map(|(_, value)| value.as_str()),
            Some("")
        );
        assert_eq!(
            environment
                .iter()
                .find(|(key, _)| key == "SSH_ASKPASS")
                .map(|(_, value)| value.as_str()),
            Some("")
        );
        let ssh_command = environment
            .iter()
            .find(|(key, _)| key == "GIT_SSH_COMMAND")
            .map(|(_, value)| value.as_str())
            .expect("ssh command should be set");
        assert!(ssh_command.contains("BatchMode=yes"));
        assert!(ssh_command.contains("StrictHostKeyChecking=yes"));
    }

    #[test]
    fn explicit_git_environment_overrides_non_interactive_defaults() {
        let environment = merged_git_environment(&[
            ("GIT_TERMINAL_PROMPT".to_string(), "1".to_string()),
            (
                "GIT_SSH_COMMAND".to_string(),
                "ssh -F /tmp/metis-ssh-config".to_string(),
            ),
        ]);

        assert_eq!(
            environment
                .iter()
                .filter(|(key, _)| key == "GIT_TERMINAL_PROMPT")
                .map(|(_, value)| value.as_str())
                .collect::<Vec<_>>(),
            vec!["1"]
        );
        assert_eq!(
            environment
                .iter()
                .filter(|(key, _)| key == "GIT_SSH_COMMAND")
                .map(|(_, value)| value.as_str())
                .collect::<Vec<_>>(),
            vec!["ssh -F /tmp/metis-ssh-config"]
        );
    }
}
