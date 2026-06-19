use crate::fetch::{GitCliProvider, GitCommandRunner, GitProviderError};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitCheckoutRequest {
    pub url: String,
    pub ref_: String,
    pub repo_path: String,
    pub target_commit: String,
    pub cache_dir: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitCheckoutResult {
    pub checkout_dir: String,
    pub skill_dir: String,
}

impl<R: GitCommandRunner> GitCliProvider<R> {
    pub fn checkout_to_cache(
        &self,
        request: &GitCheckoutRequest,
    ) -> Result<GitCheckoutResult, GitProviderError> {
        let checkout_dir = PathBuf::from(&request.cache_dir).join(format!(
            "checkout-{}",
            sanitize_commit(&request.target_commit)
        ));
        let checkout_dir_text = checkout_dir.to_string_lossy().to_string();

        if checkout_dir.exists() {
            self.runner().run_git(&[
                "-C",
                &checkout_dir_text,
                "remote",
                "set-url",
                "origin",
                &request.url,
            ])?;
        } else {
            self.runner()
                .run_git(&["clone", "--no-checkout", &request.url, &checkout_dir_text])?;
        }
        self.runner()
            .run_git(&["-C", &checkout_dir_text, "fetch", "origin", &request.ref_])?;
        self.runner()
            .run_git(&["-C", &checkout_dir_text, "checkout", &request.target_commit])?;

        let skill_dir = checkout_dir.join(&request.repo_path);
        if !skill_dir.is_dir() {
            return Err(GitProviderError::PathNotFound {
                path: skill_dir.to_string_lossy().to_string(),
            });
        }

        Ok(GitCheckoutResult {
            checkout_dir: checkout_dir_text,
            skill_dir: skill_dir.to_string_lossy().to_string(),
        })
    }
}

fn sanitize_commit(commit: &str) -> String {
    commit
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fetch::{GitCommandOutput, GitCommandRunner, GitProviderError, SystemGitRunner};
    use std::cell::RefCell;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct FakeRunner {
        calls: RefCell<Vec<Vec<String>>>,
    }

    impl GitCommandRunner for FakeRunner {
        fn run_git(&self, args: &[&str]) -> Result<GitCommandOutput, GitProviderError> {
            self.calls
                .borrow_mut()
                .push(args.iter().map(|arg| arg.to_string()).collect());
            if args.first() == Some(&"clone") {
                if let Some(checkout_dir) = args.get(3) {
                    fs::create_dir_all(Path::new(checkout_dir).join("skills/example"))
                        .expect("fake checkout skill dir should be created");
                }
            }
            Ok(GitCommandOutput {
                stdout: String::new(),
                stderr: String::new(),
            })
        }
    }

    #[test]
    fn checkout_to_cache_clones_fetches_and_checks_out_target_commit() {
        let root = temp_dir("fake-checkout");
        let cache_root = root.join("cache");
        let checkout_dir = cache_root.join("checkout-def456");
        let runner = FakeRunner {
            calls: RefCell::new(Vec::new()),
        };
        let provider = GitCliProvider::new(runner);

        let result = provider
            .checkout_to_cache(&GitCheckoutRequest {
                url: "https://github.com/example/metis-skills.git".to_string(),
                ref_: "main".to_string(),
                repo_path: "skills/example".to_string(),
                target_commit: "def456".to_string(),
                cache_dir: cache_root.to_string_lossy().to_string(),
            })
            .expect("checkout should run");

        assert_eq!(result.checkout_dir, checkout_dir.to_string_lossy());
        assert_eq!(
            result.skill_dir,
            checkout_dir
                .join("skills/example")
                .to_string_lossy()
                .to_string()
        );
        assert_eq!(
            provider.runner().calls.borrow().as_slice(),
            &[
                vec![
                    "clone".to_string(),
                    "--no-checkout".to_string(),
                    "https://github.com/example/metis-skills.git".to_string(),
                    checkout_dir.to_string_lossy().to_string(),
                ],
                vec![
                    "-C".to_string(),
                    checkout_dir.to_string_lossy().to_string(),
                    "fetch".to_string(),
                    "origin".to_string(),
                    "main".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    checkout_dir.to_string_lossy().to_string(),
                    "checkout".to_string(),
                    "def456".to_string(),
                ],
            ]
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn real_git_checkout_to_cache_is_idempotent_and_validates_repo_path() {
        let root = temp_dir("real-git-checkout");
        let source_repo = root.join("source");
        let cache_root = root.join("cache");
        fs::create_dir_all(source_repo.join("skills/example"))
            .expect("skill directory should be created");
        write_file(&source_repo.join("skills/example/SKILL.md"), "# Old\n");
        git(&source_repo, &["init"]);
        git(&source_repo, &["add", "."]);
        git_commit(&source_repo, "initial skill");
        write_file(&source_repo.join("skills/example/SKILL.md"), "# New\n");
        git(&source_repo, &["add", "."]);
        let target_commit = git_commit(&source_repo, "updated skill");
        let provider = GitCliProvider::new(SystemGitRunner);

        let request = GitCheckoutRequest {
            url: source_repo.to_string_lossy().to_string(),
            ref_: "HEAD".to_string(),
            repo_path: "skills/example".to_string(),
            target_commit,
            cache_dir: cache_root.to_string_lossy().to_string(),
        };
        let first = provider
            .checkout_to_cache(&request)
            .expect("first checkout should succeed");
        let second = provider
            .checkout_to_cache(&request)
            .expect("second checkout should reuse existing cache");

        assert_eq!(second.checkout_dir, first.checkout_dir);
        assert_eq!(
            fs::read_to_string(Path::new(&second.skill_dir).join("SKILL.md"))
                .expect("checked out skill should read"),
            "# New\n"
        );

        let mut missing_path_request = request;
        missing_path_request.repo_path = "skills/missing".to_string();
        let error = provider
            .checkout_to_cache(&missing_path_request)
            .expect_err("missing repo_path should fail clearly");
        assert!(matches!(error, GitProviderError::PathNotFound { .. }));

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("metis-git-provider-{name}-{suffix}"));
        fs::create_dir_all(&root).expect("temp directory should be created");
        root
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent directory should be created");
        }
        fs::write(path, contents).expect("file should be written");
    }

    fn git(repo: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .expect("git should run");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn git_commit(repo: &Path, message: &str) -> String {
        git(
            repo,
            &[
                "-c",
                "user.name=Metis Tests",
                "-c",
                "user.email=metis@example.invalid",
                "commit",
                "-m",
                message,
            ],
        );
        git(repo, &["rev-parse", "HEAD"])
    }
}
