use crate::local_state::check_local_modification;
use chrono::Utc;
use metis_git_provider::fetch::{GitCliProvider, GitCommandRunner, GitRemoteRef};
use metis_storage::db::{SkillIndexStore, SourceRecord};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateCheckOptions {
    pub skill_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub skill_id: String,
    pub skill_name: String,
    pub source: Option<SourceRecord>,
    pub status: UpdateStatus,
    pub local_modified: bool,
    pub commits_behind: Option<u32>,
    pub diff_summary: Option<DiffSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum UpdateStatus {
    UpToDate,
    UpdateAvailable,
    CheckFailed { reason: String },
    NoSource,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffSummary {
    pub files_added: u32,
    pub files_modified: u32,
    pub files_deleted: u32,
    pub total_changes: u32,
}

pub trait RemoteCommitChecker {
    fn remote_commit(&self, source: &SourceRecord) -> Result<String, String>;
}

impl<R: GitCommandRunner> RemoteCommitChecker for GitCliProvider<R> {
    fn remote_commit(&self, source: &SourceRecord) -> Result<String, String> {
        self.remote_commit(&GitRemoteRef {
            url: source.url.clone(),
            ref_: source.ref_.clone(),
        })
        .map(|commit| commit.commit)
        .map_err(|error| error.to_string())
    }
}

pub fn check_updates<C: RemoteCommitChecker>(
    options: UpdateCheckOptions,
    store: &mut SkillIndexStore,
    checker: &C,
) -> Vec<UpdateCheckResult> {
    options
        .skill_ids
        .iter()
        .map(|skill_id| check_one_update(skill_id, store, checker))
        .collect()
}

fn check_one_update<C: RemoteCommitChecker>(
    skill_id: &str,
    store: &mut SkillIndexStore,
    checker: &C,
) -> UpdateCheckResult {
    let skill = match store.get_skill(skill_id) {
        Ok(Some(skill)) => skill,
        Ok(None) => {
            return failed_result(
                skill_id,
                "",
                None,
                false,
                format!("skill not found: {skill_id}"),
            )
        }
        Err(error) => {
            return failed_result(skill_id, "", None, false, error.to_string());
        }
    };

    let Some(source_id) = skill.source_id.clone() else {
        return UpdateCheckResult {
            skill_id: skill.id,
            skill_name: skill.name,
            source: None,
            status: UpdateStatus::NoSource,
            local_modified: skill.local_modified.unwrap_or(false),
            commits_behind: None,
            diff_summary: None,
        };
    };

    let source = match store.get_source(&source_id) {
        Ok(Some(source)) => source,
        Ok(None) => {
            return failed_result(
                &skill.id,
                &skill.name,
                None,
                skill.local_modified.unwrap_or(false),
                format!("source not found: {source_id}"),
            )
        }
        Err(error) => {
            return failed_result(
                &skill.id,
                &skill.name,
                None,
                skill.local_modified.unwrap_or(false),
                error.to_string(),
            )
        }
    };

    let local_modified = match check_local_modification(&skill.id, store) {
        Ok(result) => result.local_modified,
        Err(error) => {
            return failed_result(
                &skill.id,
                &skill.name,
                Some(source),
                skill.local_modified.unwrap_or(false),
                error.to_string(),
            )
        }
    };

    let remote_commit = match checker.remote_commit(&source) {
        Ok(commit) => commit,
        Err(reason) => {
            return failed_result(&skill.id, &skill.name, Some(source), local_modified, reason)
        }
    };

    let current_commit = source
        .current_commit
        .clone()
        .unwrap_or_else(|| remote_commit.clone());
    let status = if current_commit == remote_commit {
        UpdateStatus::UpToDate
    } else {
        UpdateStatus::UpdateAvailable
    };
    let last_checked_at = Utc::now().to_rfc3339();

    if let Err(error) = store.update_source_check_result(
        &source.id,
        Some(&current_commit),
        Some(&remote_commit),
        &last_checked_at,
    ) {
        return failed_result(
            &skill.id,
            &skill.name,
            Some(source),
            local_modified,
            error.to_string(),
        );
    }

    let mut updated_source = source.clone();
    updated_source.current_commit = Some(current_commit);
    updated_source.remote_commit = Some(remote_commit);
    updated_source.last_checked_at = Some(last_checked_at);

    UpdateCheckResult {
        skill_id: skill.id,
        skill_name: skill.name,
        source: Some(updated_source),
        status,
        local_modified,
        commits_behind: None,
        diff_summary: None,
    }
}

fn failed_result(
    skill_id: &str,
    skill_name: &str,
    source: Option<SourceRecord>,
    local_modified: bool,
    reason: String,
) -> UpdateCheckResult {
    UpdateCheckResult {
        skill_id: skill_id.to_string(),
        skill_name: skill_name.to_string(),
        source,
        status: UpdateStatus::CheckFailed { reason },
        local_modified,
        commits_behind: None,
        diff_summary: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_state::capture_local_baseline;
    use metis_storage::db::{SkillIndexStore, SkillRecord, SourceRecord};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct FakeRemoteChecker {
        commits: HashMap<String, Result<String, String>>,
        checked_urls: RefCell<Vec<String>>,
    }

    impl FakeRemoteChecker {
        fn new(commits: HashMap<String, Result<String, String>>) -> Self {
            Self {
                commits,
                checked_urls: RefCell::new(Vec::new()),
            }
        }
    }

    impl RemoteCommitChecker for FakeRemoteChecker {
        fn remote_commit(&self, source: &SourceRecord) -> Result<String, String> {
            self.checked_urls.borrow_mut().push(source.url.clone());
            self.commits
                .get(&source.id)
                .cloned()
                .unwrap_or_else(|| Err("missing fake source".to_string()))
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("metis-core-update-{}-{}", name, suffix));
        fs::create_dir_all(&root).expect("temp directory should be created");
        root
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent directory should be created");
        }
        fs::write(path, contents).expect("test file should be writable");
    }

    fn sample_skill(id: &str, install_path: &Path, source_id: Option<&str>) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            agent_id: "codex".to_string(),
            name: "Example Skill".to_string(),
            description: Some("A skill with update state".to_string()),
            version: Some("1.0.0".to_string()),
            author: Some("Metis Team".to_string()),
            license: Some("MIT".to_string()),
            tags: vec!["workflow".to_string()],
            category: Some("workflow".to_string()),
            install_path: install_path.to_string_lossy().to_string(),
            scope: "user".to_string(),
            metadata_path: Some(install_path.join("SKILL.md").to_string_lossy().to_string()),
            metadata_status: "found".to_string(),
            metadata_error: None,
            source_id: source_id.map(ToOwned::to_owned),
            local_fingerprint: None,
            local_modified: None,
            last_scanned_at: "2026-06-19T10:00:00Z".to_string(),
        }
    }

    fn sample_source(id: &str, current_commit: Option<&str>) -> SourceRecord {
        SourceRecord {
            id: id.to_string(),
            source_type: "git".to_string(),
            url: "https://github.com/example/metis-skills.git".to_string(),
            repo_path: "skills/example".to_string(),
            ref_: "main".to_string(),
            current_commit: current_commit.map(ToOwned::to_owned),
            remote_commit: None,
            last_checked_at: None,
            trusted: true,
            auto_update: false,
            credential_ref: None,
            created_at: None,
            updated_at: None,
        }
    }

    fn store_with_skill_and_optional_source(
        install_path: &Path,
        current_commit: Option<&str>,
    ) -> SkillIndexStore {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let source = sample_source("source-1", current_commit);
        store.upsert_source(&source).expect("source should upsert");
        store
            .upsert_skill(&sample_skill("skill-1", install_path, Some("source-1")))
            .expect("skill should upsert");
        store
    }

    #[test]
    fn check_updates_returns_no_source_for_unbound_skill() {
        let root = temp_dir("no-source");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("skill-1", &skill_dir, None))
            .expect("skill should upsert");
        let checker = FakeRemoteChecker::new(HashMap::new());

        let results = check_updates(
            UpdateCheckOptions {
                skill_ids: vec!["skill-1".to_string()],
            },
            &mut store,
            &checker,
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(results.len(), 1);
        assert!(matches!(results[0].status, UpdateStatus::NoSource));
        assert!(checker.checked_urls.borrow().is_empty());
    }

    #[test]
    fn check_updates_returns_up_to_date_when_remote_matches_current_commit() {
        let root = temp_dir("up-to-date");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");
        let mut store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        let checker = FakeRemoteChecker::new(HashMap::from([(
            "source-1".to_string(),
            Ok("abc123".to_string()),
        )]));

        let results = check_updates(
            UpdateCheckOptions {
                skill_ids: vec!["skill-1".to_string()],
            },
            &mut store,
            &checker,
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(results.len(), 1);
        assert!(matches!(results[0].status, UpdateStatus::UpToDate));
        assert!(!results[0].local_modified);
        let source = store
            .get_source("source-1")
            .expect("source lookup should succeed")
            .expect("source should exist");
        assert_eq!(source.remote_commit.as_deref(), Some("abc123"));
        assert!(source.last_checked_at.is_some());
    }

    #[test]
    fn check_updates_returns_update_available_when_remote_differs() {
        let root = temp_dir("update-available");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");
        let mut store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        let checker = FakeRemoteChecker::new(HashMap::from([(
            "source-1".to_string(),
            Ok("def456".to_string()),
        )]));

        let results = check_updates(
            UpdateCheckOptions {
                skill_ids: vec!["skill-1".to_string()],
            },
            &mut store,
            &checker,
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(results.len(), 1);
        assert!(matches!(results[0].status, UpdateStatus::UpdateAvailable));
        assert_eq!(
            results[0]
                .source
                .as_ref()
                .and_then(|source| source.remote_commit.as_deref()),
            Some("def456")
        );
    }

    #[test]
    fn check_updates_initializes_current_commit_when_missing() {
        let root = temp_dir("initialize-current");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");
        let mut store = store_with_skill_and_optional_source(&skill_dir, None);
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        let checker = FakeRemoteChecker::new(HashMap::from([(
            "source-1".to_string(),
            Ok("abc123".to_string()),
        )]));

        let results = check_updates(
            UpdateCheckOptions {
                skill_ids: vec!["skill-1".to_string()],
            },
            &mut store,
            &checker,
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(results.len(), 1);
        assert!(matches!(results[0].status, UpdateStatus::UpToDate));
        let source = store
            .get_source("source-1")
            .expect("source lookup should succeed")
            .expect("source should exist");
        assert_eq!(source.current_commit.as_deref(), Some("abc123"));
        assert_eq!(source.remote_commit.as_deref(), Some("abc123"));
    }

    #[test]
    fn check_updates_reports_local_modified_when_file_changes() {
        let root = temp_dir("local-modified");
        let skill_dir = root.join("skill");
        let skill_md = skill_dir.join("SKILL.md");
        write_file(&skill_md, "# Example\n");
        let mut store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        write_file(&skill_md, "# Example Changed\n");
        let checker = FakeRemoteChecker::new(HashMap::from([(
            "source-1".to_string(),
            Ok("abc123".to_string()),
        )]));

        let results = check_updates(
            UpdateCheckOptions {
                skill_ids: vec!["skill-1".to_string()],
            },
            &mut store,
            &checker,
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(results.len(), 1);
        assert!(matches!(results[0].status, UpdateStatus::UpToDate));
        assert!(results[0].local_modified);
    }

    #[test]
    fn check_updates_returns_check_failed_when_remote_query_fails() {
        let root = temp_dir("remote-failure");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");
        let mut store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        let checker = FakeRemoteChecker::new(HashMap::from([(
            "source-1".to_string(),
            Err("auth failed".to_string()),
        )]));

        let results = check_updates(
            UpdateCheckOptions {
                skill_ids: vec!["skill-1".to_string()],
            },
            &mut store,
            &checker,
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(results.len(), 1);
        assert!(matches!(
            results[0].status,
            UpdateStatus::CheckFailed { .. }
        ));
    }
}
