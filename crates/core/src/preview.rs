use crate::update::RemoteCommitChecker;
use metis_adapters::standard::parse_standard_skill_metadata;
use metis_storage::db::SourceRecord;
use serde::{Deserialize, Serialize};
use std::path::Path;

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
    let normalized_repo_path = normalize_repo_path(&options.repo_path);
    let source = preview_source_record(&options, &normalized_repo_path);
    let commit = checker
        .remote_commit(&source)
        .map_err(classify_git_failure)?;
    let checkout = checker
        .checkout_to_cache(&source, &commit, &options.cache_dir)
        .map_err(|reason| classify_checkout_failure(reason, &normalized_repo_path))?;
    let skill_dir = Path::new(&checkout.skill_dir);

    if !skill_dir.join("SKILL.md").is_file() {
        return Err(PreviewRemoteSkillSourceError::NotSkillDirectory {
            repo_path: normalized_repo_path,
        });
    }

    let metadata = parse_standard_skill_metadata(&checkout.skill_dir)
        .map_err(|error| PreviewRemoteSkillSourceError::MetadataParseFailed(error.to_string()))?;
    let install_name = install_name_for_repo_path(&normalized_repo_path, &metadata.name);

    Ok(RemoteSkillPreview {
        name: metadata.name,
        description: metadata.description,
        install_name,
        commit,
        repo_path: normalized_repo_path,
    })
}

fn preview_source_record(
    options: &PreviewRemoteSkillSourceOptions,
    normalized_repo_path: &str,
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
        ref_: options.ref_.clone(),
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
    use crate::update::{CheckoutResult, DiffDetail, DiffSummary, RemoteCommitChecker};
    use metis_storage::db::SourceRecord;
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
}
