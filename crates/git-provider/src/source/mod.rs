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

        self.runner()
            .run_git(&["clone", "--no-checkout", &request.url, &checkout_dir_text])?;
        self.runner()
            .run_git(&["-C", &checkout_dir_text, "fetch", "origin", &request.ref_])?;
        self.runner()
            .run_git(&["-C", &checkout_dir_text, "checkout", &request.target_commit])?;

        let skill_dir = checkout_dir.join(&request.repo_path);

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
    use crate::fetch::{GitCommandOutput, GitCommandRunner, GitProviderError};
    use std::cell::RefCell;

    struct FakeRunner {
        calls: RefCell<Vec<Vec<String>>>,
    }

    impl GitCommandRunner for FakeRunner {
        fn run_git(&self, args: &[&str]) -> Result<GitCommandOutput, GitProviderError> {
            self.calls
                .borrow_mut()
                .push(args.iter().map(|arg| arg.to_string()).collect());
            Ok(GitCommandOutput {
                stdout: String::new(),
                stderr: String::new(),
            })
        }
    }

    #[test]
    fn checkout_to_cache_clones_fetches_and_checks_out_target_commit() {
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
                cache_dir: "/tmp/metis-cache".to_string(),
            })
            .expect("checkout should run");

        assert_eq!(
            result.checkout_dir,
            "/tmp/metis-cache/checkout-def456".to_string()
        );
        assert_eq!(
            result.skill_dir,
            "/tmp/metis-cache/checkout-def456/skills/example".to_string()
        );
        assert_eq!(
            provider.runner().calls.borrow().as_slice(),
            &[
                vec![
                    "clone".to_string(),
                    "--no-checkout".to_string(),
                    "https://github.com/example/metis-skills.git".to_string(),
                    "/tmp/metis-cache/checkout-def456".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    "/tmp/metis-cache/checkout-def456".to_string(),
                    "fetch".to_string(),
                    "origin".to_string(),
                    "main".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    "/tmp/metis-cache/checkout-def456".to_string(),
                    "checkout".to_string(),
                    "def456".to_string(),
                ],
            ]
        );
    }
}
