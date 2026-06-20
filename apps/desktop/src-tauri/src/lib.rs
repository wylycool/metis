//! Metis Desktop App — Tauri 后端
//!
//! Tauri command 是 UI 到 Core Engine 的薄封装层。
//! 核心逻辑全部在 metis-core 中实现。

use metis_core::discovery::{
    list_agents as core_list_agents, scan_and_index_skills, AgentStatus, ListAgentsOptions,
    ScanOptions, ScanResult,
};
use metis_core::rollback::{
    list_backups as core_list_backups, restore_backup as core_restore_backup,
    BackupSummary as CoreBackupSummary, RestoreBackupOptions, RestoreResult as CoreRestoreResult,
};
use metis_core::source::{
    bind_source as core_bind_source, unbind_source as core_unbind_source, Source, SourceInput,
    SourceType,
};
use metis_core::update::{
    apply_update as core_apply_update, check_updates as core_check_updates,
    get_diff as core_get_diff, ApplyUpdateOptions, ApplyUpdateResult as CoreApplyUpdateResult,
    DiffDetail as CoreDiffDetail, DiffStatus as CoreDiffStatus, DiffSummary, RemoteCommitChecker,
    UpdateCheckOptions, UpdateCheckResult, UpdateStatus,
};
use metis_git_provider::fetch::SystemGitCliProvider;
use metis_security::findings::{SecurityFinding, SecuritySeverity};
use metis_storage::db::{SkillIndexStore, SkillRecord, SourceRecord};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct DesktopAppState {
    sqlite_path: PathBuf,
    settings_path: PathBuf,
    backup_root: PathBuf,
    cache_root: PathBuf,
}

impl DesktopAppState {
    pub fn new(data_root: impl Into<PathBuf>, cache_root: impl Into<PathBuf>) -> Self {
        let data_root = data_root.into();
        let cache_root = cache_root.into().join("metis");

        Self {
            sqlite_path: data_root.join("metis.db"),
            settings_path: data_root.join("metis-settings.json"),
            backup_root: data_root.join("backups"),
            cache_root,
        }
    }

    pub fn from_system_paths() -> Result<Self, String> {
        let data_root = dirs::data_dir()
            .ok_or_else(|| "无法定位系统应用数据目录".to_string())?
            .join("com.metis.app");
        let cache_root = dirs::cache_dir()
            .ok_or_else(|| "无法定位系统缓存目录".to_string())?
            .join("com.metis.app");

        Ok(Self::new(data_root, cache_root))
    }

    pub fn sqlite_path(&self) -> &Path {
        &self.sqlite_path
    }

    pub fn settings_path(&self) -> &Path {
        &self.settings_path
    }

    pub fn backup_root(&self) -> &Path {
        &self.backup_root
    }

    pub fn cache_root(&self) -> &Path {
        &self.cache_root
    }

    fn open_store(&self) -> Result<SkillIndexStore, String> {
        self.ensure_dirs()?;
        SkillIndexStore::open(&self.sqlite_path).map_err(|error| error.to_string())
    }

    fn ensure_dirs(&self) -> Result<(), String> {
        if let Some(parent) = self.sqlite_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        if let Some(parent) = self.settings_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::create_dir_all(&self.backup_root).map_err(|error| error.to_string())?;
        fs::create_dir_all(&self.cache_root).map_err(|error| error.to_string())?;
        Ok(())
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DesktopScanRequest {
    pub agent_ids: Option<Vec<String>>,
    pub custom_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopAgentStatus {
    pub agent_id: String,
    pub agent_name: String,
    pub enabled: bool,
    pub paths: Vec<DesktopAgentPath>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopAgentPath {
    pub path: String,
    pub scope: String,
    pub exists: bool,
    pub readable: bool,
    pub writable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopSkill {
    pub id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub name: String,
    pub description: Option<String>,
    pub install_path: String,
    pub metadata_path: Option<String>,
    pub metadata_status: String,
    pub metadata_error: Option<String>,
    pub source_id: Option<String>,
    pub source: Option<DesktopSource>,
    pub local_modified: Option<bool>,
    pub last_scanned_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopSource {
    pub id: String,
    pub source_type: String,
    pub url: String,
    pub repo_path: String,
    pub ref_: String,
    pub current_commit: Option<String>,
    pub remote_commit: Option<String>,
    pub last_checked_at: Option<String>,
    pub trusted: bool,
    pub auto_update: bool,
    pub credential_ref: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopSettings {
    pub custom_scan_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopBindSourceRequest {
    pub skill_id: String,
    pub url: String,
    pub repo_path: String,
    pub ref_: String,
    pub credential_ref: Option<String>,
    pub trusted: bool,
    pub auto_update: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopUpdateCheckRequest {
    pub skill_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopUpdateCheckResult {
    pub skill_id: String,
    pub skill_name: String,
    pub status: String,
    pub failure_reason: Option<String>,
    pub local_modified: bool,
    pub commits_behind: Option<u32>,
    pub diff_summary: Option<DesktopDiffSummary>,
    pub source: Option<DesktopSource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopDiffSummary {
    pub files_added: u32,
    pub files_modified: u32,
    pub files_deleted: u32,
    pub total_changes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopDiffDetail {
    pub skill_id: String,
    pub current_commit: String,
    pub target_commit: String,
    pub files: Vec<DesktopFileDiff>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopFileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub patch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopApplyUpdateResult {
    pub skill_id: String,
    pub previous_commit: String,
    pub new_commit: String,
    pub backup_id: String,
    pub security_findings: Vec<DesktopSecurityFinding>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopSecurityFinding {
    pub severity: String,
    pub rule_id: String,
    pub message: String,
    pub relative_path: String,
    pub line: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopBackupSummary {
    pub backup_id: String,
    pub skill_id: String,
    pub source_commit: Option<String>,
    pub backup_path: String,
    pub created_at: String,
    pub reason: String,
    pub file_count: u64,
    pub total_size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopRestoreBackupRequest {
    pub skill_id: String,
    pub backup_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopRestoreBackupResult {
    pub skill_id: String,
    pub restored_from_backup_id: String,
    pub previous_state_backup_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopScanWarning {
    pub agent_id: String,
    pub path: String,
    pub skill_path: Option<String>,
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopEnvironmentReport {
    pub generated_at: String,
    pub total_skills: usize,
    pub bound_sources: usize,
    pub trusted_sources: usize,
    pub auto_update_sources: usize,
    pub local_modified_skills: usize,
    pub agents: Vec<DesktopAgentStatus>,
    pub skills: Vec<DesktopEnvironmentSkill>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopEnvironmentSkill {
    pub id: String,
    pub name: String,
    pub agent_id: String,
    pub install_path: String,
    pub metadata_status: String,
    pub local_modified: Option<bool>,
    pub source: Option<DesktopEnvironmentSource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopEnvironmentSource {
    pub url: String,
    pub repo_path: String,
    pub ref_: String,
    pub current_commit: Option<String>,
    pub remote_commit: Option<String>,
    pub trusted: bool,
    pub auto_update: bool,
    pub has_credential_ref: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopError {
    pub category: String,
    pub title: String,
    pub message: String,
    pub suggestion: String,
    pub debug_detail: Option<String>,
}

impl DesktopError {
    fn wire_string(self) -> String {
        serde_json::to_string(&self).unwrap_or(self.message)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopScanResponse {
    pub skills: Vec<DesktopSkill>,
    pub warnings: Vec<DesktopScanWarning>,
}

pub fn list_agents_for_state(state: &DesktopAppState) -> Result<Vec<DesktopAgentStatus>, String> {
    let settings = get_desktop_settings_for_state(state)?;
    Ok(core_list_agents(ListAgentsOptions {
        enabled_agent_ids: None,
        custom_paths: settings.custom_scan_paths,
    })
    .into_iter()
    .map(desktop_agent_status)
    .collect())
}

pub fn scan_skills_for_state(
    state: &DesktopAppState,
    mut request: DesktopScanRequest,
) -> Result<DesktopScanResponse, String> {
    let store = state.open_store()?;
    let settings = get_desktop_settings_for_state(state)?;
    request.custom_paths.extend(settings.custom_scan_paths);
    request.custom_paths = normalize_paths(request.custom_paths);
    let result = scan_and_index_skills(
        ScanOptions {
            agent_ids: request.agent_ids,
            custom_paths: request.custom_paths,
        },
        &store,
    )
    .map_err(|error| error.to_string())?;

    desktop_scan_response(result, &store)
}

pub fn list_indexed_skills_for_state(state: &DesktopAppState) -> Result<Vec<DesktopSkill>, String> {
    let store = state.open_store()?;
    list_indexed_skills_from_store(&store)
}

pub fn get_desktop_settings_for_state(state: &DesktopAppState) -> Result<DesktopSettings, String> {
    state.ensure_dirs()?;
    if !state.settings_path().exists() {
        return Ok(DesktopSettings::default());
    }

    let contents = fs::read_to_string(state.settings_path()).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

pub fn save_desktop_settings_for_state(
    state: &DesktopAppState,
    settings: DesktopSettings,
) -> Result<DesktopSettings, String> {
    state.ensure_dirs()?;
    let normalized = DesktopSettings {
        custom_scan_paths: normalize_paths(settings.custom_scan_paths),
    };
    let contents = serde_json::to_string_pretty(&normalized).map_err(|error| error.to_string())?;
    fs::write(state.settings_path(), contents).map_err(|error| error.to_string())?;
    Ok(normalized)
}

pub fn bind_skill_source_for_state(
    state: &DesktopAppState,
    request: DesktopBindSourceRequest,
) -> Result<DesktopSource, String> {
    let store = state.open_store()?;
    let source = core_bind_source(
        &request.skill_id,
        SourceInput {
            source_type: SourceType::Git,
            url: request.url,
            repo_path: request.repo_path,
            ref_: request.ref_,
            credential_ref: normalize_optional_text(request.credential_ref),
            auto_update: request.auto_update,
            trusted: request.trusted,
        },
        &store,
    )
    .map_err(|error| error.to_string())?;

    Ok(desktop_source_from_core(source))
}

pub fn unbind_skill_source_for_state(
    state: &DesktopAppState,
    skill_id: String,
) -> Result<(), String> {
    let store = state.open_store()?;
    core_unbind_source(&skill_id, &store).map_err(|error| error.to_string())
}

pub fn check_skill_updates_for_state_with_checker<C: RemoteCommitChecker>(
    state: &DesktopAppState,
    request: DesktopUpdateCheckRequest,
    checker: &C,
) -> Result<Vec<DesktopUpdateCheckResult>, String> {
    let mut store = state.open_store()?;
    let results = core_check_updates(
        UpdateCheckOptions {
            skill_ids: request.skill_ids,
        },
        &mut store,
        checker,
    );

    Ok(results
        .into_iter()
        .map(desktop_update_check_result)
        .collect())
}

pub fn get_skill_diff_for_state_with_checker<C: RemoteCommitChecker>(
    state: &DesktopAppState,
    skill_id: String,
    checker: &C,
) -> Result<DesktopDiffDetail, String> {
    let store = state.open_store()?;
    core_get_diff(&skill_id, &store, checker)
        .map(desktop_diff_detail)
        .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())
}

pub fn apply_skill_update_for_state_with_checker<C: RemoteCommitChecker>(
    state: &DesktopAppState,
    skill_id: String,
    checker: &C,
) -> Result<DesktopApplyUpdateResult, String> {
    let mut store = state.open_store()?;
    core_apply_update(
        ApplyUpdateOptions {
            skill_id,
            backup_root: state.backup_root().to_string_lossy().to_string(),
            cache_dir: state.cache_root().to_string_lossy().to_string(),
        },
        &mut store,
        checker,
    )
    .map(desktop_apply_update_result)
    .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())
}

pub fn list_skill_backups_for_state(
    state: &DesktopAppState,
    skill_id: String,
) -> Result<Vec<DesktopBackupSummary>, String> {
    let store = state.open_store()?;
    core_list_backups(&skill_id, &store)
        .map(|backups| backups.into_iter().map(desktop_backup_summary).collect())
        .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())
}

pub fn restore_skill_backup_for_state(
    state: &DesktopAppState,
    request: DesktopRestoreBackupRequest,
) -> Result<DesktopRestoreBackupResult, String> {
    let mut store = state.open_store()?;
    core_restore_backup(
        RestoreBackupOptions {
            skill_id: request.skill_id,
            backup_id: request.backup_id,
            backup_root: state.backup_root().to_string_lossy().to_string(),
        },
        &mut store,
    )
    .map(desktop_restore_backup_result)
    .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())
}

pub fn export_environment_report_for_state(
    state: &DesktopAppState,
) -> Result<DesktopEnvironmentReport, String> {
    let store = state.open_store()?;
    let agents = list_agents_for_state(state)?;
    let skills = list_indexed_skills_from_store(&store)?;
    let mut report_skills = Vec::new();
    let mut bound_sources = 0;
    let mut trusted_sources = 0;
    let mut auto_update_sources = 0;
    let mut local_modified_skills = 0;

    for skill in skills {
        if skill.local_modified == Some(true) {
            local_modified_skills += 1;
        }
        let source = skill.source.map(|source| {
            bound_sources += 1;
            if source.trusted {
                trusted_sources += 1;
            }
            if source.auto_update {
                auto_update_sources += 1;
            }
            DesktopEnvironmentSource {
                url: source.url,
                repo_path: source.repo_path,
                ref_: source.ref_,
                current_commit: source.current_commit,
                remote_commit: source.remote_commit,
                trusted: source.trusted,
                auto_update: source.auto_update,
                has_credential_ref: source.credential_ref.is_some(),
            }
        });
        report_skills.push(DesktopEnvironmentSkill {
            id: skill.id,
            name: skill.name,
            agent_id: skill.agent_id,
            install_path: skill.install_path,
            metadata_status: skill.metadata_status,
            local_modified: skill.local_modified,
            source,
        });
    }

    Ok(DesktopEnvironmentReport {
        generated_at: current_timestamp_string(),
        total_skills: report_skills.len(),
        bound_sources,
        trusted_sources,
        auto_update_sources,
        local_modified_skills,
        agents,
        skills: report_skills,
    })
}

fn current_timestamp_string() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    format!("unix:{seconds}")
}

#[tauri::command]
fn list_agents(
    state: tauri::State<'_, DesktopAppState>,
) -> Result<Vec<DesktopAgentStatus>, String> {
    list_agents_for_state(&state)
}

#[tauri::command]
fn scan_skills(state: tauri::State<'_, DesktopAppState>) -> Result<DesktopScanResponse, String> {
    scan_skills_for_state(&state, DesktopScanRequest::default())
}

#[tauri::command]
fn list_indexed_skills(
    state: tauri::State<'_, DesktopAppState>,
) -> Result<Vec<DesktopSkill>, String> {
    list_indexed_skills_for_state(&state)
}

#[tauri::command]
fn get_desktop_settings(
    state: tauri::State<'_, DesktopAppState>,
) -> Result<DesktopSettings, String> {
    get_desktop_settings_for_state(&state)
}

#[tauri::command]
fn save_desktop_settings(
    state: tauri::State<'_, DesktopAppState>,
    settings: DesktopSettings,
) -> Result<DesktopSettings, String> {
    save_desktop_settings_for_state(&state, settings)
}

#[tauri::command]
fn bind_skill_source(
    state: tauri::State<'_, DesktopAppState>,
    request: DesktopBindSourceRequest,
) -> Result<DesktopSource, String> {
    bind_skill_source_for_state(&state, request)
}

#[tauri::command]
fn unbind_skill_source(
    state: tauri::State<'_, DesktopAppState>,
    skill_id: String,
) -> Result<(), String> {
    unbind_skill_source_for_state(&state, skill_id)
}

#[tauri::command]
fn check_skill_updates(
    state: tauri::State<'_, DesktopAppState>,
    request: DesktopUpdateCheckRequest,
) -> Result<Vec<DesktopUpdateCheckResult>, String> {
    let checker = system_git_checker_for_state(&state);
    check_skill_updates_for_state_with_checker(&state, request, &checker)
}

#[tauri::command]
fn get_skill_diff(
    state: tauri::State<'_, DesktopAppState>,
    skill_id: String,
) -> Result<DesktopDiffDetail, String> {
    let checker = system_git_checker_for_state(&state);
    get_skill_diff_for_state_with_checker(&state, skill_id, &checker)
}

#[tauri::command]
fn apply_skill_update(
    state: tauri::State<'_, DesktopAppState>,
    skill_id: String,
) -> Result<DesktopApplyUpdateResult, String> {
    let checker = system_git_checker_for_state(&state);
    apply_skill_update_for_state_with_checker(&state, skill_id, &checker)
}

#[tauri::command]
fn list_skill_backups(
    state: tauri::State<'_, DesktopAppState>,
    skill_id: String,
) -> Result<Vec<DesktopBackupSummary>, String> {
    list_skill_backups_for_state(&state, skill_id)
}

#[tauri::command]
fn restore_skill_backup(
    state: tauri::State<'_, DesktopAppState>,
    request: DesktopRestoreBackupRequest,
) -> Result<DesktopRestoreBackupResult, String> {
    restore_skill_backup_for_state(&state, request)
}

#[tauri::command]
fn export_environment_report(
    state: tauri::State<'_, DesktopAppState>,
) -> Result<DesktopEnvironmentReport, String> {
    export_environment_report_for_state(&state)
}

fn desktop_scan_response(
    result: ScanResult,
    store: &SkillIndexStore,
) -> Result<DesktopScanResponse, String> {
    Ok(DesktopScanResponse {
        skills: list_indexed_skills_from_store(store)?,
        warnings: result
            .warnings
            .into_iter()
            .map(|warning| DesktopScanWarning {
                agent_id: warning.agent_id,
                path: warning.path,
                skill_path: warning.skill_path,
                kind: format!("{:?}", warning.kind),
                message: warning.message,
            })
            .collect(),
    })
}

fn system_git_checker_for_state(state: &DesktopAppState) -> SystemGitCliProvider {
    SystemGitCliProvider::with_cache_root(
        metis_git_provider::fetch::SystemGitRunner,
        state.cache_root().to_string_lossy().to_string(),
    )
}

fn normalize_paths(paths: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() || normalized.iter().any(|item| item == trimmed) {
            continue;
        }
        normalized.push(trimmed.to_string());
    }
    normalized
}

fn list_indexed_skills_from_store(store: &SkillIndexStore) -> Result<Vec<DesktopSkill>, String> {
    store
        .list_skills()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|skill| desktop_skill(skill, store))
        .collect()
}

fn desktop_skill(record: SkillRecord, store: &SkillIndexStore) -> Result<DesktopSkill, String> {
    let source = match record.source_id.as_deref() {
        Some(source_id) => store
            .get_source(source_id)
            .map_err(|error| error.to_string())?
            .map(desktop_source_from_record),
        None => None,
    };

    Ok(DesktopSkill {
        id: record.id,
        agent_id: record.agent_id.clone(),
        agent_name: agent_name(&record.agent_id).to_string(),
        name: record.name,
        description: record.description,
        install_path: record.install_path,
        metadata_path: record.metadata_path,
        metadata_status: record.metadata_status,
        metadata_error: record.metadata_error,
        source_id: record.source_id,
        source,
        local_modified: record.local_modified,
        last_scanned_at: record.last_scanned_at,
    })
}

fn desktop_source_from_core(source: Source) -> DesktopSource {
    DesktopSource {
        id: source.id,
        source_type: match source.source_type {
            SourceType::Git => "git".to_string(),
        },
        url: source.url,
        repo_path: source.repo_path,
        ref_: source.ref_,
        current_commit: source.current_commit,
        remote_commit: source.remote_commit,
        last_checked_at: source.last_checked_at,
        trusted: source.trusted,
        auto_update: source.auto_update,
        credential_ref: source.credential_ref,
    }
}

fn desktop_source_from_record(source: SourceRecord) -> DesktopSource {
    DesktopSource {
        id: source.id,
        source_type: source.source_type,
        url: source.url,
        repo_path: source.repo_path,
        ref_: source.ref_,
        current_commit: source.current_commit,
        remote_commit: source.remote_commit,
        last_checked_at: source.last_checked_at,
        trusted: source.trusted,
        auto_update: source.auto_update,
        credential_ref: source.credential_ref,
    }
}

fn desktop_update_check_result(result: UpdateCheckResult) -> DesktopUpdateCheckResult {
    let (status, failure_reason) = match result.status {
        UpdateStatus::UpToDate => ("UpToDate".to_string(), None),
        UpdateStatus::UpdateAvailable => ("UpdateAvailable".to_string(), None),
        UpdateStatus::NoSource => ("NoSource".to_string(), None),
        UpdateStatus::CheckFailed { reason } => (
            "CheckFailed".to_string(),
            Some(friendly_desktop_error(&reason).message),
        ),
    };

    DesktopUpdateCheckResult {
        skill_id: result.skill_id,
        skill_name: result.skill_name,
        status,
        failure_reason,
        local_modified: result.local_modified,
        commits_behind: result.commits_behind,
        diff_summary: result.diff_summary.map(desktop_diff_summary),
        source: result.source.map(desktop_source_from_record),
    }
}

fn desktop_diff_summary(summary: DiffSummary) -> DesktopDiffSummary {
    DesktopDiffSummary {
        files_added: summary.files_added,
        files_modified: summary.files_modified,
        files_deleted: summary.files_deleted,
        total_changes: summary.total_changes,
    }
}

fn desktop_diff_detail(detail: CoreDiffDetail) -> DesktopDiffDetail {
    DesktopDiffDetail {
        skill_id: detail.skill_id,
        current_commit: detail.current_commit,
        target_commit: detail.target_commit,
        files: detail
            .files
            .into_iter()
            .map(|file| DesktopFileDiff {
                path: file.path,
                old_path: file.old_path,
                status: match file.status {
                    CoreDiffStatus::Added => "Added",
                    CoreDiffStatus::Modified => "Modified",
                    CoreDiffStatus::Deleted => "Deleted",
                    CoreDiffStatus::Renamed => "Renamed",
                }
                .to_string(),
                patch: file.patch,
            })
            .collect(),
    }
}

fn desktop_apply_update_result(result: CoreApplyUpdateResult) -> DesktopApplyUpdateResult {
    DesktopApplyUpdateResult {
        skill_id: result.skill_id,
        previous_commit: result.previous_commit,
        new_commit: result.new_commit,
        backup_id: result.backup_id,
        security_findings: result
            .security_findings
            .into_iter()
            .map(desktop_security_finding)
            .collect(),
        warnings: result.warnings,
    }
}

fn desktop_security_finding(finding: SecurityFinding) -> DesktopSecurityFinding {
    DesktopSecurityFinding {
        severity: match finding.severity {
            SecuritySeverity::Info => "Info",
            SecuritySeverity::Warning => "Warning",
            SecuritySeverity::High => "High",
        }
        .to_string(),
        rule_id: finding.rule_id,
        message: finding.message,
        relative_path: finding.relative_path,
        line: finding.line,
    }
}

fn desktop_backup_summary(backup: CoreBackupSummary) -> DesktopBackupSummary {
    DesktopBackupSummary {
        backup_id: backup.backup_id,
        skill_id: backup.skill_id,
        source_commit: backup.source_commit,
        backup_path: backup.backup_path,
        created_at: backup.created_at,
        reason: backup.reason,
        file_count: backup.file_count,
        total_size_bytes: backup.total_size_bytes,
    }
}

fn desktop_restore_backup_result(result: CoreRestoreResult) -> DesktopRestoreBackupResult {
    DesktopRestoreBackupResult {
        skill_id: result.skill_id,
        restored_from_backup_id: result.restored_from_backup_id,
        previous_state_backup_id: result.previous_state_backup_id,
    }
}

fn desktop_agent_status(status: AgentStatus) -> DesktopAgentStatus {
    DesktopAgentStatus {
        agent_id: status.agent_id,
        agent_name: status.agent_name,
        enabled: status.enabled,
        paths: status
            .paths
            .into_iter()
            .map(|path| DesktopAgentPath {
                path: path.path,
                scope: format!("{:?}", path.scope),
                exists: path.exists,
                readable: path.readable,
                writable: path.writable,
            })
            .collect(),
    }
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn friendly_desktop_error(message: &str) -> DesktopError {
    let lower = message.to_ascii_lowercase();

    if lower.contains("apply failed and rollback succeeded") {
        return desktop_error(
            "apply_rollback_succeeded",
            "更新失败，已自动回滚",
            "应用更新时发生错误，Metis 已恢复到更新前备份。",
            "确认本地目录可写、磁盘空间充足后重新检查更新；如问题重复，请保留调试详情。",
            message,
        );
    }

    if lower.contains("apply failed and rollback failed") {
        return desktop_error(
            "apply_rollback_failed",
            "更新失败，自动回滚也失败",
            "应用更新和自动回滚都没有完成，本地 skill 可能处于不完整状态。",
            "请先不要继续更新，使用备份面板或备份目录手动恢复，并保留调试详情排查。",
            message,
        );
    }

    if lower.contains("auth")
        || lower.contains("authentication")
        || lower.contains("permission denied")
        || lower.contains("could not read username")
        || lower.contains("repository not found")
        || lower.contains("access denied")
    {
        return desktop_error(
            "authentication",
            "认证失败",
            "无法访问该 Git source，请确认本机 Git 认证可以正常读取仓库。",
            "检查仓库权限、SSH agent 或 Git credential helper；凭据引用只作为备注名保存，Metis 不会读取 Keychain/token。",
            message,
        );
    }

    if lower.contains("local modified") || lower.contains("本地修改") {
        return desktop_error(
            "local_modified",
            "本地修改阻断",
            "当前 skill 目录存在本地修改，Metis 已停止自动覆盖。",
            "先查看本地改动并决定保留或备份，再重新执行更新。",
            message,
        );
    }

    if lower.contains("security blocked") || lower.contains("security findings") {
        return desktop_error(
            "security_blocked",
            "安全检查阻断",
            "更新内容触发 High 风险安全检查，Metis 没有覆盖本地文件。",
            "请人工检查 diff 和安全发现，确认可信后再考虑手动处理。",
            message,
        );
    }

    if lower.contains("sqlite") || lower.contains("database") || lower.contains("sql") {
        return desktop_error(
            "sqlite",
            "本地数据库错误",
            "Metis 无法读取或写入本地 SQLite 索引。",
            "确认应用数据目录可写，必要时备份后重启应用再试。",
            message,
        );
    }

    if lower.contains("no such file or directory")
        || lower.contains("not a directory")
        || lower.contains("path")
        || lower.contains("不可读")
        || lower.contains("不可写")
    {
        return desktop_error(
            "path",
            "本地路径错误",
            "Metis 无法访问需要的本地路径。",
            "确认 skill 目录、扫描路径或备份目录存在且当前用户有读写权限。",
            message,
        );
    }

    if lower.contains("source check failed")
        || lower.contains("checkout failed")
        || lower.contains("missing current commit")
        || lower.contains("missing remote commit")
        || lower.contains("no source")
        || lower.contains("repo_path")
    {
        return desktop_error(
            "git_source",
            "Git source 错误",
            "Metis 无法根据当前来源信息完成 Git 检查或 checkout。",
            "检查 Git URL、ref、repo path 和本机 Git 是否可正常访问该仓库。",
            message,
        );
    }

    desktop_error(
        "unknown",
        "操作失败",
        "桌面后端返回了暂未分类的错误。",
        "请保留调试详情，并在重试前确认当前操作目标没有被其他进程占用。",
        message,
    )
}

fn desktop_error(
    category: &str,
    title: &str,
    message: &str,
    suggestion: &str,
    debug_detail: &str,
) -> DesktopError {
    DesktopError {
        category: category.to_string(),
        title: title.to_string(),
        message: message.to_string(),
        suggestion: suggestion.to_string(),
        debug_detail: Some(debug_detail.to_string()),
    }
}

fn agent_name(agent_id: &str) -> &str {
    match agent_id {
        "codex" => "Codex",
        "claude-code" => "Claude Code",
        "openclaw" => "OpenClaw",
        "hermes" => "Hermes",
        "opencode" => "opencode",
        "generic" => "Generic Agent Skills",
        _ => agent_id,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state =
        DesktopAppState::from_system_paths().expect("desktop state should initialize paths");

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            list_agents,
            scan_skills,
            list_indexed_skills,
            get_desktop_settings,
            save_desktop_settings,
            bind_skill_source,
            unbind_skill_source,
            check_skill_updates,
            get_skill_diff,
            apply_skill_update,
            list_skill_backups,
            restore_skill_backup,
            export_environment_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use metis_core::local_state::capture_local_baseline;
    use metis_core::rollback::{create_backup, CreateBackupOptions};
    use metis_core::update::{
        CheckoutResult, DiffDetail, DiffStatus, DiffSummary, FileDiff, RemoteCommitChecker,
    };
    use metis_storage::db::SourceRecord;
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct FakeUpdateChecker {
        commits: HashMap<String, String>,
        behind: u32,
        summary: DiffSummary,
        details: HashMap<String, DiffDetail>,
        checkout: Option<CheckoutResult>,
    }

    impl RemoteCommitChecker for FakeUpdateChecker {
        fn remote_commit(&self, source: &SourceRecord) -> Result<String, String> {
            self.commits
                .get(&source.id)
                .cloned()
                .ok_or_else(|| "missing fake commit".to_string())
        }

        fn diff_summary(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<DiffSummary, String> {
            Ok(self.summary.clone())
        }

        fn commits_behind(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<u32, String> {
            Ok(self.behind)
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
                .ok_or_else(|| "missing fake diff detail".to_string())
        }

        fn checkout_to_cache(
            &self,
            _source: &SourceRecord,
            _target_commit: &str,
            _cache_dir: &str,
        ) -> Result<CheckoutResult, String> {
            self.checkout
                .clone()
                .ok_or_else(|| "missing fake checkout".to_string())
        }
    }

    struct AuthFailureChecker;

    impl RemoteCommitChecker for AuthFailureChecker {
        fn remote_commit(&self, _source: &SourceRecord) -> Result<String, String> {
            Err("authentication failed: could not read Username".to_string())
        }

        fn diff_summary(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<DiffSummary, String> {
            unreachable!("auth failure should stop before diff summary")
        }

        fn commits_behind(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<u32, String> {
            unreachable!("auth failure should stop before commits behind")
        }

        fn diff_detail(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<DiffDetail, String> {
            unreachable!("auth failure should stop before diff detail")
        }

        fn checkout_to_cache(
            &self,
            _source: &SourceRecord,
            _target_commit: &str,
            _cache_dir: &str,
        ) -> Result<CheckoutResult, String> {
            unreachable!("auth failure should stop before checkout")
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("metis-desktop-{}-{}", name, suffix))
    }

    fn write_skill(root: &Path, dir_name: &str, name: &str, description: &str) -> PathBuf {
        let skill_dir = root.join(dir_name);
        fs::create_dir_all(&skill_dir).expect("skill dir should be created");
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
        skill_dir
    }

    #[test]
    fn scan_skills_for_state_indexes_and_returns_desktop_dtos() {
        let workspace = temp_dir("scan-state");
        let skill_root = workspace.join("skills");
        let data_root = workspace.join("data");
        let cache_root = workspace.join("cache");
        fs::create_dir_all(&skill_root).expect("skill root should be created");
        let skill_dir = write_skill(
            &skill_root,
            "planner",
            "planner",
            "Plans focused implementation work",
        );
        let state = DesktopAppState::new(data_root.clone(), cache_root);

        let response = scan_skills_for_state(
            &state,
            DesktopScanRequest {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("scan should succeed");
        let indexed = list_indexed_skills_for_state(&state).expect("indexed skills should load");

        if workspace.exists() {
            fs::remove_dir_all(&workspace).expect("workspace should be removed");
        }

        assert!(response.warnings.is_empty());
        assert_eq!(response.skills.len(), 1);
        assert_eq!(indexed.len(), 1);

        let skill = &indexed[0];
        assert_eq!(skill.agent_id, "generic");
        assert_eq!(skill.agent_name, "Generic Agent Skills");
        assert_eq!(skill.name, "planner");
        assert_eq!(
            skill.description.as_deref(),
            Some("Plans focused implementation work")
        );
        assert_eq!(skill.install_path, skill_dir.to_string_lossy());
        assert_eq!(skill.metadata_status, "found");
        assert_eq!(skill.local_modified, None);
        assert!(state.sqlite_path().starts_with(&data_root));
        assert!(state.backup_root().starts_with(&data_root));
    }

    #[test]
    fn list_agents_for_state_returns_default_agent_paths() {
        let workspace = temp_dir("agents-state");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));

        let agents = list_agents_for_state(&state).expect("agents should load");

        if workspace.exists() {
            fs::remove_dir_all(&workspace).expect("workspace should be removed");
        }

        let agent_ids = agents
            .iter()
            .map(|agent| agent.agent_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            agent_ids,
            vec![
                "codex",
                "claude-code",
                "openclaw",
                "hermes",
                "opencode",
                "generic"
            ]
        );
        assert!(agents.iter().all(|agent| !agent.paths.is_empty()));
    }

    #[test]
    fn list_agents_for_state_includes_saved_custom_scan_paths() {
        let workspace = temp_dir("agents-custom-state");
        let custom_root = workspace.join("custom-skills");
        fs::create_dir_all(&custom_root).expect("custom root should be created");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        save_desktop_settings_for_state(
            &state,
            DesktopSettings {
                custom_scan_paths: vec![custom_root.to_string_lossy().to_string()],
            },
        )
        .expect("settings should save");

        let agents = list_agents_for_state(&state).expect("agents should load");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        let generic = agents
            .iter()
            .find(|agent| agent.agent_id == "generic")
            .expect("generic agent should exist");
        assert!(generic
            .paths
            .iter()
            .any(|path| path.path == custom_root.to_string_lossy() && path.exists));
    }

    #[test]
    fn desktop_settings_default_when_file_is_missing_and_save_normalizes_paths() {
        let workspace = temp_dir("settings-state");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));

        let default_settings =
            get_desktop_settings_for_state(&state).expect("default settings should load");
        let saved = save_desktop_settings_for_state(
            &state,
            DesktopSettings {
                custom_scan_paths: vec![
                    "  /tmp/metis/custom  ".to_string(),
                    "".to_string(),
                    "/tmp/metis/custom".to_string(),
                    "/tmp/metis/other".to_string(),
                ],
            },
        )
        .expect("settings should save");
        let loaded = get_desktop_settings_for_state(&state).expect("settings should reload");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert!(default_settings.custom_scan_paths.is_empty());
        assert_eq!(
            saved.custom_scan_paths,
            vec!["/tmp/metis/custom", "/tmp/metis/other"]
        );
        assert_eq!(loaded, saved);
    }

    #[test]
    fn scan_skills_for_state_uses_saved_custom_scan_paths() {
        let workspace = temp_dir("settings-scan");
        let skill_root = workspace.join("custom-skills");
        fs::create_dir_all(&skill_root).expect("skill root should be created");
        let skill_dir = write_skill(&skill_root, "mapper", "mapper", "Maps custom paths");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        save_desktop_settings_for_state(
            &state,
            DesktopSettings {
                custom_scan_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("settings should save");

        let response =
            scan_skills_for_state(&state, DesktopScanRequest::default()).expect("scan should work");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert!(response.skills.iter().any(|skill| {
            skill.name == "mapper" && skill.install_path == skill_dir.to_string_lossy()
        }));
    }

    #[test]
    fn bind_skill_source_for_state_persists_source_and_embeds_it_in_skill_dto() {
        let workspace = temp_dir("bind-source");
        let skill_root = workspace.join("skills");
        let data_root = workspace.join("data");
        let cache_root = workspace.join("cache");
        fs::create_dir_all(&skill_root).expect("skill root should be created");
        write_skill(&skill_root, "writer", "writer", "Writes things");
        let state = DesktopAppState::new(data_root, cache_root);
        let scanned = scan_skills_for_state(
            &state,
            DesktopScanRequest {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("scan should succeed");
        let skill_id = scanned.skills[0].id.clone();

        let source = bind_skill_source_for_state(
            &state,
            DesktopBindSourceRequest {
                skill_id: skill_id.clone(),
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/writer".to_string(),
                ref_: "main".to_string(),
                credential_ref: Some(" github-main ".to_string()),
                trusted: true,
                auto_update: false,
            },
        )
        .expect("source should bind");
        let indexed = list_indexed_skills_for_state(&state).expect("indexed skills should load");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(source.source_type, "git");
        assert_eq!(source.url, "https://github.com/example/metis-skills.git");
        assert_eq!(source.repo_path, "skills/writer");
        assert_eq!(source.credential_ref.as_deref(), Some("github-main"));
        assert!(source.trusted);
        assert_eq!(indexed[0].source_id.as_deref(), Some(source.id.as_str()));
        assert_eq!(
            indexed[0].source.as_ref().map(|item| item.id.as_str()),
            Some(source.id.as_str())
        );
        assert_eq!(
            indexed[0]
                .source
                .as_ref()
                .and_then(|item| item.credential_ref.as_deref()),
            Some("github-main")
        );
    }

    #[test]
    fn unbind_skill_source_for_state_clears_source_from_skill_dto() {
        let workspace = temp_dir("unbind-source");
        let skill_root = workspace.join("skills");
        fs::create_dir_all(&skill_root).expect("skill root should be created");
        write_skill(&skill_root, "reviewer", "reviewer", "Reviews work");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let scanned = scan_skills_for_state(
            &state,
            DesktopScanRequest {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("scan should succeed");
        let skill_id = scanned.skills[0].id.clone();
        bind_skill_source_for_state(
            &state,
            DesktopBindSourceRequest {
                skill_id: skill_id.clone(),
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/reviewer".to_string(),
                ref_: "main".to_string(),
                credential_ref: None,
                trusted: false,
                auto_update: false,
            },
        )
        .expect("source should bind");

        unbind_skill_source_for_state(&state, skill_id).expect("source should unbind");
        let indexed = list_indexed_skills_for_state(&state).expect("indexed skills should load");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(indexed[0].source_id, None);
        assert_eq!(indexed[0].source, None);
    }

    #[test]
    fn check_skill_updates_for_state_returns_update_status_with_fake_checker() {
        let workspace = temp_dir("check-updates");
        let skill_root = workspace.join("skills");
        fs::create_dir_all(&skill_root).expect("skill root should be created");
        write_skill(&skill_root, "updater", "updater", "Checks updates");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let scanned = scan_skills_for_state(
            &state,
            DesktopScanRequest {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("scan should succeed");
        let skill_id = scanned.skills[0].id.clone();
        let source = bind_skill_source_for_state(
            &state,
            DesktopBindSourceRequest {
                skill_id: skill_id.clone(),
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/updater".to_string(),
                ref_: "main".to_string(),
                credential_ref: Some("".to_string()),
                trusted: true,
                auto_update: false,
            },
        )
        .expect("source should bind");
        let store = state.open_store().expect("store should open");
        store
            .update_source_check_result(
                &source.id,
                Some("aaa111"),
                Some("aaa111"),
                "2026-06-19T00:00:00Z",
            )
            .expect("source current commit should update");
        let mut commits = HashMap::new();
        commits.insert(source.id.clone(), "bbb222".to_string());
        let checker = FakeUpdateChecker {
            commits,
            behind: 2,
            summary: DiffSummary {
                files_added: 1,
                files_modified: 2,
                files_deleted: 0,
                total_changes: 3,
            },
            details: HashMap::new(),
            checkout: None,
        };

        let results = check_skill_updates_for_state_with_checker(
            &state,
            DesktopUpdateCheckRequest {
                skill_ids: vec![skill_id],
            },
            &checker,
        )
        .expect("update check should succeed");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status, "UpdateAvailable");
        assert_eq!(results[0].failure_reason, None);
        assert_eq!(results[0].commits_behind, Some(2));
        assert_eq!(
            results[0]
                .diff_summary
                .as_ref()
                .map(|summary| summary.total_changes),
            Some(3)
        );
        assert_eq!(
            results[0]
                .source
                .as_ref()
                .and_then(|item| item.remote_commit.as_deref()),
            Some("bbb222")
        );
    }

    #[test]
    fn check_skill_updates_for_state_returns_friendly_auth_failure_message() {
        let workspace = temp_dir("auth-failure");
        let skill_root = workspace.join("skills");
        fs::create_dir_all(&skill_root).expect("skill root should be created");
        write_skill(&skill_root, "private", "private", "Checks private sources");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let scanned = scan_skills_for_state(
            &state,
            DesktopScanRequest {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("scan should succeed");
        let skill_id = scanned.skills[0].id.clone();
        let source = bind_skill_source_for_state(
            &state,
            DesktopBindSourceRequest {
                skill_id: skill_id.clone(),
                url: "https://github.com/example/private-skills.git".to_string(),
                repo_path: "skills/private".to_string(),
                ref_: "main".to_string(),
                credential_ref: Some("work-github".to_string()),
                trusted: true,
                auto_update: false,
            },
        )
        .expect("source should bind");
        let store = state.open_store().expect("store should open");
        store
            .update_source_check_result(
                &source.id,
                Some("aaa111"),
                Some("aaa111"),
                "2026-06-19T00:00:00Z",
            )
            .expect("source current commit should update");
        let checker = AuthFailureChecker;

        let results = check_skill_updates_for_state_with_checker(
            &state,
            DesktopUpdateCheckRequest {
                skill_ids: vec![skill_id],
            },
            &checker,
        )
        .expect("update check should return status results");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(results[0].status, "CheckFailed");
        assert_eq!(
            results[0].failure_reason.as_deref(),
            Some("无法访问该 Git source，请确认本机 Git 认证可以正常读取仓库。")
        );
    }

    #[test]
    fn desktop_error_classifies_auth_failure_with_user_suggestion_and_debug_detail() {
        let error = friendly_desktop_error(
            "authentication failed: could not read Username for 'https://github.com'",
        );

        assert_eq!(error.category, "authentication");
        assert_eq!(error.title, "认证失败");
        assert_eq!(
            error.message,
            "无法访问该 Git source，请确认本机 Git 认证可以正常读取仓库。"
        );
        assert_eq!(
            error.suggestion,
            "检查仓库权限、SSH agent 或 Git credential helper；凭据引用只作为备注名保存，Metis 不会读取 Keychain/token。"
        );
        assert_eq!(
            error.debug_detail.as_deref(),
            Some("authentication failed: could not read Username for 'https://github.com'")
        );
    }

    #[test]
    fn desktop_error_classifies_common_phase3_failure_modes() {
        let cases = [
            (
                "local modified",
                "local_modified",
                "本地修改阻断",
                "当前 skill 目录存在本地修改，Metis 已停止自动覆盖。",
            ),
            (
                "security blocked",
                "security_blocked",
                "安全检查阻断",
                "更新内容触发 High 风险安全检查，Metis 没有覆盖本地文件。",
            ),
            (
                "apply failed and rollback succeeded: permission denied",
                "apply_rollback_succeeded",
                "更新失败，已自动回滚",
                "应用更新时发生错误，Metis 已恢复到更新前备份。",
            ),
            (
                "apply failed and rollback failed: apply=no such file, rollback=permission denied",
                "apply_rollback_failed",
                "更新失败，自动回滚也失败",
                "应用更新和自动回滚都没有完成，本地 skill 可能处于不完整状态。",
            ),
            (
                "sqlite error: database is locked",
                "sqlite",
                "本地数据库错误",
                "Metis 无法读取或写入本地 SQLite 索引。",
            ),
            (
                "checkout failed: missing remote commit",
                "git_source",
                "Git source 错误",
                "Metis 无法根据当前来源信息完成 Git 检查或 checkout。",
            ),
        ];

        for (raw, category, title, message) in cases {
            let error = friendly_desktop_error(raw);
            assert_eq!(error.category, category);
            assert_eq!(error.title, title);
            assert_eq!(error.message, message);
            assert_eq!(error.debug_detail.as_deref(), Some(raw));
        }
    }

    #[test]
    fn export_environment_report_summarizes_beta_state_without_credential_values() {
        let workspace = temp_dir("environment-report");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let store = state.open_store().expect("store should open");
        store
            .upsert_source(&SourceRecord {
                id: "source-trusted".to_string(),
                source_type: "git".to_string(),
                url: "file:///tmp/metis-trusted".to_string(),
                repo_path: "skills/trusted".to_string(),
                ref_: "main".to_string(),
                current_commit: Some("aaa111".to_string()),
                remote_commit: Some("bbb222".to_string()),
                last_checked_at: Some("2026-06-20T10:00:00Z".to_string()),
                trusted: true,
                auto_update: true,
                credential_ref: Some("secret-token".to_string()),
                created_at: None,
                updated_at: None,
            })
            .expect("source should insert");
        store
            .upsert_skill(&SkillRecord {
                id: "trusted-skill".to_string(),
                agent_id: "generic".to_string(),
                name: "Trusted Skill".to_string(),
                description: Some("Trusted beta skill".to_string()),
                version: None,
                author: None,
                license: None,
                tags: Vec::new(),
                category: None,
                install_path: workspace
                    .join("skills/trusted-skill")
                    .to_string_lossy()
                    .to_string(),
                scope: "custom".to_string(),
                metadata_path: None,
                metadata_status: "found".to_string(),
                metadata_error: None,
                source_id: Some("source-trusted".to_string()),
                local_fingerprint: None,
                local_modified: Some(false),
                last_scanned_at: "2026-06-20T10:00:00Z".to_string(),
            })
            .expect("skill should insert");

        let report =
            export_environment_report_for_state(&state).expect("environment report should export");
        let json = serde_json::to_string(&report).expect("report should serialize");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(report.total_skills, 1);
        assert_eq!(report.bound_sources, 1);
        assert_eq!(report.trusted_sources, 1);
        assert_eq!(report.auto_update_sources, 1);
        assert_eq!(report.local_modified_skills, 0);
        assert!(
            report.skills[0]
                .source
                .as_ref()
                .expect("source summary should exist")
                .has_credential_ref
        );
        assert!(!json.contains("secret-token"));
    }

    #[test]
    fn get_skill_diff_for_state_returns_file_statuses_and_patch_text() {
        let workspace = temp_dir("get-diff");
        let skill_root = workspace.join("skills");
        fs::create_dir_all(&skill_root).expect("skill root should be created");
        write_skill(&skill_root, "differ", "differ", "Shows diff");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let scanned = scan_skills_for_state(
            &state,
            DesktopScanRequest {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("scan should succeed");
        let skill_id = scanned.skills[0].id.clone();
        let source = bind_skill_source_for_state(
            &state,
            DesktopBindSourceRequest {
                skill_id: skill_id.clone(),
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/differ".to_string(),
                ref_: "main".to_string(),
                credential_ref: None,
                trusted: true,
                auto_update: false,
            },
        )
        .expect("source should bind");
        let store = state.open_store().expect("store should open");
        store
            .update_source_check_result(
                &source.id,
                Some("aaa111"),
                Some("bbb222"),
                "2026-06-19T00:00:00Z",
            )
            .expect("source commits should update");
        let mut details = HashMap::new();
        details.insert(
            source.id.clone(),
            DiffDetail {
                skill_id: skill_id.clone(),
                current_commit: "aaa111".to_string(),
                target_commit: "bbb222".to_string(),
                files: vec![
                    FileDiff {
                        path: "SKILL.md".to_string(),
                        old_path: None,
                        status: DiffStatus::Modified,
                        patch: Some("@@ -1 +1 @@\n-old\n+new".to_string()),
                    },
                    FileDiff {
                        path: "renamed.md".to_string(),
                        old_path: Some("old.md".to_string()),
                        status: DiffStatus::Renamed,
                        patch: None,
                    },
                ],
            },
        );
        let checker = FakeUpdateChecker {
            commits: HashMap::new(),
            behind: 0,
            summary: DiffSummary {
                files_added: 0,
                files_modified: 0,
                files_deleted: 0,
                total_changes: 0,
            },
            details,
            checkout: None,
        };

        let diff = get_skill_diff_for_state_with_checker(&state, skill_id, &checker)
            .expect("diff should load");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(diff.current_commit, "aaa111");
        assert_eq!(diff.target_commit, "bbb222");
        assert_eq!(diff.files.len(), 2);
        assert_eq!(diff.files[0].path, "SKILL.md");
        assert_eq!(diff.files[0].status, "Modified");
        assert_eq!(
            diff.files[0].patch.as_deref(),
            Some("@@ -1 +1 @@\n-old\n+new")
        );
        assert_eq!(diff.files[1].old_path.as_deref(), Some("old.md"));
        assert_eq!(diff.files[1].status, "Renamed");
    }

    #[test]
    fn apply_skill_update_for_state_returns_result_and_creates_pre_update_backup() {
        let workspace = temp_dir("apply-update");
        let skill_root = workspace.join("skills");
        let checkout_skill_dir = workspace.join("checkout/repo/skills/updater");
        fs::create_dir_all(&skill_root).expect("skill root should be created");
        let skill_dir = write_skill(&skill_root, "updater", "updater", "Old update skill");
        fs::create_dir_all(&checkout_skill_dir).expect("checkout skill dir should be created");
        fs::write(
            checkout_skill_dir.join("SKILL.md"),
            "---\nname: updater\ndescription: New update skill\n---\n",
        )
        .expect("checkout skill should be written");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let scanned = scan_skills_for_state(
            &state,
            DesktopScanRequest {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("scan should succeed");
        let skill_id = scanned.skills[0].id.clone();
        let source = bind_skill_source_for_state(
            &state,
            DesktopBindSourceRequest {
                skill_id: skill_id.clone(),
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/updater".to_string(),
                ref_: "main".to_string(),
                credential_ref: None,
                trusted: true,
                auto_update: false,
            },
        )
        .expect("source should bind");
        {
            let mut store = state.open_store().expect("store should open");
            store
                .update_source_check_result(
                    &source.id,
                    Some("aaa111"),
                    Some("bbb222"),
                    "2026-06-19T00:00:00Z",
                )
                .expect("source commits should update");
            capture_local_baseline(&skill_id, &mut store).expect("baseline should capture");
        }
        let checker = FakeUpdateChecker {
            commits: HashMap::new(),
            behind: 0,
            summary: DiffSummary {
                files_added: 0,
                files_modified: 0,
                files_deleted: 0,
                total_changes: 0,
            },
            details: HashMap::new(),
            checkout: Some(CheckoutResult {
                checkout_dir: workspace
                    .join("checkout/repo")
                    .to_string_lossy()
                    .to_string(),
                skill_dir: checkout_skill_dir.to_string_lossy().to_string(),
            }),
        };

        let result = apply_skill_update_for_state_with_checker(&state, skill_id.clone(), &checker)
            .expect("update should apply");
        let backups = list_skill_backups_for_state(&state, skill_id.clone())
            .expect("backups should list after update");
        let indexed = list_indexed_skills_for_state(&state).expect("indexed skills should load");

        assert_eq!(result.skill_id, skill_id);
        assert_eq!(result.previous_commit, "aaa111");
        assert_eq!(result.new_commit, "bbb222");
        assert!(result.backup_id.starts_with("backup_"));
        assert!(result.security_findings.is_empty());
        assert!(result.warnings.is_empty());
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].backup_id, result.backup_id);
        assert_eq!(backups[0].reason, "pre-update");
        assert_eq!(backups[0].source_commit.as_deref(), Some("aaa111"));
        assert_eq!(
            indexed[0]
                .source
                .as_ref()
                .and_then(|source| source.current_commit.as_deref()),
            Some("bbb222")
        );
        assert_eq!(
            fs::read_to_string(skill_dir.join("SKILL.md")).expect("updated skill should read"),
            "---\nname: updater\ndescription: New update skill\n---\n"
        );

        fs::remove_dir_all(&workspace).expect("workspace should be removed");
    }

    #[test]
    fn list_and_restore_skill_backups_for_state_returns_restore_dto() {
        let workspace = temp_dir("restore-update");
        let skill_root = workspace.join("skills");
        fs::create_dir_all(&skill_root).expect("skill root should be created");
        let skill_dir = write_skill(&skill_root, "rollback", "rollback", "Original skill");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let scanned = scan_skills_for_state(
            &state,
            DesktopScanRequest {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("scan should succeed");
        let skill_id = scanned.skills[0].id.clone();
        let backup_id = {
            let mut store = state.open_store().expect("store should open");
            create_backup(
                CreateBackupOptions {
                    skill_id: skill_id.clone(),
                    backup_root: state.backup_root().to_string_lossy().to_string(),
                    reason: "manual".to_string(),
                },
                &mut store,
            )
            .expect("backup should create")
            .backup_id
        };
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: rollback\ndescription: Changed skill\n---\n",
        )
        .expect("skill should change");

        let backups =
            list_skill_backups_for_state(&state, skill_id.clone()).expect("backups should list");
        let restore = restore_skill_backup_for_state(
            &state,
            DesktopRestoreBackupRequest {
                skill_id: skill_id.clone(),
                backup_id: backup_id.clone(),
            },
        )
        .expect("backup should restore");
        let backups_after_restore = list_skill_backups_for_state(&state, skill_id.clone())
            .expect("backups should list after restore");

        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].backup_id, backup_id);
        assert_eq!(backups[0].reason, "manual");
        assert_eq!(restore.skill_id, skill_id);
        assert_eq!(restore.restored_from_backup_id, backup_id);
        assert_ne!(
            restore.previous_state_backup_id,
            restore.restored_from_backup_id
        );
        assert!(backups_after_restore
            .iter()
            .any(|backup| backup.reason == "pre-rollback"));
        assert_eq!(
            fs::read_to_string(skill_dir.join("SKILL.md")).expect("restored skill should read"),
            "---\nname: rollback\ndescription: Original skill\n---\n"
        );

        fs::remove_dir_all(&workspace).expect("workspace should be removed");
    }
}
