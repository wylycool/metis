use crate::audit::{write_audit_event, AuditAction, AuditEventInput};
use crate::local_state::{capture_local_baseline, check_local_modification};
use crate::rollback::{create_backup, CreateBackupOptions};
use chrono::Utc;
use metis_git_provider::diff::{GitDiffDetail, GitDiffRequest, GitDiffStatus, GitDiffSummary};
use metis_git_provider::fetch::{GitCliProvider, GitCommandRunner, GitRemoteRef};
use metis_git_provider::source::GitCheckoutRequest;
use metis_security::checker::scan_directory;
use metis_security::findings::SecurityFinding;
use metis_storage::backup::replace_skill_directory;
use metis_storage::db::{SkillIndexStore, SourceRecord};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::Path;
use std::time::SystemTime;

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffDetail {
    pub skill_id: String,
    pub current_commit: String,
    pub target_commit: String,
    pub files: Vec<FileDiff>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: DiffStatus,
    pub patch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiffStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckoutResult {
    pub checkout_dir: String,
    pub skill_dir: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApplyUpdateOptions {
    pub skill_id: String,
    pub backup_root: String,
    pub cache_dir: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApplyUpdateResult {
    pub skill_id: String,
    pub previous_commit: String,
    pub new_commit: String,
    pub backup_id: String,
    pub security_findings: Vec<SecurityFinding>,
    pub warnings: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ApplyUpdateError {
    #[error("skill not found: {skill_id}")]
    SkillNotFound { skill_id: String },

    #[error("no source")]
    NoSource,

    #[error("source check failed: {0}")]
    SourceCheckFailed(String),

    #[error("local modified")]
    LocalModified,

    #[error("backup failed: {0}")]
    BackupFailed(String),

    #[error("checkout failed: {0}")]
    CheckoutFailed(String),

    #[error("apply failed and rollback succeeded: {0}")]
    RollbackSuccess(String),

    #[error("apply failed and rollback failed: apply={apply_error}, rollback={rollback_error}")]
    RollbackFailed {
        apply_error: String,
        rollback_error: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum DiffError {
    #[error("skill not found: {skill_id}")]
    SkillNotFound { skill_id: String },

    #[error("no source")]
    NoSource,

    #[error("source check failed: {0}")]
    SourceCheckFailed(String),

    #[error("storage error: {0}")]
    Storage(String),
}

pub trait RemoteCommitChecker {
    fn remote_commit(&self, source: &SourceRecord) -> Result<String, String>;

    fn diff_summary(
        &self,
        source: &SourceRecord,
        current_commit: &str,
        target_commit: &str,
    ) -> Result<DiffSummary, String>;

    fn commits_behind(
        &self,
        source: &SourceRecord,
        current_commit: &str,
        target_commit: &str,
    ) -> Result<u32, String>;

    fn diff_detail(
        &self,
        source: &SourceRecord,
        current_commit: &str,
        target_commit: &str,
    ) -> Result<DiffDetail, String>;

    fn checkout_to_cache(
        &self,
        source: &SourceRecord,
        target_commit: &str,
        cache_dir: &str,
    ) -> Result<CheckoutResult, String>;
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

    fn diff_summary(
        &self,
        source: &SourceRecord,
        current_commit: &str,
        target_commit: &str,
    ) -> Result<DiffSummary, String> {
        GitCliProvider::diff_summary(
            self,
            &git_diff_request_for_source(self, source, current_commit, target_commit)?,
        )
        .map(diff_summary_from_git)
        .map_err(|error| error.to_string())
    }

    fn commits_behind(
        &self,
        source: &SourceRecord,
        current_commit: &str,
        target_commit: &str,
    ) -> Result<u32, String> {
        GitCliProvider::commits_behind(
            self,
            &git_diff_request_for_source(self, source, current_commit, target_commit)?,
        )
        .map_err(|error| error.to_string())
    }

    fn diff_detail(
        &self,
        source: &SourceRecord,
        current_commit: &str,
        target_commit: &str,
    ) -> Result<DiffDetail, String> {
        GitCliProvider::diff_detail(
            self,
            &git_diff_request_for_source(self, source, current_commit, target_commit)?,
        )
        .map(|detail| diff_detail_from_git("", detail))
        .map_err(|error| error.to_string())
    }

    fn checkout_to_cache(
        &self,
        source: &SourceRecord,
        target_commit: &str,
        cache_dir: &str,
    ) -> Result<CheckoutResult, String> {
        GitCliProvider::checkout_to_cache(
            self,
            &GitCheckoutRequest {
                url: source.url.clone(),
                ref_: source.ref_.clone(),
                repo_path: source.repo_path.clone(),
                target_commit: target_commit.to_string(),
                cache_dir: cache_dir.to_string(),
            },
        )
        .map(|result| CheckoutResult {
            checkout_dir: result.checkout_dir,
            skill_dir: result.skill_dir,
        })
        .map_err(|error| error.to_string())
    }
}

fn git_diff_request_for_source<R: GitCommandRunner>(
    provider: &GitCliProvider<R>,
    source: &SourceRecord,
    current_commit: &str,
    target_commit: &str,
) -> Result<GitDiffRequest, String> {
    let repo_dir = match provider.cache_root() {
        Some(cache_root) => {
            let checkout = GitCliProvider::checkout_to_cache(
                provider,
                &GitCheckoutRequest {
                    url: source.url.clone(),
                    ref_: source.ref_.clone(),
                    repo_path: source.repo_path.clone(),
                    target_commit: target_commit.to_string(),
                    cache_dir: cache_root.to_string(),
                },
            )
            .map_err(|error| error.to_string())?;
            Some(checkout.checkout_dir)
        }
        None => None,
    };

    Ok(GitDiffRequest {
        repo_dir,
        repo_path: source.repo_path.clone(),
        current_commit: current_commit.to_string(),
        target_commit: target_commit.to_string(),
    })
}

pub fn check_updates<C: RemoteCommitChecker>(
    options: UpdateCheckOptions,
    store: &mut SkillIndexStore,
    checker: &C,
) -> Vec<UpdateCheckResult> {
    let mut shared_checks = HashMap::new();
    options
        .skill_ids
        .iter()
        .map(|skill_id| check_one_update(skill_id, store, checker, &mut shared_checks))
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SharedCheckKey {
    source_id: String,
    current_commit: String,
}

#[derive(Debug, Clone)]
struct SharedCheckResult {
    remote_commit: String,
    status: UpdateStatus,
    diff_summary: Option<DiffSummary>,
    commits_behind: Option<u32>,
}

fn check_one_update<C: RemoteCommitChecker>(
    skill_id: &str,
    store: &mut SkillIndexStore,
    checker: &C,
    shared_checks: &mut HashMap<SharedCheckKey, Result<SharedCheckResult, String>>,
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
        let _ = write_audit_event(
            store,
            AuditEventInput {
                skill_id: skill.id.clone(),
                action: AuditAction::UpdateChecked,
                detail: Some("update check skipped: no source".to_string()),
                commit_before: None,
                commit_after: None,
                status: "success".to_string(),
                risk_summary: None,
            },
        );
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

    let remote_commit_for_missing_current = match source.current_commit.as_deref() {
        Some(_) => None,
        None => match checker.remote_commit(&source) {
            Ok(commit) => Some(commit),
            Err(reason) => {
                return failed_result(&skill.id, &skill.name, Some(source), local_modified, reason)
            }
        },
    };
    let current_commit = source
        .current_commit
        .clone()
        .or_else(|| remote_commit_for_missing_current.clone())
        .unwrap_or_default();
    let shared_key = SharedCheckKey {
        source_id: source.id.clone(),
        current_commit: current_commit.clone(),
    };
    if !shared_checks.contains_key(&shared_key) {
        let check_result = run_shared_update_check(
            &source,
            &current_commit,
            remote_commit_for_missing_current,
            checker,
        );
        shared_checks.insert(shared_key.clone(), check_result);
    }
    let shared = match shared_checks.get(&shared_key).cloned() {
        Some(Ok(shared)) => shared,
        Some(Err(reason)) => {
            return failed_result(&skill.id, &skill.name, Some(source), local_modified, reason)
        }
        None => {
            return failed_result(
                &skill.id,
                &skill.name,
                Some(source),
                local_modified,
                "missing shared check result".to_string(),
            )
        }
    };
    let remote_commit = shared.remote_commit;
    let status = shared.status;
    let diff_summary = shared.diff_summary;
    let commits_behind = shared.commits_behind;
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
    let _ = write_audit_event(
        store,
        AuditEventInput {
            skill_id: skill.id.clone(),
            action: AuditAction::UpdateChecked,
            detail: Some("update checked".to_string()),
            commit_before: Some(
                updated_source
                    .current_commit
                    .clone()
                    .unwrap_or_else(String::new),
            ),
            commit_after: updated_source.remote_commit.clone(),
            status: "success".to_string(),
            risk_summary: None,
        },
    );

    UpdateCheckResult {
        skill_id: skill.id,
        skill_name: skill.name,
        source: Some(updated_source),
        status,
        local_modified,
        commits_behind,
        diff_summary,
    }
}

fn run_shared_update_check<C: RemoteCommitChecker>(
    source: &SourceRecord,
    current_commit: &str,
    known_remote_commit: Option<String>,
    checker: &C,
) -> Result<SharedCheckResult, String> {
    let remote_commit = match known_remote_commit {
        Some(commit) => commit,
        None => checker.remote_commit(source)?,
    };
    if current_commit == remote_commit {
        return Ok(SharedCheckResult {
            remote_commit,
            status: UpdateStatus::UpToDate,
            diff_summary: None,
            commits_behind: None,
        });
    }

    match checker.diff_summary(source, current_commit, &remote_commit) {
        Ok(summary) if summary.total_changes == 0 => Ok(SharedCheckResult {
            remote_commit,
            status: UpdateStatus::UpToDate,
            diff_summary: None,
            commits_behind: None,
        }),
        Ok(summary) => {
            let commits_behind = checker.commits_behind(source, current_commit, &remote_commit)?;
            Ok(SharedCheckResult {
                remote_commit,
                status: UpdateStatus::UpdateAvailable,
                diff_summary: Some(summary),
                commits_behind: Some(commits_behind),
            })
        }
        Err(reason) => Err(reason),
    }
}

pub fn get_diff<C: RemoteCommitChecker>(
    skill_id: &str,
    store: &SkillIndexStore,
    checker: &C,
) -> Result<DiffDetail, DiffError> {
    let skill = store
        .get_skill(skill_id)
        .map_err(|error| DiffError::Storage(error.to_string()))?
        .ok_or_else(|| DiffError::SkillNotFound {
            skill_id: skill_id.to_string(),
        })?;
    let source_id = skill.source_id.as_deref().ok_or(DiffError::NoSource)?;
    let source = store
        .get_source(source_id)
        .map_err(|error| DiffError::Storage(error.to_string()))?
        .ok_or_else(|| DiffError::SourceCheckFailed(format!("source not found: {source_id}")))?;
    let current_commit = source
        .current_commit
        .as_deref()
        .ok_or_else(|| DiffError::SourceCheckFailed("missing current commit".to_string()))?;
    let target_commit = source
        .remote_commit
        .as_deref()
        .ok_or_else(|| DiffError::SourceCheckFailed("missing remote commit".to_string()))?;

    let mut detail = checker
        .diff_detail(&source, current_commit, target_commit)
        .map_err(DiffError::SourceCheckFailed)?;
    detail.skill_id = skill.id;
    Ok(detail)
}

pub fn apply_update<C: RemoteCommitChecker>(
    options: ApplyUpdateOptions,
    store: &mut SkillIndexStore,
    checker: &C,
) -> Result<ApplyUpdateResult, ApplyUpdateError> {
    let skill = store
        .get_skill(&options.skill_id)
        .map_err(|error| ApplyUpdateError::SourceCheckFailed(error.to_string()))?
        .ok_or_else(|| ApplyUpdateError::SkillNotFound {
            skill_id: options.skill_id.clone(),
        })?;
    let source_id = skill
        .source_id
        .as_deref()
        .ok_or(ApplyUpdateError::NoSource)?;
    let source = store
        .get_source(source_id)
        .map_err(|error| ApplyUpdateError::SourceCheckFailed(error.to_string()))?
        .ok_or_else(|| {
            ApplyUpdateError::SourceCheckFailed(format!("source not found: {source_id}"))
        })?;
    let previous_commit = source
        .current_commit
        .clone()
        .ok_or_else(|| ApplyUpdateError::SourceCheckFailed("missing current commit".to_string()))?;
    let new_commit = source
        .remote_commit
        .clone()
        .ok_or_else(|| ApplyUpdateError::SourceCheckFailed("missing remote commit".to_string()))?;

    check_local_modification(&skill.id, store)
        .map_err(|error| ApplyUpdateError::SourceCheckFailed(error.to_string()))?;

    let backup = create_backup(
        CreateBackupOptions {
            skill_id: skill.id.clone(),
            backup_root: options.backup_root.clone(),
            reason: "pre-update".to_string(),
        },
        store,
    )
    .map_err(|error| ApplyUpdateError::BackupFailed(error.to_string()))?;
    let checkout = checker
        .checkout_to_cache(&source, &new_commit, &options.cache_dir)
        .map_err(ApplyUpdateError::CheckoutFailed)?;
    let security_report = scan_directory(&checkout.skill_dir)
        .map_err(|error| ApplyUpdateError::SourceCheckFailed(error.to_string()))?;

    if let Err(apply_error) = replace_skill_directory(&checkout.skill_dir, &skill.install_path) {
        return match replace_skill_directory(&backup.backup_path, &skill.install_path) {
            Ok(_) => {
                let _ = write_audit_event(
                    store,
                    AuditEventInput {
                        skill_id: skill.id.clone(),
                        action: AuditAction::UpdateFailed,
                        detail: Some("update apply failed and rollback succeeded".to_string()),
                        commit_before: Some(previous_commit),
                        commit_after: Some(new_commit),
                        status: "failed".to_string(),
                        risk_summary: None,
                    },
                );
                Err(ApplyUpdateError::RollbackSuccess(apply_error.to_string()))
            }
            Err(rollback_error) => Err(ApplyUpdateError::RollbackFailed {
                apply_error: apply_error.to_string(),
                rollback_error: rollback_error.to_string(),
            }),
        };
    }
    refresh_regular_file_mtimes(&skill.install_path)
        .map_err(|error| ApplyUpdateError::SourceCheckFailed(error.to_string()))?;

    store
        .update_source_check_result(
            &source.id,
            Some(&new_commit),
            Some(&new_commit),
            &Utc::now().to_rfc3339(),
        )
        .map_err(|error| ApplyUpdateError::SourceCheckFailed(error.to_string()))?;
    capture_local_baseline(&skill.id, store)
        .map_err(|error| ApplyUpdateError::SourceCheckFailed(error.to_string()))?;
    let _ = write_audit_event(
        store,
        AuditEventInput {
            skill_id: skill.id.clone(),
            action: AuditAction::UpdateApplied,
            detail: Some("update applied".to_string()),
            commit_before: Some(previous_commit.clone()),
            commit_after: Some(new_commit.clone()),
            status: "success".to_string(),
            risk_summary: serde_json::to_string(&security_report.findings).ok(),
        },
    );

    Ok(ApplyUpdateResult {
        skill_id: skill.id,
        previous_commit,
        new_commit,
        backup_id: backup.backup_id,
        security_findings: security_report.findings,
        warnings: vec![],
    })
}

fn refresh_regular_file_mtimes(root: impl AsRef<Path>) -> io::Result<()> {
    let now = SystemTime::now();
    refresh_regular_file_mtimes_inner(root.as_ref(), now)
}

fn refresh_regular_file_mtimes_inner(path: &Path, modified_time: SystemTime) -> io::Result<()> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            refresh_regular_file_mtimes_inner(&entry_path, modified_time)?;
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        let file = fs::File::open(&entry_path)?;
        let times = fs::FileTimes::new()
            .set_modified(modified_time)
            .set_accessed(modified_time);
        file.set_times(times)?;
    }
    Ok(())
}

fn diff_summary_from_git(summary: GitDiffSummary) -> DiffSummary {
    DiffSummary {
        files_added: summary.files_added,
        files_modified: summary.files_modified,
        files_deleted: summary.files_deleted,
        total_changes: summary.total_changes,
    }
}

fn diff_detail_from_git(skill_id: &str, detail: GitDiffDetail) -> DiffDetail {
    DiffDetail {
        skill_id: skill_id.to_string(),
        current_commit: detail.current_commit,
        target_commit: detail.target_commit,
        files: detail
            .files
            .into_iter()
            .map(|file| FileDiff {
                path: file.path,
                old_path: file.old_path,
                status: match file.status {
                    GitDiffStatus::Added => DiffStatus::Added,
                    GitDiffStatus::Modified => DiffStatus::Modified,
                    GitDiffStatus::Deleted => DiffStatus::Deleted,
                    GitDiffStatus::Renamed => DiffStatus::Renamed,
                },
                patch: file.patch,
            })
            .collect(),
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
    use metis_git_provider::fetch::{SystemGitCliProvider, SystemGitRunner};
    use metis_storage::db::{SkillIndexStore, SkillRecord, SourceRecord};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    struct FakeRemoteChecker {
        commits: HashMap<String, Result<String, String>>,
        diffs: HashMap<String, Result<DiffSummary, String>>,
        behinds: HashMap<String, Result<u32, String>>,
        details: HashMap<String, Result<DiffDetail, String>>,
        checkouts: HashMap<String, Result<CheckoutResult, String>>,
        checked_urls: RefCell<Vec<String>>,
        diff_sources: RefCell<Vec<String>>,
        behind_sources: RefCell<Vec<String>>,
    }

    impl FakeRemoteChecker {
        fn new(commits: HashMap<String, Result<String, String>>) -> Self {
            Self {
                commits,
                diffs: HashMap::new(),
                behinds: HashMap::new(),
                details: HashMap::new(),
                checkouts: HashMap::new(),
                checked_urls: RefCell::new(Vec::new()),
                diff_sources: RefCell::new(Vec::new()),
                behind_sources: RefCell::new(Vec::new()),
            }
        }

        fn with_diffs(
            commits: HashMap<String, Result<String, String>>,
            diffs: HashMap<String, Result<DiffSummary, String>>,
        ) -> Self {
            Self {
                commits,
                diffs,
                behinds: HashMap::new(),
                details: HashMap::new(),
                checkouts: HashMap::new(),
                checked_urls: RefCell::new(Vec::new()),
                diff_sources: RefCell::new(Vec::new()),
                behind_sources: RefCell::new(Vec::new()),
            }
        }

        fn with_all(
            commits: HashMap<String, Result<String, String>>,
            diffs: HashMap<String, Result<DiffSummary, String>>,
            behinds: HashMap<String, Result<u32, String>>,
            details: HashMap<String, Result<DiffDetail, String>>,
            checkouts: HashMap<String, Result<CheckoutResult, String>>,
        ) -> Self {
            Self {
                commits,
                diffs,
                behinds,
                details,
                checkouts,
                checked_urls: RefCell::new(Vec::new()),
                diff_sources: RefCell::new(Vec::new()),
                behind_sources: RefCell::new(Vec::new()),
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

        fn diff_summary(
            &self,
            source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<DiffSummary, String> {
            self.diff_sources.borrow_mut().push(source.id.clone());
            self.diffs
                .get(&source.id)
                .cloned()
                .unwrap_or_else(|| Err("missing fake diff".to_string()))
        }

        fn commits_behind(
            &self,
            source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<u32, String> {
            self.behind_sources.borrow_mut().push(source.id.clone());
            self.behinds.get(&source.id).cloned().unwrap_or(Ok(0))
        }

        fn diff_detail(
            &self,
            source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<DiffDetail, String> {
            self.details
                .get(&source.id)
                .cloned()
                .unwrap_or_else(|| Err("missing fake diff detail".to_string()))
        }

        fn checkout_to_cache(
            &self,
            source: &SourceRecord,
            _target_commit: &str,
            _cache_dir: &str,
        ) -> Result<CheckoutResult, String> {
            self.checkouts
                .get(&source.id)
                .cloned()
                .unwrap_or_else(|| Err("missing fake checkout".to_string()))
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

    fn set_file_modified_time(path: &Path, time: SystemTime) {
        let file = fs::OpenOptions::new()
            .write(true)
            .open(path)
            .expect("test file should open for time update");
        let times = fs::FileTimes::new().set_modified(time).set_accessed(time);
        file.set_times(times)
            .expect("test file modified time should update");
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
            local_updated_at: None,
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
        let checker = FakeRemoteChecker::with_diffs(
            HashMap::from([("source-1".to_string(), Ok("def456".to_string()))]),
            HashMap::from([(
                "source-1".to_string(),
                Ok(DiffSummary {
                    files_added: 0,
                    files_modified: 1,
                    files_deleted: 0,
                    total_changes: 1,
                }),
            )]),
        );

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
        assert_eq!(
            results[0].diff_summary,
            Some(DiffSummary {
                files_added: 0,
                files_modified: 1,
                files_deleted: 0,
                total_changes: 1,
            })
        );
        assert_eq!(results[0].commits_behind, Some(0));
    }

    #[test]
    fn check_updates_returns_up_to_date_when_remote_commit_changes_outside_repo_path() {
        let root = temp_dir("outside-repo-path-change");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");
        let mut store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        let checker = FakeRemoteChecker::with_all(
            HashMap::from([("source-1".to_string(), Ok("def456".to_string()))]),
            HashMap::from([(
                "source-1".to_string(),
                Ok(DiffSummary {
                    files_added: 0,
                    files_modified: 0,
                    files_deleted: 0,
                    total_changes: 0,
                }),
            )]),
            HashMap::from([(
                "source-1".to_string(),
                Err("commits behind should not run without path changes".to_string()),
            )]),
            HashMap::new(),
            HashMap::new(),
        );

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
        assert_eq!(results[0].diff_summary, None);
        assert_eq!(results[0].commits_behind, None);
        assert_eq!(
            results[0]
                .source
                .as_ref()
                .and_then(|source| source.current_commit.as_deref()),
            Some("abc123")
        );
        assert_eq!(
            results[0]
                .source
                .as_ref()
                .and_then(|source| source.remote_commit.as_deref()),
            Some("def456")
        );
        let stored_source = store
            .get_source("source-1")
            .expect("source lookup should succeed")
            .expect("source should exist");
        assert_eq!(stored_source.current_commit.as_deref(), Some("abc123"));
        assert_eq!(stored_source.remote_commit.as_deref(), Some("def456"));
    }

    #[test]
    fn check_updates_reuses_remote_and_diff_checks_for_same_source_batch() {
        let root = temp_dir("same-source-batch");
        let codex_skill_dir = root.join("codex-skill");
        let claude_skill_dir = root.join("claude-skill");
        write_file(&codex_skill_dir.join("SKILL.md"), "# Example\n");
        write_file(&claude_skill_dir.join("SKILL.md"), "# Example\n");
        let mut store = store_with_skill_and_optional_source(&codex_skill_dir, Some("abc123"));
        store
            .upsert_skill(&sample_skill(
                "skill-2",
                &claude_skill_dir,
                Some("source-1"),
            ))
            .expect("second skill should upsert");
        capture_local_baseline("skill-1", &mut store).expect("first baseline should capture");
        capture_local_baseline("skill-2", &mut store).expect("second baseline should capture");
        let checker = FakeRemoteChecker::with_all(
            HashMap::from([("source-1".to_string(), Ok("def456".to_string()))]),
            HashMap::from([(
                "source-1".to_string(),
                Ok(DiffSummary {
                    files_added: 0,
                    files_modified: 1,
                    files_deleted: 0,
                    total_changes: 1,
                }),
            )]),
            HashMap::from([("source-1".to_string(), Ok(2))]),
            HashMap::new(),
            HashMap::new(),
        );

        let results = check_updates(
            UpdateCheckOptions {
                skill_ids: vec!["skill-1".to_string(), "skill-2".to_string()],
            },
            &mut store,
            &checker,
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(results.len(), 2);
        assert!(results
            .iter()
            .all(|result| result.status == UpdateStatus::UpdateAvailable));
        assert_eq!(checker.checked_urls.borrow().len(), 1);
        assert_eq!(checker.diff_sources.borrow().len(), 1);
        assert_eq!(checker.behind_sources.borrow().len(), 1);
    }

    #[test]
    fn check_updates_returns_commits_behind_when_remote_differs() {
        let root = temp_dir("behind");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");
        let mut store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        let checker = FakeRemoteChecker::with_all(
            HashMap::from([("source-1".to_string(), Ok("def456".to_string()))]),
            HashMap::from([(
                "source-1".to_string(),
                Ok(DiffSummary {
                    files_added: 0,
                    files_modified: 1,
                    files_deleted: 0,
                    total_changes: 1,
                }),
            )]),
            HashMap::from([("source-1".to_string(), Ok(3))]),
            HashMap::new(),
            HashMap::new(),
        );

        let results = check_updates(
            UpdateCheckOptions {
                skill_ids: vec!["skill-1".to_string()],
            },
            &mut store,
            &checker,
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(results[0].commits_behind, Some(3));
    }

    #[test]
    fn check_updates_with_real_git_repo_uses_cache_for_behind_and_diff_summary() {
        let root = temp_dir("real-git-check");
        let source_repo = root.join("source");
        let cache_root = root.join("cache");
        let skill_dir = root.join("installed-skill");
        fs::create_dir_all(source_repo.join("skills/example"))
            .expect("source skill directory should be created");
        write_file(&source_repo.join("skills/example/SKILL.md"), "# Old\n");
        git(&source_repo, &["init"]);
        git(&source_repo, &["add", "."]);
        let current_commit = git_commit(&source_repo, "initial skill");
        write_file(&source_repo.join("skills/example/SKILL.md"), "# New\n");
        write_file(&source_repo.join("skills/example/new.md"), "new file\n");
        git(&source_repo, &["add", "."]);
        let remote_commit = git_commit(&source_repo, "updated skill");
        fs::create_dir_all(&skill_dir).expect("installed skill directory should be created");
        write_file(&skill_dir.join("SKILL.md"), "# Old\n");

        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        let source = SourceRecord {
            id: "source-1".to_string(),
            source_type: "git".to_string(),
            url: source_repo.to_string_lossy().to_string(),
            repo_path: "skills/example".to_string(),
            ref_: "HEAD".to_string(),
            current_commit: Some(current_commit),
            remote_commit: None,
            last_checked_at: None,
            trusted: true,
            auto_update: false,
            credential_ref: None,
            created_at: None,
            updated_at: None,
        };
        store.upsert_source(&source).expect("source should upsert");
        store
            .upsert_skill(&sample_skill("skill-1", &skill_dir, Some("source-1")))
            .expect("skill should upsert");
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        let checker = SystemGitCliProvider::with_cache_root(
            SystemGitRunner,
            cache_root.to_string_lossy().to_string(),
        );

        let results = check_updates(
            UpdateCheckOptions {
                skill_ids: vec!["skill-1".to_string()],
            },
            &mut store,
            &checker,
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status, UpdateStatus::UpdateAvailable);
        assert_eq!(results[0].commits_behind, Some(1));
        assert_eq!(
            results[0].diff_summary,
            Some(DiffSummary {
                files_added: 1,
                files_modified: 1,
                files_deleted: 0,
                total_changes: 2,
            })
        );
        assert_eq!(
            results[0]
                .source
                .as_ref()
                .and_then(|source| source.remote_commit.as_deref()),
            Some(remote_commit.as_str())
        );
    }

    #[test]
    fn get_diff_returns_patch_detail_for_bound_skill() {
        let root = temp_dir("diff-detail");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");
        let store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        store
            .update_source_check_result(
                "source-1",
                Some("abc123"),
                Some("def456"),
                "2026-06-19T12:00:00Z",
            )
            .expect("source check should update");
        let checker = FakeRemoteChecker::with_all(
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
            HashMap::from([(
                "source-1".to_string(),
                Ok(DiffDetail {
                    skill_id: "skill-1".to_string(),
                    current_commit: "abc123".to_string(),
                    target_commit: "def456".to_string(),
                    files: vec![FileDiff {
                        path: "skills/example/SKILL.md".to_string(),
                        old_path: None,
                        status: DiffStatus::Modified,
                        patch: Some("diff --git".to_string()),
                    }],
                }),
            )]),
            HashMap::new(),
        );

        let detail = get_diff("skill-1", &store, &checker).expect("diff should load");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(detail.files.len(), 1);
        assert_eq!(detail.files[0].status, DiffStatus::Modified);
        assert_eq!(detail.files[0].patch.as_deref(), Some("diff --git"));
    }

    #[test]
    fn apply_update_replaces_install_dir_updates_commit_and_refreshes_baseline() {
        let root = temp_dir("apply-success");
        let skill_dir = root.join("skill");
        let candidate_dir = root.join("candidate");
        let backup_root = root.join("backups");
        write_file(&skill_dir.join("SKILL.md"), "# Old\n");
        write_file(&candidate_dir.join("SKILL.md"), "# New\n");
        write_file(&candidate_dir.join("new.md"), "new");
        let old_candidate_time = UNIX_EPOCH + Duration::from_secs(60);
        set_file_modified_time(&candidate_dir.join("SKILL.md"), old_candidate_time);
        let mut store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        store
            .update_source_check_result(
                "source-1",
                Some("abc123"),
                Some("def456"),
                "2026-06-19T12:00:00Z",
            )
            .expect("source check should update");
        let checker = FakeRemoteChecker::with_all(
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
            HashMap::from([(
                "source-1".to_string(),
                Ok(CheckoutResult {
                    checkout_dir: root.join("checkout").to_string_lossy().to_string(),
                    skill_dir: candidate_dir.to_string_lossy().to_string(),
                }),
            )]),
        );

        let before_apply = SystemTime::now();
        let result = apply_update(
            ApplyUpdateOptions {
                skill_id: "skill-1".to_string(),
                backup_root: backup_root.to_string_lossy().to_string(),
                cache_dir: root.join("cache").to_string_lossy().to_string(),
            },
            &mut store,
            &checker,
        )
        .expect("update should apply");

        assert_eq!(result.previous_commit, "abc123");
        assert_eq!(result.new_commit, "def456");
        assert_eq!(
            fs::read_to_string(skill_dir.join("SKILL.md")).expect("updated skill should read"),
            "# New\n"
        );
        assert_eq!(
            fs::read_to_string(skill_dir.join("new.md")).expect("new file should read"),
            "new"
        );
        let installed_modified_time = fs::metadata(skill_dir.join("SKILL.md"))
            .expect("updated skill metadata should read")
            .modified()
            .expect("updated skill modified time should read");
        assert!(
            installed_modified_time >= before_apply,
            "updated file mtime should reflect apply time, got {installed_modified_time:?} before {before_apply:?}"
        );
        let source = store
            .get_source("source-1")
            .expect("source lookup should succeed")
            .expect("source should exist");
        assert_eq!(source.current_commit.as_deref(), Some("def456"));
        let skill = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        assert_eq!(skill.local_modified, Some(false));
        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn apply_update_allows_manual_overwrite_when_local_files_changed() {
        let root = temp_dir("apply-local-modified");
        let skill_dir = root.join("skill");
        let candidate_dir = root.join("candidate");
        let backup_root = root.join("backups");
        write_file(&skill_dir.join("SKILL.md"), "# Old\n");
        write_file(&candidate_dir.join("SKILL.md"), "# Remote\n");
        let mut store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        write_file(&skill_dir.join("SKILL.md"), "# Local accidental edit\n");
        let local_state =
            check_local_modification("skill-1", &mut store).expect("local state should refresh");
        assert!(local_state.local_modified);
        store
            .update_source_check_result(
                "source-1",
                Some("abc123"),
                Some("def456"),
                "2026-06-19T12:00:00Z",
            )
            .expect("source check should update");
        let checker = FakeRemoteChecker::with_all(
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
            HashMap::from([(
                "source-1".to_string(),
                Ok(CheckoutResult {
                    checkout_dir: root.join("checkout").to_string_lossy().to_string(),
                    skill_dir: candidate_dir.to_string_lossy().to_string(),
                }),
            )]),
        );

        let result = apply_update(
            ApplyUpdateOptions {
                skill_id: "skill-1".to_string(),
                backup_root: backup_root.to_string_lossy().to_string(),
                cache_dir: root.join("cache").to_string_lossy().to_string(),
            },
            &mut store,
            &checker,
        )
        .expect("manual update should overwrite local changes after backup");

        assert_eq!(result.previous_commit, "abc123");
        assert_eq!(result.new_commit, "def456");
        assert_eq!(
            fs::read_to_string(skill_dir.join("SKILL.md")).expect("updated skill should read"),
            "# Remote\n"
        );
        let skill = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        assert_eq!(skill.local_modified, Some(false));
        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn apply_update_overwrites_local_changes_when_commits_match() {
        let root = temp_dir("apply-local-modified-same-commit");
        let skill_dir = root.join("skill");
        let candidate_dir = root.join("candidate");
        let backup_root = root.join("backups");
        write_file(&skill_dir.join("SKILL.md"), "# Remote\n");
        write_file(&candidate_dir.join("SKILL.md"), "# Remote\n");
        let mut store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        write_file(&skill_dir.join("SKILL.md"), "# Local accidental edit\n");
        let local_state =
            check_local_modification("skill-1", &mut store).expect("local state should refresh");
        assert!(local_state.local_modified);
        store
            .update_source_check_result(
                "source-1",
                Some("abc123"),
                Some("abc123"),
                "2026-06-19T12:00:00Z",
            )
            .expect("source check should update");
        let checker = FakeRemoteChecker::with_all(
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
            HashMap::from([(
                "source-1".to_string(),
                Ok(CheckoutResult {
                    checkout_dir: root.join("checkout").to_string_lossy().to_string(),
                    skill_dir: candidate_dir.to_string_lossy().to_string(),
                }),
            )]),
        );

        let result = apply_update(
            ApplyUpdateOptions {
                skill_id: "skill-1".to_string(),
                backup_root: backup_root.to_string_lossy().to_string(),
                cache_dir: root.join("cache").to_string_lossy().to_string(),
            },
            &mut store,
            &checker,
        )
        .expect("same-commit update should overwrite local changes after backup");

        assert_eq!(result.previous_commit, "abc123");
        assert_eq!(result.new_commit, "abc123");
        assert_eq!(
            fs::read_to_string(skill_dir.join("SKILL.md")).expect("updated skill should read"),
            "# Remote\n"
        );
        let skill = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        assert_eq!(skill.local_modified, Some(false));
        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn apply_update_with_real_git_repo_uses_cache_checkout() {
        let root = temp_dir("real-git-apply");
        let source_repo = root.join("source");
        let skill_dir = root.join("installed-skill");
        let backup_root = root.join("backups");
        let cache_root = root.join("cache");
        fs::create_dir_all(source_repo.join("skills/example"))
            .expect("source skill directory should be created");
        write_file(&source_repo.join("skills/example/SKILL.md"), "# Old\n");
        git(&source_repo, &["init"]);
        git(&source_repo, &["add", "."]);
        let current_commit = git_commit(&source_repo, "initial skill");
        write_file(&source_repo.join("skills/example/SKILL.md"), "# New\n");
        write_file(&source_repo.join("skills/example/new.md"), "new file\n");
        git(&source_repo, &["add", "."]);
        let remote_commit = git_commit(&source_repo, "updated skill");
        write_file(&skill_dir.join("SKILL.md"), "# Old\n");

        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        let source = SourceRecord {
            id: "source-1".to_string(),
            source_type: "git".to_string(),
            url: source_repo.to_string_lossy().to_string(),
            repo_path: "skills/example".to_string(),
            ref_: "HEAD".to_string(),
            current_commit: Some(current_commit.clone()),
            remote_commit: Some(remote_commit.clone()),
            last_checked_at: Some("2026-06-19T12:00:00Z".to_string()),
            trusted: true,
            auto_update: false,
            credential_ref: None,
            created_at: None,
            updated_at: None,
        };
        store.upsert_source(&source).expect("source should upsert");
        store
            .upsert_skill(&sample_skill("skill-1", &skill_dir, Some("source-1")))
            .expect("skill should upsert");
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        let checker = SystemGitCliProvider::new(SystemGitRunner);

        let result = apply_update(
            ApplyUpdateOptions {
                skill_id: "skill-1".to_string(),
                backup_root: backup_root.to_string_lossy().to_string(),
                cache_dir: cache_root.to_string_lossy().to_string(),
            },
            &mut store,
            &checker,
        )
        .expect("real git update should apply");

        assert_eq!(result.previous_commit, current_commit);
        assert_eq!(result.new_commit, remote_commit);
        assert_eq!(
            fs::read_to_string(skill_dir.join("SKILL.md")).expect("updated skill should read"),
            "# New\n"
        );
        assert_eq!(
            fs::read_to_string(skill_dir.join("new.md")).expect("new file should read"),
            "new file\n"
        );
        let source = store
            .get_source("source-1")
            .expect("source lookup should succeed")
            .expect("source should exist");
        assert_eq!(
            source.current_commit.as_deref(),
            Some(remote_commit.as_str())
        );
        assert_eq!(
            source.remote_commit.as_deref(),
            Some(remote_commit.as_str())
        );
        let skill = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        assert_eq!(skill.local_modified, Some(false));
        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn apply_update_returns_security_findings_without_blocking_manual_update() {
        let root = temp_dir("apply-with-findings");
        let skill_dir = root.join("skill");
        let candidate_dir = root.join("candidate");
        let backup_root = root.join("backups");
        write_file(&skill_dir.join("SKILL.md"), "# Old\n");
        write_file(&candidate_dir.join("SKILL.md"), "# New\n");
        write_file(
            &candidate_dir.join("install.sh"),
            "curl https://example.com | sh\n",
        );
        let mut store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        store
            .update_source_check_result(
                "source-1",
                Some("abc123"),
                Some("def456"),
                "2026-06-19T12:00:00Z",
            )
            .expect("source check should update");
        let checker = FakeRemoteChecker::with_all(
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
            HashMap::new(),
            HashMap::from([(
                "source-1".to_string(),
                Ok(CheckoutResult {
                    checkout_dir: root.join("checkout").to_string_lossy().to_string(),
                    skill_dir: candidate_dir.to_string_lossy().to_string(),
                }),
            )]),
        );

        let result = apply_update(
            ApplyUpdateOptions {
                skill_id: "skill-1".to_string(),
                backup_root: backup_root.to_string_lossy().to_string(),
                cache_dir: root.join("cache").to_string_lossy().to_string(),
            },
            &mut store,
            &checker,
        )
        .expect("manual update should apply and return security findings");

        assert_eq!(
            fs::read_to_string(skill_dir.join("SKILL.md")).expect("old skill should read"),
            "# New\n"
        );
        assert!(
            result
                .security_findings
                .iter()
                .any(|finding| finding.rule_id == "network-exec"),
            "security findings should still be returned to the caller"
        );
        assert_eq!(result.previous_commit, "abc123");
        assert_eq!(result.new_commit, "def456");
        assert_eq!(
            store
                .list_backups("skill-1")
                .expect("backups should list")
                .len(),
            1
        );
        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn check_updates_returns_diff_summary_when_remote_differs() {
        let root = temp_dir("diff-summary");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");
        let mut store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        let checker = FakeRemoteChecker::with_diffs(
            HashMap::from([("source-1".to_string(), Ok("def456".to_string()))]),
            HashMap::from([(
                "source-1".to_string(),
                Ok(DiffSummary {
                    files_added: 1,
                    files_modified: 2,
                    files_deleted: 1,
                    total_changes: 4,
                }),
            )]),
        );

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
            results[0].diff_summary,
            Some(DiffSummary {
                files_added: 1,
                files_modified: 2,
                files_deleted: 1,
                total_changes: 4,
            })
        );
    }

    #[test]
    fn check_updates_returns_check_failed_when_diff_summary_fails() {
        let root = temp_dir("diff-failure");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");
        let mut store = store_with_skill_and_optional_source(&skill_dir, Some("abc123"));
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        let checker = FakeRemoteChecker::with_diffs(
            HashMap::from([("source-1".to_string(), Ok("def456".to_string()))]),
            HashMap::from([("source-1".to_string(), Err("diff failed".to_string()))]),
        );

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
        assert_eq!(results[0].diff_summary, None);
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
