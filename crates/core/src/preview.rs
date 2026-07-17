use crate::update::RemoteCommitChecker;
use metis_adapters::standard::parse_standard_skill_metadata;
use metis_git_provider::source::{git_source_log_key, repo_path_depth};
use metis_storage::db::SourceRecord;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Instant;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewRemoteSkillSourceOptions {
    pub url: String,
    pub repo_path: String,
    pub ref_: String,
    pub cache_dir: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteSkillPreview {
    pub name: String,
    pub description: Option<String>,
    pub install_name: String,
    pub commit: String,
    pub repo_path: String,
    pub ref_: String,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PreviewRemoteSkillSourceError {
    #[error("authentication failed: {0}")]
    AuthenticationFailed(String),

    #[error("repo path not found: {repo_path}")]
    RepoPathNotFound { repo_path: String },

    #[error("not a skill directory: {repo_path}")]
    NotSkillDirectory { repo_path: String },

    #[error("metadata parse failed: {0}")]
    MetadataParseFailed(String),

    #[error("git operation failed: {0}")]
    GitOperationFailed(String),
}

pub fn preview_remote_skill_source<C: RemoteCommitChecker>(
    options: PreviewRemoteSkillSourceOptions,
    checker: &C,
) -> Result<RemoteSkillPreview, PreviewRemoteSkillSourceError> {
    let total_start = Instant::now();
    let normalized_repo_path = normalize_repo_path(&options.repo_path);
    let source_start = Instant::now();
    let (source, commit) = preview_source_with_commit(&options, &normalized_repo_path, checker)?;
    let source_key = git_source_log_key(&source.url, &normalized_repo_path, &source.ref_);
    let path_depth = repo_path_depth(&normalized_repo_path).to_string();
    perf_log(
        "preview",
        &[
            ("stage", "source_commit".to_string()),
            ("elapsed_ms", elapsed_ms(source_start)),
            ("source_key", source_key.clone()),
            ("repo_path_depth", path_depth.clone()),
            ("ref_present", (!source.ref_.trim().is_empty()).to_string()),
        ],
    );
    let checkout_start = Instant::now();
    let checkout = checker
        .checkout_to_cache(&source, &commit, &options.cache_dir)
        .map_err(|reason| classify_checkout_failure(reason, &normalized_repo_path))?;
    perf_log(
        "preview",
        &[
            ("stage", "checkout_to_cache".to_string()),
            ("elapsed_ms", elapsed_ms(checkout_start)),
            ("source_key", source_key.clone()),
            ("repo_path_depth", path_depth.clone()),
        ],
    );
    let skill_dir = Path::new(&checkout.skill_dir);

    if !skill_dir.join("SKILL.md").is_file() {
        return Err(PreviewRemoteSkillSourceError::NotSkillDirectory {
            repo_path: normalized_repo_path,
        });
    }

    let metadata_start = Instant::now();
    let metadata = parse_standard_skill_metadata(&checkout.skill_dir)
        .map_err(|error| PreviewRemoteSkillSourceError::MetadataParseFailed(error.to_string()))?;
    let install_name = install_name_for_repo_path(&normalized_repo_path, &metadata.name);
    perf_log(
        "preview",
        &[
            ("stage", "metadata".to_string()),
            ("elapsed_ms", elapsed_ms(metadata_start)),
            ("source_key", source_key.clone()),
            ("repo_path_depth", path_depth.clone()),
        ],
    );
    perf_log(
        "preview",
        &[
            ("stage", "total".to_string()),
            ("elapsed_ms", elapsed_ms(total_start)),
            ("source_key", source_key),
            ("repo_path_depth", path_depth),
            ("ref_present", (!source.ref_.trim().is_empty()).to_string()),
        ],
    );

    Ok(RemoteSkillPreview {
        name: metadata.name,
        description: metadata.description,
        install_name,
        commit,
        repo_path: normalized_repo_path,
        ref_: source.ref_,
    })
}

fn preview_source_with_commit<C: RemoteCommitChecker>(
    options: &PreviewRemoteSkillSourceOptions,
    normalized_repo_path: &str,
    checker: &C,
) -> Result<(SourceRecord, String), PreviewRemoteSkillSourceError> {
    let mut last_error = None;
    for candidate in preview_ref_candidates(&options.ref_, &options.url, checker) {
        let source = preview_source_record(options, normalized_repo_path, &candidate.ref_);
        let source_key = git_source_log_key(&source.url, normalized_repo_path, &source.ref_);
        let reused_head_commit = candidate.commit.is_some();
        let commit_start = Instant::now();
        let commit_result = candidate
            .commit
            .clone()
            .map(Ok)
            .unwrap_or_else(|| checker.remote_commit(&source));
        perf_log(
            "preview",
            &[
                ("stage", "commit".to_string()),
                ("elapsed_ms", elapsed_ms(commit_start)),
                ("source_key", source_key),
                (
                    "repo_path_depth",
                    repo_path_depth(normalized_repo_path).to_string(),
                ),
                ("ref_present", (!source.ref_.trim().is_empty()).to_string()),
                ("reused_head_commit", reused_head_commit.to_string()),
            ],
        );
        match commit_result {
            Ok(commit) => return Ok((source, commit)),
            Err(error) => last_error = Some(error),
        }
    }

    Err(classify_git_failure(
        last_error.unwrap_or_else(|| "remote ref not found".to_string()),
    ))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreviewRefCandidate {
    ref_: String,
    commit: Option<String>,
}

fn preview_ref_candidates<C: RemoteCommitChecker>(
    ref_: &str,
    url: &str,
    checker: &C,
) -> Vec<PreviewRefCandidate> {
    let trimmed = ref_.trim();
    if !trimmed.is_empty() {
        return vec![PreviewRefCandidate {
            ref_: trimmed.to_string(),
            commit: None,
        }];
    }

    let mut candidates = Vec::new();
    let default_start = Instant::now();
    if let Ok(default_branch) = checker.remote_default_branch(url) {
        perf_log(
            "preview",
            &[
                ("stage", "default_branch".to_string()),
                ("elapsed_ms", elapsed_ms(default_start)),
                ("has_default_branch", "true".to_string()),
                (
                    "has_head_commit",
                    default_branch.commit.is_some().to_string(),
                ),
            ],
        );
        push_ref_candidate(
            &mut candidates,
            default_branch.branch.trim(),
            default_branch.commit,
        );
    } else {
        perf_log(
            "preview",
            &[
                ("stage", "default_branch".to_string()),
                ("elapsed_ms", elapsed_ms(default_start)),
                ("status", "fallback".to_string()),
            ],
        );
    }
    push_ref_candidate(&mut candidates, "main", None);
    push_ref_candidate(&mut candidates, "master", None);
    candidates
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

fn push_ref_candidate(
    candidates: &mut Vec<PreviewRefCandidate>,
    ref_: &str,
    commit: Option<String>,
) {
    if !ref_.is_empty() && !candidates.iter().any(|candidate| candidate.ref_ == ref_) {
        candidates.push(PreviewRefCandidate {
            ref_: ref_.to_string(),
            commit,
        });
    }
}

fn preview_source_record(
    options: &PreviewRemoteSkillSourceOptions,
    normalized_repo_path: &str,
    ref_: &str,
) -> SourceRecord {
    SourceRecord {
        id: "remote-preview".to_string(),
        source_type: "git".to_string(),
        url: options.url.clone(),
        repo_path: if normalized_repo_path == "." {
            String::new()
        } else {
            normalized_repo_path.to_string()
        },
        ref_: ref_.to_string(),
        current_commit: None,
        remote_commit: None,
        last_checked_at: None,
        trusted: false,
        auto_update: false,
        credential_ref: None,
        created_at: None,
        updated_at: None,
    }
}

fn normalize_repo_path(repo_path: &str) -> String {
    let trimmed = repo_path.trim();
    if trimmed.is_empty() {
        ".".to_string()
    } else {
        trimmed.to_string()
    }
}

fn install_name_for_repo_path(repo_path: &str, skill_name: &str) -> String {
    if repo_path == "." {
        return skill_name.to_string();
    }
    Path::new(repo_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| skill_name.to_string())
}

fn classify_git_failure(reason: String) -> PreviewRemoteSkillSourceError {
    if looks_like_authentication_failure(&reason) {
        PreviewRemoteSkillSourceError::AuthenticationFailed(reason)
    } else {
        PreviewRemoteSkillSourceError::GitOperationFailed(reason)
    }
}

fn classify_checkout_failure(reason: String, repo_path: &str) -> PreviewRemoteSkillSourceError {
    let lower = reason.to_ascii_lowercase();
    if looks_like_authentication_failure(&reason) {
        PreviewRemoteSkillSourceError::AuthenticationFailed(reason)
    } else if lower.contains("path not found") || lower.contains("no such file or directory") {
        PreviewRemoteSkillSourceError::RepoPathNotFound {
            repo_path: repo_path.to_string(),
        }
    } else {
        PreviewRemoteSkillSourceError::GitOperationFailed(reason)
    }
}

fn looks_like_authentication_failure(reason: &str) -> bool {
    let lower = reason.to_ascii_lowercase();
    lower.contains("auth")
        || lower.contains("permission denied")
        || lower.contains("could not read username")
        || lower.contains("repository not found")
        || lower.contains("access denied")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::{
        CheckoutResult, DiffDetail, DiffSummary, RemoteCommitChecker, RemoteDefaultBranch,
    };
    use metis_storage::db::SourceRecord;
    use std::cell::RefCell;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct FakePreviewChecker {
        remote_commit: Result<String, String>,
        checkout: Result<CheckoutResult, String>,
    }

    impl RemoteCommitChecker for FakePreviewChecker {
        fn remote_commit(&self, _source: &SourceRecord) -> Result<String, String> {
            self.remote_commit.clone()
        }

        fn diff_summary(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<DiffSummary, String> {
            unreachable!("preview should not ask for diff summary")
        }

        fn commits_behind(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<u32, String> {
            unreachable!("preview should not ask for commits behind")
        }

        fn diff_detail(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<DiffDetail, String> {
            unreachable!("preview should not ask for diff detail")
        }

        fn checkout_to_cache(
            &self,
            _source: &SourceRecord,
            _target_commit: &str,
            _cache_dir: &str,
        ) -> Result<CheckoutResult, String> {
            self.checkout.clone()
        }
    }

    struct RefFallbackPreviewChecker {
        default_branch: Result<RemoteDefaultBranch, String>,
        default_branch_urls: RefCell<Vec<String>>,
        remote_commit_calls: RefCell<Vec<String>>,
        checkout_refs: RefCell<Vec<String>>,
        checkout_commits: RefCell<Vec<String>>,
        checkout: CheckoutResult,
    }

    impl RemoteCommitChecker for RefFallbackPreviewChecker {
        fn remote_default_branch(&self, url: &str) -> Result<RemoteDefaultBranch, String> {
            self.default_branch_urls.borrow_mut().push(url.to_string());
            self.default_branch.clone()
        }

        fn remote_commit(&self, source: &SourceRecord) -> Result<String, String> {
            self.remote_commit_calls
                .borrow_mut()
                .push(source.ref_.clone());
            match source.ref_.as_str() {
                "main" => Ok("main-commit".to_string()),
                other => panic!("unexpected ref fallback candidate: {other}"),
            }
        }

        fn diff_summary(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<DiffSummary, String> {
            unreachable!("preview should not ask for diff summary")
        }

        fn commits_behind(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<u32, String> {
            unreachable!("preview should not ask for commits behind")
        }

        fn diff_detail(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<DiffDetail, String> {
            unreachable!("preview should not ask for diff detail")
        }

        fn checkout_to_cache(
            &self,
            source: &SourceRecord,
            target_commit: &str,
            _cache_dir: &str,
        ) -> Result<CheckoutResult, String> {
            self.checkout_refs.borrow_mut().push(source.ref_.clone());
            self.checkout_commits
                .borrow_mut()
                .push(target_commit.to_string());
            Ok(self.checkout.clone())
        }
    }

    #[test]
    fn preview_remote_skill_source_reads_root_skill_metadata() {
        let root = temp_dir("root-skill");
        let skill_dir = write_skill(&root, "remote-name", "Root skill description");
        let preview = preview_remote_skill_source(
            PreviewRemoteSkillSourceOptions {
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "".to_string(),
                ref_: "main".to_string(),
                cache_dir: root.join("cache").to_string_lossy().to_string(),
            },
            &FakePreviewChecker {
                remote_commit: Ok("abc123".to_string()),
                checkout: Ok(CheckoutResult {
                    checkout_dir: root.to_string_lossy().to_string(),
                    skill_dir: skill_dir.to_string_lossy().to_string(),
                }),
            },
        )
        .expect("root skill preview should succeed");

        assert_eq!(preview.name, "remote-name");
        assert_eq!(
            preview.description.as_deref(),
            Some("Root skill description")
        );
        assert_eq!(preview.install_name, "remote-name");
        assert_eq!(preview.commit, "abc123");
        assert_eq!(preview.repo_path, ".");
        assert_eq!(preview.ref_, "main");
        fs::remove_dir_all(root).expect("temp dir should be removed");
    }

    #[test]
    fn preview_remote_skill_source_reads_child_skill_metadata() {
        let root = temp_dir("child-skill");
        let skill_dir = write_skill(&root.join("skills/example"), "example", "Child skill");
        let preview = preview_remote_skill_source(
            PreviewRemoteSkillSourceOptions {
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/example".to_string(),
                ref_: "main".to_string(),
                cache_dir: root.join("cache").to_string_lossy().to_string(),
            },
            &FakePreviewChecker {
                remote_commit: Ok("def456".to_string()),
                checkout: Ok(CheckoutResult {
                    checkout_dir: root.to_string_lossy().to_string(),
                    skill_dir: skill_dir.to_string_lossy().to_string(),
                }),
            },
        )
        .expect("child skill preview should succeed");

        assert_eq!(preview.name, "example");
        assert_eq!(preview.install_name, "example");
        assert_eq!(preview.commit, "def456");
        assert_eq!(preview.repo_path, "skills/example");
        assert_eq!(preview.ref_, "main");
        fs::remove_dir_all(root).expect("temp dir should be removed");
    }

    #[test]
    fn preview_remote_skill_source_resolves_empty_ref_with_default_fallbacks() {
        let root = temp_dir("default-ref-fallback");
        let skill_dir = write_skill(&root.join("skills/example"), "example", "Child skill");
        let checker = RefFallbackPreviewChecker {
            default_branch: Ok(RemoteDefaultBranch {
                branch: "main".to_string(),
                commit: Some("main-commit".to_string()),
            }),
            default_branch_urls: RefCell::new(Vec::new()),
            remote_commit_calls: RefCell::new(Vec::new()),
            checkout_refs: RefCell::new(Vec::new()),
            checkout_commits: RefCell::new(Vec::new()),
            checkout: CheckoutResult {
                checkout_dir: root.to_string_lossy().to_string(),
                skill_dir: skill_dir.to_string_lossy().to_string(),
            },
        };

        let preview = preview_remote_skill_source(
            PreviewRemoteSkillSourceOptions {
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/example".to_string(),
                ref_: "".to_string(),
                cache_dir: root.join("cache").to_string_lossy().to_string(),
            },
            &checker,
        )
        .expect("empty ref should resolve the remote default branch");

        assert_eq!(
            checker.default_branch_urls.borrow().as_slice(),
            ["https://github.com/example/metis-skills.git"]
        );
        assert!(checker.remote_commit_calls.borrow().is_empty());
        assert_eq!(checker.checkout_refs.borrow().as_slice(), ["main"]);
        assert_eq!(
            checker.checkout_commits.borrow().as_slice(),
            ["main-commit"]
        );
        assert_eq!(preview.ref_, "main");
        assert_eq!(preview.commit, "main-commit");
        fs::remove_dir_all(root).expect("temp dir should be removed");
    }

    #[test]
    fn preview_remote_skill_source_queries_default_ref_commit_when_symref_has_no_commit() {
        let root = temp_dir("default-ref-without-commit");
        let skill_dir = write_skill(&root.join("skills/example"), "example", "Child skill");
        let checker = RefFallbackPreviewChecker {
            default_branch: Ok(RemoteDefaultBranch {
                branch: "main".to_string(),
                commit: None,
            }),
            default_branch_urls: RefCell::new(Vec::new()),
            remote_commit_calls: RefCell::new(Vec::new()),
            checkout_refs: RefCell::new(Vec::new()),
            checkout_commits: RefCell::new(Vec::new()),
            checkout: CheckoutResult {
                checkout_dir: root.to_string_lossy().to_string(),
                skill_dir: skill_dir.to_string_lossy().to_string(),
            },
        };

        let preview = preview_remote_skill_source(
            PreviewRemoteSkillSourceOptions {
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/example".to_string(),
                ref_: "".to_string(),
                cache_dir: root.join("cache").to_string_lossy().to_string(),
            },
            &checker,
        )
        .expect("empty ref should query main when the symref output has no commit");

        assert_eq!(checker.remote_commit_calls.borrow().as_slice(), ["main"]);
        assert_eq!(checker.checkout_refs.borrow().as_slice(), ["main"]);
        assert_eq!(
            checker.checkout_commits.borrow().as_slice(),
            ["main-commit"]
        );
        assert_eq!(preview.ref_, "main");
        assert_eq!(preview.commit, "main-commit");
        fs::remove_dir_all(root).expect("temp dir should be removed");
    }

    #[test]
    fn preview_remote_skill_source_reports_missing_repo_path() {
        let root = temp_dir("missing-path");
        let error = preview_remote_skill_source(
            PreviewRemoteSkillSourceOptions {
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/missing".to_string(),
                ref_: "main".to_string(),
                cache_dir: root.join("cache").to_string_lossy().to_string(),
            },
            &FakePreviewChecker {
                remote_commit: Ok("abc123".to_string()),
                checkout: Err("path not found: /tmp/checkout/skills/missing".to_string()),
            },
        )
        .expect_err("missing repo_path should fail clearly");

        assert_eq!(
            error,
            PreviewRemoteSkillSourceError::RepoPathNotFound {
                repo_path: "skills/missing".to_string()
            }
        );
        fs::remove_dir_all(root).expect("temp dir should be removed");
    }

    #[test]
    fn preview_remote_skill_source_rejects_non_skill_directory() {
        let root = temp_dir("non-skill");
        fs::create_dir_all(root.join("docs")).expect("non skill dir should exist");
        let error = preview_remote_skill_source(
            PreviewRemoteSkillSourceOptions {
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "docs".to_string(),
                ref_: "main".to_string(),
                cache_dir: root.join("cache").to_string_lossy().to_string(),
            },
            &FakePreviewChecker {
                remote_commit: Ok("abc123".to_string()),
                checkout: Ok(CheckoutResult {
                    checkout_dir: root.to_string_lossy().to_string(),
                    skill_dir: root.join("docs").to_string_lossy().to_string(),
                }),
            },
        )
        .expect_err("directory without SKILL.md should fail clearly");

        assert_eq!(
            error,
            PreviewRemoteSkillSourceError::NotSkillDirectory {
                repo_path: "docs".to_string()
            }
        );
        fs::remove_dir_all(root).expect("temp dir should be removed");
    }

    #[test]
    fn preview_remote_skill_source_maps_authentication_failure() {
        let root = temp_dir("auth-failure");
        let error = preview_remote_skill_source(
            PreviewRemoteSkillSourceOptions {
                url: "https://github.com/private/metis-skills.git".to_string(),
                repo_path: "skills/private".to_string(),
                ref_: "main".to_string(),
                cache_dir: root.join("cache").to_string_lossy().to_string(),
            },
            &FakePreviewChecker {
                remote_commit: Err("authentication failed: could not read Username".to_string()),
                checkout: Err("checkout should not run".to_string()),
            },
        )
        .expect_err("authentication failure should be classified");

        assert_eq!(
            error,
            PreviewRemoteSkillSourceError::AuthenticationFailed(
                "authentication failed: could not read Username".to_string()
            )
        );
        fs::remove_dir_all(root).expect("temp dir should be removed");
    }

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("metis-core-preview-{name}-{suffix}"));
        fs::create_dir_all(&root).expect("temp directory should be created");
        root
    }

    fn write_skill(skill_dir: &Path, name: &str, description: &str) -> PathBuf {
        fs::create_dir_all(skill_dir).expect("skill directory should be created");
        fs::write(
            skill_dir.join("SKILL.md"),
            format!(
                "---
name: {name}
description: {description}
---
"
            ),
        )
        .expect("skill metadata should be written");
        skill_dir.to_path_buf()
    }

    #[test]
    fn perf_log_line_uses_searchable_prefix_and_named_fields() {
        let source_key = git_source_log_key(
            "https://git.example.com/example/repository.git",
            "skills/private-example",
            "feature/example",
        );
        let line = perf_log_line(
            "preview",
            &[
                ("stage", "checkout".to_string()),
                ("elapsed_ms", "12".to_string()),
                ("source_key", source_key),
                ("repo_path_depth", "2".to_string()),
            ],
        );

        assert!(line.starts_with("[metis perf] preview stage=checkout elapsed_ms=12 source_key="));
        assert!(line.ends_with(" repo_path_depth=2"));
        assert!(!line.contains("https://"));
        assert!(!line.contains("private-example"));
        assert!(!line.contains("feature/example"));
        let source = include_str!("preview.rs");
        assert!(!source.contains("(\"repo_path\","));
        assert!(!source.contains("(\"ref\","));
    }
}
