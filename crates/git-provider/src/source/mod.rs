use crate::fetch::{GitCliProvider, GitCommandRunner, GitProviderError};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;

const CHECKOUT_CACHE_RETAIN_COUNT: usize = 20;
const CHECKOUT_CACHE_METADATA_FILE: &str = ".metis-checkout-cache";

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
        let total_start = Instant::now();
        validate_repo_path(&request.repo_path)?;

        fs::create_dir_all(&request.cache_dir).map_err(|error| {
            GitProviderError::CommandFailed {
                command: format!("create cache dir {}", request.cache_dir),
                stderr: error.to_string(),
            }
        })?;

        let checkout_dir = cache_checkout_dir(request);
        let checkout_dir_text = checkout_dir.to_string_lossy().to_string();
        let cache_exists = checkout_dir.exists();
        perf_log(
            "checkout",
            &[
                ("stage", "start".to_string()),
                ("repo_path", request.repo_path.clone()),
                ("ref", request.ref_.clone()),
                ("cache_hit", cache_exists.to_string()),
            ],
        );

        if cache_exists {
            let remote_start = Instant::now();
            self.runner().run_git(&[
                "-C",
                &checkout_dir_text,
                "remote",
                "set-url",
                "origin",
                &request.url,
            ])?;
            perf_log(
                "checkout",
                &[
                    ("stage", "remote_set_url".to_string()),
                    ("elapsed_ms", elapsed_ms(remote_start)),
                    ("cache_hit", "true".to_string()),
                ],
            );
        } else {
            let reference_checkout =
                find_reference_checkout_dir(Path::new(&request.cache_dir), &checkout_dir, request)?;
            let reference_checkout_text = reference_checkout
                .as_ref()
                .map(|path| path.to_string_lossy().to_string());
            let mut clone_args = vec![
                "clone".to_string(),
                "--filter=blob:none".to_string(),
                "--no-checkout".to_string(),
            ];
            if let Some(reference) = &reference_checkout_text {
                clone_args.push("--reference-if-able".to_string());
                clone_args.push(reference.clone());
            }
            clone_args.push(request.url.clone());
            clone_args.push(checkout_dir_text.clone());
            let clone_arg_refs = clone_args.iter().map(String::as_str).collect::<Vec<_>>();
            let clone_start = Instant::now();
            self.runner().run_git(&clone_arg_refs)?;
            perf_log(
                "checkout",
                &[
                    ("stage", "clone".to_string()),
                    ("elapsed_ms", elapsed_ms(clone_start)),
                    ("cache_hit", "false".to_string()),
                    (
                        "reference_used",
                        reference_checkout_text.is_some().to_string(),
                    ),
                ],
            );
        }
        if should_use_sparse_checkout(&request.repo_path) {
            let sparse_start = Instant::now();
            self.runner().run_git(&[
                "-C",
                &checkout_dir_text,
                "sparse-checkout",
                "init",
                "--cone",
            ])?;
            self.runner().run_git(&[
                "-C",
                &checkout_dir_text,
                "sparse-checkout",
                "set",
                &request.repo_path,
            ])?;
            perf_log(
                "checkout",
                &[
                    ("stage", "sparse_checkout".to_string()),
                    ("elapsed_ms", elapsed_ms(sparse_start)),
                    ("repo_path", request.repo_path.clone()),
                ],
            );
        }
        let local_checkout_start = Instant::now();
        match self
            .runner()
            .run_git(&["-C", &checkout_dir_text, "checkout", &request.target_commit])
        {
            Ok(_) => {
                perf_log(
                    "checkout",
                    &[
                        ("stage", "checkout".to_string()),
                        ("elapsed_ms", elapsed_ms(local_checkout_start)),
                        ("cache_hit", cache_exists.to_string()),
                        ("fetch_fallback", "false".to_string()),
                    ],
                );
            }
            Err(_) => {
                perf_log(
                    "checkout",
                    &[
                        ("stage", "checkout".to_string()),
                        ("elapsed_ms", elapsed_ms(local_checkout_start)),
                        ("cache_hit", cache_exists.to_string()),
                        ("fetch_fallback", "true".to_string()),
                    ],
                );
                let fetch_start = Instant::now();
                self.runner().run_git(&[
                    "-C",
                    &checkout_dir_text,
                    "fetch",
                    "origin",
                    &request.ref_,
                ])?;
                perf_log(
                    "checkout",
                    &[
                        ("stage", "fetch".to_string()),
                        ("elapsed_ms", elapsed_ms(fetch_start)),
                        ("ref", request.ref_.clone()),
                        ("fetch_fallback", "true".to_string()),
                    ],
                );
                let retry_checkout_start = Instant::now();
                self.runner().run_git(&[
                    "-C",
                    &checkout_dir_text,
                    "checkout",
                    &request.target_commit,
                ])?;
                perf_log(
                    "checkout",
                    &[
                        ("stage", "checkout_retry".to_string()),
                        ("elapsed_ms", elapsed_ms(retry_checkout_start)),
                        ("fetch_fallback", "true".to_string()),
                    ],
                );
            }
        }

        let skill_dir = checkout_dir.join(&request.repo_path);
        if !skill_dir.is_dir() {
            return Err(GitProviderError::PathNotFound {
                path: skill_dir.to_string_lossy().to_string(),
            });
        }
        write_checkout_metadata(&checkout_dir, request)?;
        prune_checkout_cache_dirs(Path::new(&request.cache_dir), &checkout_dir)?;
        perf_log(
            "checkout",
            &[
                ("stage", "total".to_string()),
                ("elapsed_ms", elapsed_ms(total_start)),
                ("repo_path", request.repo_path.clone()),
                ("cache_hit", cache_exists.to_string()),
            ],
        );

        Ok(GitCheckoutResult {
            checkout_dir: checkout_dir_text,
            skill_dir: skill_dir.to_string_lossy().to_string(),
        })
    }
}

fn find_reference_checkout_dir(
    cache_dir: &Path,
    current_checkout_dir: &Path,
    request: &GitCheckoutRequest,
) -> Result<Option<PathBuf>, GitProviderError> {
    let entries = match fs::read_dir(cache_dir) {
        Ok(entries) => entries,
        Err(error) => {
            return Err(GitProviderError::CommandFailed {
                command: format!("read cache dir {}", cache_dir.to_string_lossy()),
                stderr: error.to_string(),
            });
        }
    };
    let reference_key = checkout_reference_key(request);
    let mut candidates = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && path != current_checkout_dir)
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("checkout-"))
        })
        .filter(|path| path.join(".git").exists())
        .filter(|path| {
            checkout_metadata_reference_key(path).as_deref() == Some(&reference_key)
                || legacy_checkout_matches_reference(path, request)
        })
        .collect::<Vec<_>>();
    candidates.sort();
    Ok(candidates.into_iter().next())
}

fn legacy_checkout_matches_reference(checkout_dir: &Path, request: &GitCheckoutRequest) -> bool {
    let expected_prefix = format!("checkout-{}-", sanitize_commit(&request.target_commit));
    checkout_dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(&expected_prefix))
        && checkout_origin_url(checkout_dir).as_deref() == Some(request.url.as_str())
}

fn checkout_origin_url(checkout_dir: &Path) -> Option<String> {
    let contents = fs::read_to_string(checkout_dir.join(".git/config")).ok()?;
    let mut in_origin = false;
    for line in contents.lines().map(str::trim) {
        if line.starts_with('[') {
            in_origin = line == "[remote \"origin\"]";
            continue;
        }
        if !in_origin {
            continue;
        }
        if let Some(value) = line.strip_prefix("url") {
            let value = value.trim_start();
            if let Some(url) = value.strip_prefix('=') {
                let url = url.trim();
                if !url.is_empty() {
                    return Some(url.to_string());
                }
            }
        }
    }
    None
}

fn write_checkout_metadata(
    checkout_dir: &Path,
    request: &GitCheckoutRequest,
) -> Result<(), GitProviderError> {
    fs::write(
        checkout_dir.join(CHECKOUT_CACHE_METADATA_FILE),
        format!(
            "version=1\nreference_key={}\n",
            checkout_reference_key(request)
        ),
    )
    .map_err(|error| GitProviderError::CommandFailed {
        command: format!("write checkout metadata {}", checkout_dir.to_string_lossy()),
        stderr: error.to_string(),
    })
}

fn checkout_metadata_reference_key(checkout_dir: &Path) -> Option<String> {
    let contents = fs::read_to_string(checkout_dir.join(CHECKOUT_CACHE_METADATA_FILE)).ok()?;
    contents.lines().find_map(|line| {
        line.strip_prefix("reference_key=")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn checkout_reference_key(request: &GitCheckoutRequest) -> String {
    format!(
        "{:016x}",
        stable_hash_values(&[
            request.url.as_str(),
            request.ref_.as_str(),
            request.target_commit.as_str(),
        ])
    )
}

fn stable_hash_values(values: &[&str]) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for value in values {
        for byte in value.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn elapsed_ms(start: Instant) -> String {
    start.elapsed().as_millis().to_string()
}

fn perf_log(scope: &str, fields: &[(&str, String)]) {
    eprintln!("{}", perf_log_line(scope, fields));
}

fn perf_log_line(scope: &str, fields: &[(&str, String)]) -> String {
    let mut line = format!("[metis perf] {scope}");
    for (key, value) in fields {
        line.push(' ');
        line.push_str(key);
        line.push('=');
        line.push_str(value);
    }
    line
}

fn cache_checkout_dir(request: &GitCheckoutRequest) -> PathBuf {
    PathBuf::from(&request.cache_dir).join(format!(
        "checkout-{}-{:016x}",
        sanitize_commit(&request.target_commit),
        stable_cache_hash(request)
    ))
}

fn stable_cache_hash(request: &GitCheckoutRequest) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for value in [
        request.url.as_str(),
        request.ref_.as_str(),
        request.repo_path.as_str(),
        request.target_commit.as_str(),
    ] {
        for byte in value.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn should_use_sparse_checkout(repo_path: &str) -> bool {
    let trimmed = repo_path.trim();
    !trimmed.is_empty() && trimmed != "."
}

fn prune_checkout_cache_dirs(
    cache_dir: &Path,
    current_checkout_dir: &Path,
) -> Result<(), GitProviderError> {
    let entries = match fs::read_dir(cache_dir) {
        Ok(entries) => entries,
        Err(error) => {
            return Err(GitProviderError::CommandFailed {
                command: format!("read cache dir {}", cache_dir.to_string_lossy()),
                stderr: error.to_string(),
            });
        }
    };
    let mut checkout_dirs = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("checkout-"))
        })
        .collect::<Vec<_>>();

    if checkout_dirs.len() <= CHECKOUT_CACHE_RETAIN_COUNT {
        return Ok(());
    }

    checkout_dirs.sort_by(|left, right| {
        let left_modified = left
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok();
        let right_modified = right
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok();
        left_modified
            .cmp(&right_modified)
            .then_with(|| left.file_name().cmp(&right.file_name()))
    });

    let remove_count = checkout_dirs.len() - CHECKOUT_CACHE_RETAIN_COUNT;
    for path in checkout_dirs
        .into_iter()
        .filter(|path| path != current_checkout_dir)
        .take(remove_count)
    {
        fs::remove_dir_all(&path).map_err(|error| GitProviderError::CommandFailed {
            command: format!("remove cache dir {}", path.to_string_lossy()),
            stderr: error.to_string(),
        })?;
    }

    Ok(())
}

fn validate_repo_path(repo_path: &str) -> Result<(), GitProviderError> {
    let path = Path::new(repo_path);
    if path.components().any(|component| {
        matches!(
            component,
            Component::Prefix(_) | Component::RootDir | Component::ParentDir
        )
    }) {
        return Err(GitProviderError::InvalidRepoPath {
            repo_path: repo_path.to_string(),
        });
    }
    Ok(())
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
                if let Some(checkout_dir) = args.last() {
                    fs::create_dir_all(Path::new(checkout_dir).join(".git"))
                        .expect("fake git directory should be created");
                    fs::create_dir_all(Path::new(checkout_dir).join("skills/example"))
                        .expect("fake checkout skill dir should be created");
                    fs::create_dir_all(Path::new(checkout_dir).join("skills/other"))
                        .expect("fake alternate skill dir should be created");
                }
            }
            Ok(GitCommandOutput {
                stdout: String::new(),
                stderr: String::new(),
            })
        }
    }

    struct CheckoutFallbackRunner {
        calls: RefCell<Vec<Vec<String>>>,
        fail_next_checkout: RefCell<bool>,
    }

    impl GitCommandRunner for CheckoutFallbackRunner {
        fn run_git(&self, args: &[&str]) -> Result<GitCommandOutput, GitProviderError> {
            self.calls
                .borrow_mut()
                .push(args.iter().map(|arg| arg.to_string()).collect());
            if args.contains(&"checkout") && *self.fail_next_checkout.borrow() {
                *self.fail_next_checkout.borrow_mut() = false;
                return Err(GitProviderError::CommandFailed {
                    command: "git checkout".to_string(),
                    stderr: "missing object".to_string(),
                });
            }
            Ok(GitCommandOutput {
                stdout: String::new(),
                stderr: String::new(),
            })
        }
    }

    #[test]
    fn checkout_to_cache_clones_and_checks_out_target_commit_without_fetching_first() {
        let root = temp_dir("fake-checkout");
        let cache_root = root.join("cache");
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
        let checkout_dir_text = result.checkout_dir.clone();

        assert!(result.checkout_dir.contains("checkout-def456-"));
        assert_eq!(
            result.skill_dir,
            Path::new(&checkout_dir_text)
                .join("skills/example")
                .to_string_lossy()
                .to_string()
        );
        assert_eq!(
            provider.runner().calls.borrow().as_slice(),
            &[
                vec![
                    "clone".to_string(),
                    "--filter=blob:none".to_string(),
                    "--no-checkout".to_string(),
                    "https://github.com/example/metis-skills.git".to_string(),
                    checkout_dir_text.clone(),
                ],
                vec![
                    "-C".to_string(),
                    checkout_dir_text.clone(),
                    "sparse-checkout".to_string(),
                    "init".to_string(),
                    "--cone".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    checkout_dir_text.clone(),
                    "sparse-checkout".to_string(),
                    "set".to_string(),
                    "skills/example".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    checkout_dir_text.clone(),
                    "checkout".to_string(),
                    "def456".to_string(),
                ],
            ]
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn checkout_to_cache_uses_reference_clone_for_same_source_commit_and_ref() {
        let root = temp_dir("reference-clone");
        let cache_root = root.join("cache");
        let runner = FakeRunner {
            calls: RefCell::new(Vec::new()),
        };
        let provider = GitCliProvider::new(runner);
        let first = provider
            .checkout_to_cache(&GitCheckoutRequest {
                url: "https://github.com/example/metis-skills.git".to_string(),
                ref_: "main".to_string(),
                repo_path: "skills/example".to_string(),
                target_commit: "def456".to_string(),
                cache_dir: cache_root.to_string_lossy().to_string(),
            })
            .expect("first checkout should run");
        provider.runner().calls.borrow_mut().clear();

        let second = provider
            .checkout_to_cache(&GitCheckoutRequest {
                url: "https://github.com/example/metis-skills.git".to_string(),
                ref_: "main".to_string(),
                repo_path: "skills/other".to_string(),
                target_commit: "def456".to_string(),
                cache_dir: cache_root.to_string_lossy().to_string(),
            })
            .expect("second checkout should reuse existing objects");

        assert_ne!(first.checkout_dir, second.checkout_dir);
        assert_eq!(
            provider.runner().calls.borrow().as_slice(),
            &[
                vec![
                    "clone".to_string(),
                    "--filter=blob:none".to_string(),
                    "--no-checkout".to_string(),
                    "--reference-if-able".to_string(),
                    first.checkout_dir.clone(),
                    "https://github.com/example/metis-skills.git".to_string(),
                    second.checkout_dir.clone(),
                ],
                vec![
                    "-C".to_string(),
                    second.checkout_dir.clone(),
                    "sparse-checkout".to_string(),
                    "init".to_string(),
                    "--cone".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    second.checkout_dir.clone(),
                    "sparse-checkout".to_string(),
                    "set".to_string(),
                    "skills/other".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    second.checkout_dir,
                    "checkout".to_string(),
                    "def456".to_string(),
                ],
            ]
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn checkout_to_cache_uses_legacy_same_source_checkout_as_reference() {
        let root = temp_dir("legacy-reference-clone");
        let cache_root = root.join("cache");
        let legacy_request = GitCheckoutRequest {
            url: "https://github.com/example/metis-skills.git".to_string(),
            ref_: "main".to_string(),
            repo_path: "skills/example".to_string(),
            target_commit: "def456".to_string(),
            cache_dir: cache_root.to_string_lossy().to_string(),
        };
        let legacy_checkout_dir = cache_checkout_dir(&legacy_request);
        write_file(
            &legacy_checkout_dir.join(".git/config"),
            "[remote \"origin\"]\n\turl = https://github.com/example/metis-skills.git\n",
        );
        let runner = FakeRunner {
            calls: RefCell::new(Vec::new()),
        };
        let provider = GitCliProvider::new(runner);

        let second = provider
            .checkout_to_cache(&GitCheckoutRequest {
                url: "https://github.com/example/metis-skills.git".to_string(),
                ref_: "main".to_string(),
                repo_path: "skills/other".to_string(),
                target_commit: "def456".to_string(),
                cache_dir: cache_root.to_string_lossy().to_string(),
            })
            .expect("new checkout should reference legacy checkout objects");

        assert_eq!(
            provider.runner().calls.borrow().first(),
            Some(&vec![
                "clone".to_string(),
                "--filter=blob:none".to_string(),
                "--no-checkout".to_string(),
                "--reference-if-able".to_string(),
                legacy_checkout_dir.to_string_lossy().to_string(),
                "https://github.com/example/metis-skills.git".to_string(),
                second.checkout_dir,
            ])
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn checkout_to_cache_namespaces_same_commit_by_source_and_repo_path() {
        let root = temp_dir("namespaced-cache");
        let cache_root = root.join("cache");
        let runner = FakeRunner {
            calls: RefCell::new(Vec::new()),
        };
        let provider = GitCliProvider::new(runner);
        let mut request = GitCheckoutRequest {
            url: "https://github.com/example/metis-skills.git".to_string(),
            ref_: "main".to_string(),
            repo_path: "skills/example".to_string(),
            target_commit: "def456".to_string(),
            cache_dir: cache_root.to_string_lossy().to_string(),
        };

        let first = provider
            .checkout_to_cache(&request)
            .expect("first checkout should run");
        request.url = "https://github.com/other/metis-skills.git".to_string();
        let second = provider
            .checkout_to_cache(&request)
            .expect("same commit from another source should run");

        assert_ne!(first.checkout_dir, second.checkout_dir);
        assert!(first.checkout_dir.contains("checkout-def456-"));
        assert!(second.checkout_dir.contains("checkout-def456-"));
        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn checkout_to_cache_reuses_existing_cache_without_fetching_first() {
        let root = temp_dir("existing-cache-no-fetch");
        let cache_root = root.join("cache");
        let runner = FakeRunner {
            calls: RefCell::new(Vec::new()),
        };
        let provider = GitCliProvider::new(runner);
        let request = GitCheckoutRequest {
            url: "https://github.com/example/metis-skills.git".to_string(),
            ref_: "main".to_string(),
            repo_path: "skills/example".to_string(),
            target_commit: "def456".to_string(),
            cache_dir: cache_root.to_string_lossy().to_string(),
        };
        let first = provider
            .checkout_to_cache(&request)
            .expect("first checkout should create the cache");
        provider.runner().calls.borrow_mut().clear();

        let second = provider
            .checkout_to_cache(&request)
            .expect("second checkout should reuse cache");

        assert_eq!(second.checkout_dir, first.checkout_dir);
        assert_eq!(
            provider.runner().calls.borrow().as_slice(),
            &[
                vec![
                    "-C".to_string(),
                    first.checkout_dir.clone(),
                    "remote".to_string(),
                    "set-url".to_string(),
                    "origin".to_string(),
                    "https://github.com/example/metis-skills.git".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    first.checkout_dir.clone(),
                    "sparse-checkout".to_string(),
                    "init".to_string(),
                    "--cone".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    first.checkout_dir.clone(),
                    "sparse-checkout".to_string(),
                    "set".to_string(),
                    "skills/example".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    first.checkout_dir,
                    "checkout".to_string(),
                    "def456".to_string(),
                ],
            ]
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn checkout_to_cache_fetches_when_existing_cache_checkout_misses_commit() {
        let root = temp_dir("existing-cache-fetch-fallback");
        let cache_root = root.join("cache");
        let request = GitCheckoutRequest {
            url: "https://github.com/example/metis-skills.git".to_string(),
            ref_: "main".to_string(),
            repo_path: "skills/example".to_string(),
            target_commit: "def456".to_string(),
            cache_dir: cache_root.to_string_lossy().to_string(),
        };
        let checkout_dir = cache_checkout_dir(&request);
        fs::create_dir_all(checkout_dir.join("skills/example"))
            .expect("existing checkout cache should be created");
        let checkout_dir_text = checkout_dir.to_string_lossy().to_string();
        let runner = CheckoutFallbackRunner {
            calls: RefCell::new(Vec::new()),
            fail_next_checkout: RefCell::new(true),
        };
        let provider = GitCliProvider::new(runner);

        provider
            .checkout_to_cache(&request)
            .expect("checkout should fetch and retry when local object is missing");

        assert_eq!(
            provider.runner().calls.borrow().as_slice(),
            &[
                vec![
                    "-C".to_string(),
                    checkout_dir_text.clone(),
                    "remote".to_string(),
                    "set-url".to_string(),
                    "origin".to_string(),
                    "https://github.com/example/metis-skills.git".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    checkout_dir_text.clone(),
                    "sparse-checkout".to_string(),
                    "init".to_string(),
                    "--cone".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    checkout_dir_text.clone(),
                    "sparse-checkout".to_string(),
                    "set".to_string(),
                    "skills/example".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    checkout_dir_text.clone(),
                    "checkout".to_string(),
                    "def456".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    checkout_dir_text.clone(),
                    "fetch".to_string(),
                    "origin".to_string(),
                    "main".to_string(),
                ],
                vec![
                    "-C".to_string(),
                    checkout_dir_text,
                    "checkout".to_string(),
                    "def456".to_string(),
                ],
            ]
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn checkout_to_cache_prunes_old_checkout_cache_dirs() {
        let root = temp_dir("cache-prune");
        let cache_root = root.join("cache");
        fs::create_dir_all(&cache_root).expect("cache root should be created");
        for index in 0..25 {
            fs::create_dir_all(cache_root.join(format!("checkout-old-{index:02}")))
                .expect("old checkout dir should be created");
        }
        fs::create_dir_all(cache_root.join("other-cache-dir"))
            .expect("non checkout cache dir should be created");
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

        let checkout_dirs = fs::read_dir(&cache_root)
            .expect("cache root should read")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().starts_with("checkout-"))
            .count();
        assert_eq!(checkout_dirs, 20);
        assert!(Path::new(&result.checkout_dir).is_dir());
        assert!(cache_root.join("other-cache-dir").is_dir());
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

    #[test]
    fn checkout_to_cache_rejects_repo_path_escape() {
        let root = temp_dir("repo-path-escape");
        let source_repo = root.join("source");
        let cache_root = root.join("cache");
        fs::create_dir_all(source_repo.join("skills/example"))
            .expect("skill directory should be created");
        write_file(&source_repo.join("skills/example/SKILL.md"), "# Example\n");
        git(&source_repo, &["init"]);
        git(&source_repo, &["add", "."]);
        let target_commit = git_commit(&source_repo, "initial skill");
        fs::create_dir_all(cache_root.join("outside")).expect("outside dir should exist");
        write_file(&cache_root.join("outside/SKILL.md"), "# Outside\n");
        let provider = GitCliProvider::new(SystemGitRunner);

        let error = provider
            .checkout_to_cache(&GitCheckoutRequest {
                url: source_repo.to_string_lossy().to_string(),
                ref_: "HEAD".to_string(),
                repo_path: "../outside".to_string(),
                target_commit,
                cache_dir: cache_root.to_string_lossy().to_string(),
            })
            .expect_err("repo_path should not escape checkout dir");

        assert!(error.to_string().contains("repo_path"));
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
