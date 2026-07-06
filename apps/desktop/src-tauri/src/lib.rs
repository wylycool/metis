//! Metis Desktop App — Tauri 后端
//!
//! Tauri command 是 UI 到 Core Engine 的薄封装层。
//! 核心逻辑全部在 metis-core 中实现。

use metis_core::audit::{query_audit_log as core_query_audit_log, AuditQuery};
use metis_core::config::{
    evaluate_source_policy, parse_team_policy_from_str, TeamPolicy as CoreTeamPolicy,
};
use metis_core::discovery::{
    list_agents as core_list_agents, scan_and_index_skills,
    AgentPathOverride as CoreAgentPathOverride, AgentStatus,
    CustomMonitoredPath as CoreCustomMonitoredPath, ListAgentsOptions, ScanOptions, ScanResult,
};
use metis_core::install::{
    install_remote_skill_to_targets as core_install_remote_skill_to_targets,
    InstallRemoteSkillOptions, InstallRemoteSkillResult as CoreInstallRemoteSkillResult,
    InstallSkillTarget, InstallTargetResult as CoreInstallTargetResult,
    InstallTargetStatus as CoreInstallTargetStatus,
};
use metis_core::lockfile::{
    check_team_manifest_compliance_from_str as core_check_team_manifest_compliance_from_str,
    TeamManifestComplianceItem as CoreTeamManifestComplianceItem,
    TeamManifestComplianceReport as CoreTeamManifestComplianceReport,
    TeamManifestComplianceSummary as CoreTeamManifestComplianceSummary,
};
use metis_core::preview::{
    preview_remote_skill_source as core_preview_remote_skill_source,
    PreviewRemoteSkillSourceOptions, RemoteSkillPreview as CoreRemoteSkillPreview,
};
use metis_core::rollback::{
    list_backups as core_list_backups, restore_backup as core_restore_backup,
    BackupSummary as CoreBackupSummary, RestoreBackupOptions, RestoreResult as CoreRestoreResult,
};
use metis_core::source::{
    bind_source as core_bind_source, unbind_source as core_unbind_source, Source, SourceInput,
    SourceType,
};
use metis_core::sync::{
    classify_target_path, get_skill_targets_for_source as core_get_skill_targets_for_source,
    IndexedTargetState, SkillTarget as CoreSkillTarget, SkillTargetSource,
    SkillTargetStatus as CoreSkillTargetStatus, TargetPathEvaluation,
};
use metis_core::update::{
    apply_update as core_apply_update, check_updates as core_check_updates,
    get_diff as core_get_diff, ApplyUpdateOptions, ApplyUpdateResult as CoreApplyUpdateResult,
    DiffDetail as CoreDiffDetail, DiffStatus as CoreDiffStatus, DiffSummary, RemoteCommitChecker,
    UpdateCheckOptions, UpdateCheckResult, UpdateStatus,
};
use metis_git_provider::fetch::{EnvironmentGitRunner, GitCliProvider};
use metis_security::findings::{SecurityFinding, SecuritySeverity};
use metis_storage::db::{SkillIndexStore, SkillRecord, SourceRecord};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
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
    pub file_count: Option<u64>,
    pub total_size_bytes: Option<u64>,
    pub source_id: Option<String>,
    pub source: Option<DesktopSource>,
    pub local_modified: Option<bool>,
    pub last_scanned_at: String,
    pub local_updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopSkillSize {
    pub skill_id: String,
    pub file_count: u64,
    pub total_size_bytes: u64,
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
    #[serde(default)]
    pub custom_scan_paths: Vec<String>,
    #[serde(default)]
    pub agent_path_overrides: Vec<DesktopAgentPathOverride>,
    #[serde(default)]
    pub custom_monitored_paths: Vec<DesktopCustomMonitoredPath>,
    #[serde(default)]
    pub team_policy_path: Option<String>,
    #[serde(default)]
    pub enterprise_network: DesktopEnterpriseNetworkSettings,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopAgentPathOverride {
    pub agent_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopCustomMonitoredPath {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopEnterpriseNetworkSettings {
    #[serde(default)]
    pub proxy_url: Option<String>,
    #[serde(default)]
    pub no_proxy: Option<String>,
    #[serde(default)]
    pub certificate_authority_bundle_path: Option<String>,
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
pub struct DesktopPreviewRemoteSkillSourceRequest {
    pub url: String,
    pub repo_path: String,
    pub ref_: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopRemoteSkillPreview {
    pub name: String,
    pub description: Option<String>,
    pub install_name: String,
    pub commit: String,
    pub repo_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopSourceConnectionTestResult {
    pub ok: bool,
    pub message: String,
    pub skill_name: String,
    pub description: Option<String>,
    pub commit: String,
    pub repo_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopGitEnvironmentTestResult {
    pub ok: bool,
    pub message: String,
    pub version: String,
    pub clone_ok: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopSkillTargetsRequest {
    pub url: String,
    pub repo_path: String,
    pub ref_: String,
    pub commit: String,
    pub install_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopSkillTarget {
    pub agent_id: String,
    pub agent_name: String,
    pub root_path: String,
    pub install_path: String,
    pub status: String,
    pub local_modified: bool,
    pub skill_id: Option<String>,
    pub source_id: Option<String>,
    pub root_available: bool,
    pub root_status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopInstallRemoteSkillRequest {
    pub url: String,
    pub repo_path: String,
    pub ref_: String,
    pub commit: String,
    pub install_name: String,
    pub targets: Vec<DesktopInstallSkillTarget>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopInstallSkillTarget {
    pub agent_id: String,
    pub agent_name: String,
    pub install_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopInstallRemoteSkillResult {
    pub targets: Vec<DesktopInstallTargetResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopInstallTargetResult {
    pub agent_id: String,
    pub install_path: String,
    pub status: String,
    pub reason: Option<String>,
    pub skill_id: Option<String>,
    pub backup_id: Option<String>,
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
pub struct DesktopTeamManifestComplianceRequest {
    pub manifest_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopTeamManifestComplianceReport {
    pub generated_at: String,
    pub manifest_version: String,
    pub summary: DesktopTeamManifestComplianceSummary,
    pub items: Vec<DesktopTeamManifestComplianceItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopTeamManifestComplianceSummary {
    pub total: usize,
    pub installed: usize,
    pub missing: usize,
    pub version_mismatch: usize,
    pub local_modified: usize,
    pub source_mismatch: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopTeamManifestComplianceItem {
    pub name: String,
    pub agent_id: String,
    pub status: String,
    pub expected_source_url: Option<String>,
    pub expected_source_repo_path: Option<String>,
    pub expected_source_ref: Option<String>,
    pub expected_commit: Option<String>,
    pub local_skill_id: Option<String>,
    pub local_install_path: Option<String>,
    pub local_source_url: Option<String>,
    pub local_source_repo_path: Option<String>,
    pub local_source_ref: Option<String>,
    pub local_commit: Option<String>,
    pub local_modified: Option<bool>,
    pub trusted_source: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopTeamPolicySummary {
    pub version: String,
    pub trusted_sources: usize,
    pub allow_auto_update: bool,
    pub require_trusted_source: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopTeamPolicyAuditReport {
    pub generated_at: String,
    pub total_bound_sources: usize,
    pub compliant: usize,
    pub should_mark_trusted: usize,
    pub auto_update_disallowed: usize,
    pub items: Vec<DesktopTeamPolicyAuditItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopTeamPolicyAuditItem {
    pub skill_id: String,
    pub skill_name: String,
    pub source_id: String,
    pub source_url: String,
    pub source_repo_path: String,
    pub source_ref: String,
    pub current_trusted: bool,
    pub current_auto_update: bool,
    pub policy_trusted: bool,
    pub auto_update_allowed: bool,
    pub status: String,
    pub recommendation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopFileExportResult {
    pub output_path: String,
    pub bytes_written: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopTeamComplianceReportExportRequest {
    pub output_path: String,
    pub report: DesktopTeamManifestComplianceReport,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopAuditLogExportRequest {
    pub output_path: String,
    pub limit: u32,
    pub offset: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopAuditLogReport {
    pub generated_at: String,
    pub total: usize,
    pub events: Vec<DesktopAuditEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopAuditEvent {
    pub id: String,
    pub skill_id: String,
    pub action: String,
    pub detail: Option<String>,
    pub commit_before: Option<String>,
    pub commit_after: Option<String>,
    pub status: String,
    pub risk_summary: Option<String>,
    pub created_at: Option<String>,
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
        custom_paths: settings.custom_scan_paths.clone(),
        agent_path_overrides: core_agent_path_overrides(&settings),
        custom_monitored_paths: core_custom_monitored_paths(&settings),
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
    request
        .custom_paths
        .extend(settings.custom_scan_paths.clone());
    request.custom_paths = normalize_paths(request.custom_paths);
    let result = scan_and_index_skills(
        ScanOptions {
            agent_ids: request.agent_ids,
            custom_paths: request.custom_paths,
            agent_path_overrides: core_agent_path_overrides(&settings),
            custom_monitored_paths: core_custom_monitored_paths(&settings),
        },
        &store,
    )
    .map_err(|error| error.to_string())?;

    desktop_scan_response(result, &store, &settings)
}

pub fn list_indexed_skills_for_state(state: &DesktopAppState) -> Result<Vec<DesktopSkill>, String> {
    let store = state.open_store()?;
    let settings = get_desktop_settings_for_state(state)?;
    list_indexed_skills_from_store(&store, &settings)
}

pub fn get_skill_size_for_state(
    state: &DesktopAppState,
    skill_id: &str,
) -> Result<DesktopSkillSize, String> {
    let store = state.open_store()?;
    let skill = store
        .get_skill(skill_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("skill not found: {skill_id}"))?;
    let size = skill_directory_size(Path::new(&skill.install_path));

    Ok(DesktopSkillSize {
        skill_id: skill.id,
        file_count: size.file_count,
        total_size_bytes: size.total_size_bytes,
    })
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
        agent_path_overrides: normalize_agent_path_overrides(settings.agent_path_overrides),
        custom_monitored_paths: normalize_custom_monitored_paths(settings.custom_monitored_paths),
        team_policy_path: normalize_optional_text(settings.team_policy_path),
        enterprise_network: normalize_enterprise_network_settings(settings.enterprise_network),
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
    let request = apply_team_policy_to_bind_request(state, request)?;
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

pub fn get_team_policy_summary_for_state(
    state: &DesktopAppState,
) -> Result<Option<DesktopTeamPolicySummary>, String> {
    Ok(load_team_policy_for_state(state)?.map(desktop_team_policy_summary))
}

pub fn get_team_policy_audit_report_for_state(
    state: &DesktopAppState,
) -> Result<DesktopTeamPolicyAuditReport, String> {
    let policy = load_team_policy_for_state(state)?;
    let store = state.open_store()?;
    let skills = store.list_skills().map_err(|error| error.to_string())?;
    let mut items = Vec::new();

    for skill in skills {
        let Some(source_id) = skill.source_id.as_deref() else {
            continue;
        };
        let Some(source) = store
            .get_source(source_id)
            .map_err(|error| error.to_string())?
        else {
            continue;
        };
        let evaluation = policy
            .as_ref()
            .map(|policy| {
                evaluate_source_policy(policy, &source.url, &source.repo_path, &source.ref_)
            })
            .unwrap_or(metis_core::config::SourcePolicyEvaluation {
                trusted: false,
                auto_update_allowed: false,
                matched_source_url: None,
            });
        items.push(desktop_team_policy_audit_item(skill, source, evaluation));
    }

    let compliant = items
        .iter()
        .filter(|item| item.status == "compliant")
        .count();
    let should_mark_trusted = items
        .iter()
        .filter(|item| item.status == "should_mark_trusted")
        .count();
    let auto_update_disallowed = items
        .iter()
        .filter(|item| item.status == "auto_update_disallowed")
        .count();

    Ok(DesktopTeamPolicyAuditReport {
        generated_at: current_timestamp_string(),
        total_bound_sources: items.len(),
        compliant,
        should_mark_trusted,
        auto_update_disallowed,
        items,
    })
}

fn apply_team_policy_to_bind_request(
    state: &DesktopAppState,
    mut request: DesktopBindSourceRequest,
) -> Result<DesktopBindSourceRequest, String> {
    if let Some(policy) = load_team_policy_for_state(state)? {
        let evaluation =
            evaluate_source_policy(&policy, &request.url, &request.repo_path, &request.ref_);
        if evaluation.trusted {
            request.trusted = true;
        }
        if request.auto_update && !evaluation.auto_update_allowed {
            request.auto_update = false;
        }
    }
    Ok(request)
}

fn load_team_policy_for_state(state: &DesktopAppState) -> Result<Option<CoreTeamPolicy>, String> {
    let settings = get_desktop_settings_for_state(state)?;
    let Some(path) = settings.team_policy_path else {
        return Ok(None);
    };
    let contents = fs::read_to_string(path)
        .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())?;
    parse_team_policy_from_str(&contents)
        .map(Some)
        .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())
}

pub fn unbind_skill_source_for_state(
    state: &DesktopAppState,
    skill_id: String,
) -> Result<(), String> {
    let store = state.open_store()?;
    core_unbind_source(&skill_id, &store).map_err(|error| error.to_string())
}

pub fn preview_remote_skill_source_for_state_with_checker<C: RemoteCommitChecker>(
    state: &DesktopAppState,
    request: DesktopPreviewRemoteSkillSourceRequest,
    checker: &C,
) -> Result<DesktopRemoteSkillPreview, String> {
    state.ensure_dirs()?;
    core_preview_remote_skill_source(
        PreviewRemoteSkillSourceOptions {
            url: request.url,
            repo_path: request.repo_path,
            ref_: request.ref_,
            cache_dir: state.cache_root().to_string_lossy().to_string(),
        },
        checker,
    )
    .map(desktop_remote_skill_preview)
    .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())
}

pub fn test_source_connection_for_state_with_checker<C: RemoteCommitChecker>(
    state: &DesktopAppState,
    request: DesktopPreviewRemoteSkillSourceRequest,
    checker: &C,
) -> Result<DesktopSourceConnectionTestResult, String> {
    state.ensure_dirs()?;
    core_preview_remote_skill_source(
        PreviewRemoteSkillSourceOptions {
            url: request.url,
            repo_path: request.repo_path,
            ref_: request.ref_,
            cache_dir: state.cache_root().to_string_lossy().to_string(),
        },
        checker,
    )
    .map(desktop_source_connection_test_result)
    .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitEnvironmentProbeReport {
    pub version: String,
    pub clone_ok: bool,
}

pub trait GitVersionProbe {
    fn git_environment(&self) -> Result<GitEnvironmentProbeReport, String>;
}

struct SystemGitVersionProbe;

impl GitVersionProbe for SystemGitVersionProbe {
    fn git_environment(&self) -> Result<GitEnvironmentProbeReport, String> {
        let output = Command::new("git")
            .arg("--version")
            .output()
            .map_err(|error| format!("git unavailable: {error}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let detail = if stderr.is_empty() {
                format!(
                    "git unavailable: git --version exited with {}",
                    output.status
                )
            } else {
                format!("git unavailable: {stderr}")
            };
            return Err(detail);
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.is_empty() {
            return Err("git unavailable: git --version returned empty output".to_string());
        }

        run_local_git_clone_self_check()?;

        Ok(GitEnvironmentProbeReport {
            version: stdout,
            clone_ok: true,
        })
    }
}

pub fn test_git_environment_with_probe<P: GitVersionProbe>(
    probe: &P,
) -> Result<DesktopGitEnvironmentTestResult, String> {
    let report = probe
        .git_environment()
        .map_err(|error| friendly_desktop_error(&error).wire_string())?;

    Ok(DesktopGitEnvironmentTestResult {
        ok: true,
        message: "Git 可用".to_string(),
        version: report.version,
        clone_ok: report.clone_ok,
    })
}

fn run_local_git_clone_self_check() -> Result<(), String> {
    let check_root = std::env::temp_dir().join(format!(
        "metis-git-check-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
    ));
    let origin_path = check_root.join("origin.git");
    let clone_path = check_root.join("clone");

    let result = (|| {
        fs::create_dir_all(&check_root)
            .map_err(|error| format!("git unavailable: cannot create temp check dir: {error}"))?;

        git_command_with_args(["init", "--bare"])
            .arg(&origin_path)
            .output()
            .map_err(|error| format!("git unavailable: git init self-check failed: {error}"))
            .and_then(|output| git_output_result(output, "git init self-check"))?;

        git_command_with_args(["clone"])
            .arg(&origin_path)
            .arg(&clone_path)
            .output()
            .map_err(|error| format!("git unavailable: git clone self-check failed: {error}"))
            .and_then(|output| git_output_result(output, "git clone self-check"))?;

        git_command_with_args(["-C"])
            .arg(&clone_path)
            .args(["fetch", "--dry-run", "origin"])
            .output()
            .map_err(|error| format!("git unavailable: git fetch self-check failed: {error}"))
            .and_then(|output| git_output_result(output, "git fetch self-check"))?;

        Ok(())
    })();

    let _ = fs::remove_dir_all(&check_root);
    result
}

fn git_command_with_args<const N: usize>(args: [&str; N]) -> Command {
    let mut command = Command::new("git");
    command.args(args);
    command
}

fn git_output_result(output: std::process::Output, label: &str) -> Result<(), String> {
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = if stderr.is_empty() {
        format!("{label} exited with {}", output.status)
    } else {
        format!("{label}: {stderr}")
    };
    Err(format!("git unavailable: {detail}"))
}

pub fn get_skill_targets_for_source_for_state(
    state: &DesktopAppState,
    request: DesktopSkillTargetsRequest,
) -> Result<Vec<DesktopSkillTarget>, String> {
    let mut store = state.open_store()?;
    let settings = get_desktop_settings_for_state(state)?;
    let source = SkillTargetSource {
        url: request.url,
        repo_path: request.repo_path,
        ref_: request.ref_,
        commit: request.commit,
        install_name: request.install_name,
    };
    let mut targets: Vec<DesktopSkillTarget> =
        core_get_skill_targets_for_source(source.clone(), &mut store)
            .map(|targets| targets.into_iter().map(desktop_skill_target).collect())
            .map_err(|error| friendly_desktop_error(&error).wire_string())?;
    let sources = store.list_sources().map_err(|error| error.to_string())?;

    for custom_path in &settings.custom_monitored_paths {
        targets.push(custom_skill_target(
            custom_path,
            &source,
            &mut store,
            &sources,
        )?);
    }

    Ok(targets)
}

pub fn install_remote_skill_to_targets_for_state_with_checker<C: RemoteCommitChecker>(
    state: &DesktopAppState,
    request: DesktopInstallRemoteSkillRequest,
    checker: &C,
) -> Result<DesktopInstallRemoteSkillResult, String> {
    let mut store = state.open_store()?;
    core_install_remote_skill_to_targets(
        InstallRemoteSkillOptions {
            source: SkillTargetSource {
                url: request.url,
                repo_path: request.repo_path,
                ref_: request.ref_,
                commit: request.commit,
                install_name: request.install_name,
            },
            targets: request
                .targets
                .into_iter()
                .map(|target| InstallSkillTarget {
                    agent_id: target.agent_id,
                    agent_name: target.agent_name,
                    install_path: target.install_path,
                })
                .collect(),
            backup_root: state.backup_root().to_string_lossy().to_string(),
            cache_dir: state.cache_root().to_string_lossy().to_string(),
        },
        &mut store,
        checker,
    )
    .map(desktop_install_remote_skill_result)
    .map_err(|error| friendly_desktop_error(&error).wire_string())
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

pub fn list_skill_audit_events_for_state(
    state: &DesktopAppState,
    skill_id: String,
    limit: u32,
) -> Result<Vec<DesktopAuditEvent>, String> {
    let store = state.open_store()?;
    core_query_audit_log(
        AuditQuery {
            skill_id: Some(skill_id),
            action: None,
            limit,
            offset: 0,
        },
        &store,
    )
    .map(|events| events.into_iter().map(desktop_audit_event).collect())
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
    let settings = get_desktop_settings_for_state(state)?;
    let agents = list_agents_for_state(state)?;
    let skills = list_indexed_skills_from_store(&store, &settings)?;
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

pub fn check_team_manifest_compliance_for_state(
    state: &DesktopAppState,
    request: DesktopTeamManifestComplianceRequest,
) -> Result<DesktopTeamManifestComplianceReport, String> {
    let store = state.open_store()?;
    core_check_team_manifest_compliance_from_str(&request.manifest_json, &store)
        .map(desktop_team_manifest_compliance_report)
        .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())
}

pub fn load_team_manifest_from_file_for_state(
    state: &DesktopAppState,
    path: String,
) -> Result<String, String> {
    state.ensure_dirs()?;
    fs::read_to_string(path)
        .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())
}

pub fn export_team_compliance_report_to_file_for_state(
    state: &DesktopAppState,
    request: DesktopTeamComplianceReportExportRequest,
) -> Result<DesktopFileExportResult, String> {
    state.ensure_dirs()?;
    write_json_file(&request.output_path, &request.report)
}

pub fn export_environment_report_to_file_for_state(
    state: &DesktopAppState,
    output_path: String,
) -> Result<DesktopFileExportResult, String> {
    let report = export_environment_report_for_state(state)?;
    write_json_file(&output_path, &report)
}

pub fn export_audit_log_report_to_file_for_state(
    state: &DesktopAppState,
    request: DesktopAuditLogExportRequest,
) -> Result<DesktopFileExportResult, String> {
    let store = state.open_store()?;
    let events = core_query_audit_log(
        AuditQuery {
            skill_id: None,
            action: None,
            limit: request.limit,
            offset: request.offset,
        },
        &store,
    )
    .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())?;
    let report = DesktopAuditLogReport {
        generated_at: current_timestamp_string(),
        total: events.len(),
        events: events.into_iter().map(desktop_audit_event).collect(),
    };

    write_json_file(&request.output_path, &report)
}

fn write_json_file<T: Serialize>(
    output_path: &str,
    value: &T,
) -> Result<DesktopFileExportResult, String> {
    let path = PathBuf::from(output_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())?;
        }
    }
    let contents = serde_json::to_string_pretty(value)
        .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())?;
    fs::write(&path, contents.as_bytes())
        .map_err(|error| friendly_desktop_error(&error.to_string()).wire_string())?;
    Ok(DesktopFileExportResult {
        output_path: output_path.to_string(),
        bytes_written: contents.len() as u64,
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
fn get_skill_size(
    state: tauri::State<'_, DesktopAppState>,
    skill_id: String,
) -> Result<DesktopSkillSize, String> {
    get_skill_size_for_state(&state, &skill_id)
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
fn get_team_policy_summary(
    state: tauri::State<'_, DesktopAppState>,
) -> Result<Option<DesktopTeamPolicySummary>, String> {
    get_team_policy_summary_for_state(&state)
}

#[tauri::command]
fn get_team_policy_audit_report(
    state: tauri::State<'_, DesktopAppState>,
) -> Result<DesktopTeamPolicyAuditReport, String> {
    get_team_policy_audit_report_for_state(&state)
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
async fn preview_remote_skill_source(
    state: tauri::State<'_, DesktopAppState>,
    request: DesktopPreviewRemoteSkillSourceRequest,
) -> Result<DesktopRemoteSkillPreview, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let checker = system_git_checker_for_state(&state)?;
        preview_remote_skill_source_for_state_with_checker(&state, request, &checker)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn test_source_connection(
    state: tauri::State<'_, DesktopAppState>,
    request: DesktopPreviewRemoteSkillSourceRequest,
) -> Result<DesktopSourceConnectionTestResult, String> {
    let checker = system_git_checker_for_state(&state)?;
    test_source_connection_for_state_with_checker(&state, request, &checker)
}

#[tauri::command]
async fn test_git_environment() -> Result<DesktopGitEnvironmentTestResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let probe = SystemGitVersionProbe;
        test_git_environment_with_probe(&probe)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn get_skill_targets_for_source(
    state: tauri::State<'_, DesktopAppState>,
    request: DesktopSkillTargetsRequest,
) -> Result<Vec<DesktopSkillTarget>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        get_skill_targets_for_source_for_state(&state, request)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn install_remote_skill_to_targets(
    state: tauri::State<'_, DesktopAppState>,
    request: DesktopInstallRemoteSkillRequest,
) -> Result<DesktopInstallRemoteSkillResult, String> {
    let checker = system_git_checker_for_state(&state)?;
    install_remote_skill_to_targets_for_state_with_checker(&state, request, &checker)
}

#[tauri::command]
async fn check_skill_updates(
    state: tauri::State<'_, DesktopAppState>,
    request: DesktopUpdateCheckRequest,
) -> Result<Vec<DesktopUpdateCheckResult>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let checker = system_git_checker_for_state(&state)?;
        check_skill_updates_for_state_with_checker(&state, request, &checker)
    })
    .await
    .map_err(|error| format!("检查更新后台任务失败: {error}"))?
}

#[tauri::command]
fn get_skill_diff(
    state: tauri::State<'_, DesktopAppState>,
    skill_id: String,
) -> Result<DesktopDiffDetail, String> {
    let checker = system_git_checker_for_state(&state)?;
    get_skill_diff_for_state_with_checker(&state, skill_id, &checker)
}

#[tauri::command]
fn apply_skill_update(
    state: tauri::State<'_, DesktopAppState>,
    skill_id: String,
) -> Result<DesktopApplyUpdateResult, String> {
    let checker = system_git_checker_for_state(&state)?;
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
fn list_skill_audit_events(
    state: tauri::State<'_, DesktopAppState>,
    skill_id: String,
    limit: u32,
) -> Result<Vec<DesktopAuditEvent>, String> {
    list_skill_audit_events_for_state(&state, skill_id, limit)
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

#[tauri::command]
fn check_team_manifest_compliance(
    state: tauri::State<'_, DesktopAppState>,
    request: DesktopTeamManifestComplianceRequest,
) -> Result<DesktopTeamManifestComplianceReport, String> {
    check_team_manifest_compliance_for_state(&state, request)
}

#[tauri::command]
fn load_team_manifest_from_file(
    state: tauri::State<'_, DesktopAppState>,
    path: String,
) -> Result<String, String> {
    load_team_manifest_from_file_for_state(&state, path)
}

#[tauri::command]
fn export_team_compliance_report_to_file(
    state: tauri::State<'_, DesktopAppState>,
    request: DesktopTeamComplianceReportExportRequest,
) -> Result<DesktopFileExportResult, String> {
    export_team_compliance_report_to_file_for_state(&state, request)
}

#[tauri::command]
fn export_environment_report_to_file(
    state: tauri::State<'_, DesktopAppState>,
    output_path: String,
) -> Result<DesktopFileExportResult, String> {
    export_environment_report_to_file_for_state(&state, output_path)
}

#[tauri::command]
fn export_audit_log_report_to_file(
    state: tauri::State<'_, DesktopAppState>,
    request: DesktopAuditLogExportRequest,
) -> Result<DesktopFileExportResult, String> {
    export_audit_log_report_to_file_for_state(&state, request)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    validate_external_url(&url)?;
    open_url_with_system_handler(&url)
}

fn validate_external_url(url: &str) -> Result<(), String> {
    let normalized = url.trim().trim_end_matches('/');
    if normalized == "https://github.com/wylycool/metis" {
        return Ok(());
    }

    Err("不允许打开未受信任的外部链接。".to_string())
}

fn open_url_with_system_handler(url: &str) -> Result<(), String> {
    let status = if cfg!(target_os = "macos") {
        Command::new("open").arg(url).status()
    } else if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", url]).status()
    } else {
        Command::new("xdg-open").arg(url).status()
    }
    .map_err(|error| format!("打开外部链接失败：{error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("打开外部链接失败，系统命令退出状态：{status}"))
    }
}

fn desktop_scan_response(
    result: ScanResult,
    store: &SkillIndexStore,
    settings: &DesktopSettings,
) -> Result<DesktopScanResponse, String> {
    Ok(DesktopScanResponse {
        skills: list_indexed_skills_from_store(store, settings)?,
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

fn system_git_checker_for_state(
    state: &DesktopAppState,
) -> Result<GitCliProvider<EnvironmentGitRunner>, String> {
    let settings = get_desktop_settings_for_state(state)?;
    Ok(GitCliProvider::with_cache_root(
        EnvironmentGitRunner::new(git_environment_for_settings(&settings)),
        state.cache_root().to_string_lossy().to_string(),
    ))
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

fn normalize_agent_path_overrides(
    overrides: Vec<DesktopAgentPathOverride>,
) -> Vec<DesktopAgentPathOverride> {
    let mut normalized = Vec::new();
    for override_path in overrides {
        let agent_id = override_path.agent_id.trim();
        let path = override_path.path.trim();
        if agent_id.is_empty()
            || path.is_empty()
            || normalized
                .iter()
                .any(|item: &DesktopAgentPathOverride| item.agent_id == agent_id)
        {
            continue;
        }
        normalized.push(DesktopAgentPathOverride {
            agent_id: agent_id.to_string(),
            path: path.to_string(),
        });
    }
    normalized
}

fn normalize_custom_monitored_paths(
    paths: Vec<DesktopCustomMonitoredPath>,
) -> Vec<DesktopCustomMonitoredPath> {
    let mut normalized = Vec::new();
    for (index, path) in paths.into_iter().enumerate() {
        let name = path.name.trim();
        let monitor_path = path.path.trim();
        if name.is_empty()
            || monitor_path.is_empty()
            || normalized
                .iter()
                .any(|item: &DesktopCustomMonitoredPath| item.path == monitor_path)
        {
            continue;
        }
        let id = normalize_optional_text(Some(path.id))
            .unwrap_or_else(|| format!("monitor-{}", index + 1));
        normalized.push(DesktopCustomMonitoredPath {
            id,
            name: name.to_string(),
            path: monitor_path.to_string(),
        });
    }
    normalized
}

fn core_agent_path_overrides(settings: &DesktopSettings) -> Vec<CoreAgentPathOverride> {
    settings
        .agent_path_overrides
        .iter()
        .map(|override_path| CoreAgentPathOverride {
            agent_id: override_path.agent_id.clone(),
            path: override_path.path.clone(),
        })
        .collect()
}

fn core_custom_monitored_paths(settings: &DesktopSettings) -> Vec<CoreCustomMonitoredPath> {
    settings
        .custom_monitored_paths
        .iter()
        .map(|path| CoreCustomMonitoredPath {
            id: path.id.clone(),
            name: path.name.clone(),
            path: path.path.clone(),
        })
        .collect()
}

fn desktop_agent_name(agent_id: &str, settings: &DesktopSettings) -> String {
    settings
        .custom_monitored_paths
        .iter()
        .find(|path| custom_agent_id(&path.id) == agent_id)
        .map(|path| path.name.clone())
        .unwrap_or_else(|| agent_name(agent_id).to_string())
}

fn custom_agent_id(id: &str) -> String {
    let slug = id
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "custom-monitor".to_string()
    } else {
        format!("custom-{}", slug)
    }
}

fn normalize_enterprise_network_settings(
    settings: DesktopEnterpriseNetworkSettings,
) -> DesktopEnterpriseNetworkSettings {
    DesktopEnterpriseNetworkSettings {
        proxy_url: normalize_optional_text(settings.proxy_url),
        no_proxy: normalize_optional_text(settings.no_proxy),
        certificate_authority_bundle_path: normalize_optional_text(
            settings.certificate_authority_bundle_path,
        ),
    }
}

fn git_environment_for_settings(settings: &DesktopSettings) -> Vec<(String, String)> {
    let mut environment = Vec::new();
    if let Some(proxy_url) = settings.enterprise_network.proxy_url.as_ref() {
        environment.push(("HTTPS_PROXY".to_string(), proxy_url.clone()));
        environment.push(("HTTP_PROXY".to_string(), proxy_url.clone()));
    }
    if let Some(no_proxy) = settings.enterprise_network.no_proxy.as_ref() {
        environment.push(("NO_PROXY".to_string(), no_proxy.clone()));
    }
    if let Some(ca_bundle_path) = settings
        .enterprise_network
        .certificate_authority_bundle_path
        .as_ref()
    {
        environment.push(("GIT_SSL_CAINFO".to_string(), ca_bundle_path.clone()));
    }
    environment
}

fn list_indexed_skills_from_store(
    store: &SkillIndexStore,
    settings: &DesktopSettings,
) -> Result<Vec<DesktopSkill>, String> {
    store
        .list_skills()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|skill| desktop_skill(skill, store, settings))
        .collect()
}

fn desktop_skill(
    record: SkillRecord,
    store: &SkillIndexStore,
    settings: &DesktopSettings,
) -> Result<DesktopSkill, String> {
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
        agent_name: desktop_agent_name(&record.agent_id, settings),
        name: record.name,
        description: record.description,
        install_path: record.install_path,
        metadata_path: record.metadata_path,
        metadata_status: record.metadata_status,
        metadata_error: record.metadata_error,
        file_count: None,
        total_size_bytes: None,
        source_id: record.source_id,
        source,
        local_modified: record.local_modified,
        last_scanned_at: record.last_scanned_at,
        local_updated_at: record.local_updated_at,
    })
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct SkillDirectorySize {
    file_count: u64,
    total_size_bytes: u64,
}

fn skill_directory_size(path: &Path) -> SkillDirectorySize {
    fn visit(path: &Path, size: &mut SkillDirectorySize) {
        let Ok(metadata) = fs::symlink_metadata(path) else {
            return;
        };
        if metadata.is_file() {
            size.file_count += 1;
            size.total_size_bytes += metadata.len();
            return;
        }
        if !metadata.is_dir() {
            return;
        }
        let Ok(entries) = fs::read_dir(path) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy() == ".git" {
                continue;
            }
            visit(&entry.path(), size);
        }
    }

    let mut size = SkillDirectorySize::default();
    visit(path, &mut size);
    size
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

fn desktop_remote_skill_preview(preview: CoreRemoteSkillPreview) -> DesktopRemoteSkillPreview {
    DesktopRemoteSkillPreview {
        name: preview.name,
        description: preview.description,
        install_name: preview.install_name,
        commit: preview.commit,
        repo_path: preview.repo_path,
    }
}

fn desktop_source_connection_test_result(
    preview: CoreRemoteSkillPreview,
) -> DesktopSourceConnectionTestResult {
    DesktopSourceConnectionTestResult {
        ok: true,
        message: "连接成功，可以保存来源。".to_string(),
        skill_name: preview.name,
        description: preview.description,
        commit: preview.commit,
        repo_path: preview.repo_path,
    }
}

fn desktop_skill_target(target: CoreSkillTarget) -> DesktopSkillTarget {
    DesktopSkillTarget {
        agent_id: target.agent_id,
        agent_name: target.agent_name,
        root_path: target.root_path,
        install_path: target.install_path,
        status: desktop_skill_target_status(target.status),
        local_modified: target.local_modified,
        skill_id: target.skill_id,
        source_id: target.source_id,
        root_available: target.root_available,
        root_status: target.root_status,
    }
}

fn custom_skill_target(
    custom_path: &DesktopCustomMonitoredPath,
    source: &SkillTargetSource,
    store: &mut SkillIndexStore,
    sources: &[SourceRecord],
) -> Result<DesktopSkillTarget, String> {
    let agent_id = custom_agent_id(&custom_path.id);
    let root_path = custom_path.path.clone();
    let install_path = Path::new(&root_path)
        .join(&source.install_name)
        .to_string_lossy()
        .to_string();
    let stored_skill = store
        .get_skill_by_agent_and_path(&agent_id, &install_path)
        .map_err(|error| error.to_string())?;
    let stored_source = stored_skill
        .as_ref()
        .and_then(|skill| skill.source_id.as_deref())
        .and_then(|source_id| sources.iter().find(|record| record.id == source_id));
    let source_matches = stored_source
        .map(|record| desktop_source_record_matches(record, source))
        .unwrap_or(false);
    let root_status = desktop_custom_root_status(Path::new(&root_path));
    let root_available = root_status == "available";
    let install_path_ref = Path::new(&install_path);
    let indexed = stored_skill.as_ref().map(|skill| IndexedTargetState {
        source_id: skill.source_id.clone(),
        current_commit: stored_source.and_then(|record| record.current_commit.clone()),
        local_modified: skill.local_modified.unwrap_or(false),
    });
    let classification = classify_target_path(TargetPathEvaluation {
        root_available,
        path_exists: install_path_ref.exists(),
        has_skill_md: install_path_ref.join("SKILL.md").is_file(),
        indexed,
        expected_commit: source.commit.clone(),
        source_matches,
    });

    Ok(DesktopSkillTarget {
        agent_id,
        agent_name: custom_path.name.clone(),
        root_path,
        install_path,
        status: desktop_skill_target_status(classification.status),
        local_modified: classification.local_modified,
        skill_id: stored_skill.as_ref().map(|skill| skill.id.clone()),
        source_id: stored_skill.and_then(|skill| skill.source_id),
        root_available,
        root_status: root_status.to_string(),
    })
}

fn desktop_custom_root_status(path: &Path) -> &'static str {
    if !path.exists() {
        return "missing";
    }
    if fs::read_dir(path).is_err() {
        return "not_readable";
    }
    if path
        .metadata()
        .map(|metadata| metadata.permissions().readonly())
        .unwrap_or(true)
    {
        return "not_writable";
    }
    "available"
}

fn desktop_source_record_matches(record: &SourceRecord, source: &SkillTargetSource) -> bool {
    record.url == source.url && record.repo_path == source.repo_path && record.ref_ == source.ref_
}

fn desktop_skill_target_status(status: CoreSkillTargetStatus) -> String {
    match status {
        CoreSkillTargetStatus::NotInstalled => "NotInstalled",
        CoreSkillTargetStatus::InstalledUnbound => "InstalledUnbound",
        CoreSkillTargetStatus::InstalledBound => "InstalledBound",
        CoreSkillTargetStatus::UpToDate => "UpToDate",
        CoreSkillTargetStatus::UpdateAvailable => "UpdateAvailable",
        CoreSkillTargetStatus::ConflictNonSkill => "ConflictNonSkill",
        CoreSkillTargetStatus::AgentRootUnavailable => "AgentRootUnavailable",
    }
    .to_string()
}

fn desktop_install_remote_skill_result(
    result: CoreInstallRemoteSkillResult,
) -> DesktopInstallRemoteSkillResult {
    DesktopInstallRemoteSkillResult {
        targets: result
            .targets
            .into_iter()
            .map(desktop_install_target_result)
            .collect(),
    }
}

fn desktop_install_target_result(result: CoreInstallTargetResult) -> DesktopInstallTargetResult {
    DesktopInstallTargetResult {
        agent_id: result.agent_id,
        install_path: result.install_path,
        status: desktop_install_target_status(result.status),
        reason: result.reason,
        skill_id: result.skill_id,
        backup_id: result.backup_id,
    }
}

fn desktop_install_target_status(status: CoreInstallTargetStatus) -> String {
    match status {
        CoreInstallTargetStatus::Installed => "Installed",
        CoreInstallTargetStatus::Updated => "Updated",
        CoreInstallTargetStatus::Skipped => "Skipped",
        CoreInstallTargetStatus::Failed => "Failed",
    }
    .to_string()
}

fn desktop_team_manifest_compliance_report(
    report: CoreTeamManifestComplianceReport,
) -> DesktopTeamManifestComplianceReport {
    DesktopTeamManifestComplianceReport {
        generated_at: report.generated_at,
        manifest_version: report.manifest_version,
        summary: desktop_team_manifest_compliance_summary(report.summary),
        items: report
            .items
            .into_iter()
            .map(desktop_team_manifest_compliance_item)
            .collect(),
    }
}

fn desktop_team_manifest_compliance_summary(
    summary: CoreTeamManifestComplianceSummary,
) -> DesktopTeamManifestComplianceSummary {
    DesktopTeamManifestComplianceSummary {
        total: summary.total,
        installed: summary.installed,
        missing: summary.missing,
        version_mismatch: summary.version_mismatch,
        local_modified: summary.local_modified,
        source_mismatch: summary.source_mismatch,
    }
}

fn desktop_team_manifest_compliance_item(
    item: CoreTeamManifestComplianceItem,
) -> DesktopTeamManifestComplianceItem {
    DesktopTeamManifestComplianceItem {
        name: item.name,
        agent_id: item.agent_id,
        status: item.status,
        expected_source_url: item.expected_source_url,
        expected_source_repo_path: item.expected_source_repo_path,
        expected_source_ref: item.expected_source_ref,
        expected_commit: item.expected_commit,
        local_skill_id: item.local_skill_id,
        local_install_path: item.local_install_path,
        local_source_url: item.local_source_url,
        local_source_repo_path: item.local_source_repo_path,
        local_source_ref: item.local_source_ref,
        local_commit: item.local_commit,
        local_modified: item.local_modified,
        trusted_source: item.trusted_source,
    }
}

fn desktop_team_policy_summary(policy: CoreTeamPolicy) -> DesktopTeamPolicySummary {
    DesktopTeamPolicySummary {
        version: policy.version,
        trusted_sources: policy.trusted_sources.len(),
        allow_auto_update: policy.update_policy.allow_auto_update,
        require_trusted_source: policy.update_policy.require_trusted_source,
    }
}

fn desktop_team_policy_audit_item(
    skill: SkillRecord,
    source: SourceRecord,
    evaluation: metis_core::config::SourcePolicyEvaluation,
) -> DesktopTeamPolicyAuditItem {
    let (status, recommendation) = if source.auto_update && !evaluation.auto_update_allowed {
        (
            "auto_update_disallowed",
            "关闭 auto update，或将该 source 加入团队 trusted_sources。",
        )
    } else if evaluation.trusted && !source.trusted {
        (
            "should_mark_trusted",
            "该 source 命中团队 trusted source，建议标记为 trusted。",
        )
    } else {
        ("compliant", "当前 source 与团队策略一致。")
    };

    DesktopTeamPolicyAuditItem {
        skill_id: skill.id,
        skill_name: skill.name,
        source_id: source.id,
        source_url: source.url,
        source_repo_path: source.repo_path,
        source_ref: source.ref_,
        current_trusted: source.trusted,
        current_auto_update: source.auto_update,
        policy_trusted: evaluation.trusted,
        auto_update_allowed: evaluation.auto_update_allowed,
        status: status.to_string(),
        recommendation: recommendation.to_string(),
    }
}

fn desktop_audit_event(event: metis_core::audit::AuditEvent) -> DesktopAuditEvent {
    DesktopAuditEvent {
        id: event.id,
        skill_id: event.skill_id,
        action: format!("{:?}", event.action),
        detail: event.detail,
        commit_before: event.commit_before,
        commit_after: event.commit_after,
        status: event.status,
        risk_summary: event.risk_summary,
        created_at: event.created_at,
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
            "Metis 访问不了这个仓库",
            "请确认你有访问权限，或先在本机 Git 工具中完成登录。",
            message,
        );
    }

    if lower.contains("git unavailable") {
        return desktop_error(
            "git_unavailable",
            "无法使用 Git",
            "这台电脑还不能使用 Git。",
            "请先安装 Git，或确认 Git 可以在终端中正常运行。",
            message,
        );
    }

    if lower.contains("host key verification failed")
        || lower.contains("host key verification")
        || lower.contains("strict host key checking")
    {
        return desktop_error(
            "ssh_host_key",
            "SSH 主机未确认",
            "Metis 不能直接确认这个 Git 主机的 SSH 指纹。",
            "请先在终端用系统 Git 连接一次该主机并确认指纹，或改用 HTTPS 仓库地址。",
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
            "security_notice",
            "更新内容需要留意",
            "更新内容包含脚本或配置字段，Metis 已保留提示信息。",
            "来源可信时通常可以继续使用；如不确定，可先查看 diff 或回滚到更新前备份。",
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

    if lower.contains("not a skill directory") {
        return desktop_error(
            "repo_path",
            "没有找到 SKILL.md",
            "仓库能访问，但这个路径下没有找到 SKILL.md。",
            "请检查“Skill 在仓库内的路径”；如果 SKILL.md 在仓库根目录，路径填 .。",
            message,
        );
    }

    if lower.contains("repo path not found")
        || lower.contains("repo_path")
        || lower.contains("repo path")
    {
        return desktop_error(
            "repo_path",
            "仓库路径不存在",
            "仓库能访问，但这个路径不存在。",
            "请检查“Skill 在仓库内的路径”；如果 SKILL.md 在仓库根目录，路径填 .。",
            message,
        );
    }

    if lower.contains("remote ref not found") {
        return desktop_error(
            "git_ref",
            "分支不存在",
            "Metis 能访问仓库，但找不到这个主分支名。",
            "请检查“主分支名”是否填写正确，一般为 main 或者 master。",
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
        || lower.contains("git operation failed")
        || lower.contains("git command failed")
        || lower.contains("could not fetch")
        || lower.contains("missing current commit")
        || lower.contains("missing remote commit")
        || lower.contains("promisor remote")
        || lower.contains("no source")
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
            get_skill_size,
            get_desktop_settings,
            save_desktop_settings,
            get_team_policy_summary,
            get_team_policy_audit_report,
            bind_skill_source,
            unbind_skill_source,
            preview_remote_skill_source,
            test_source_connection,
            test_git_environment,
            get_skill_targets_for_source,
            install_remote_skill_to_targets,
            check_skill_updates,
            get_skill_diff,
            apply_skill_update,
            list_skill_backups,
            list_skill_audit_events,
            restore_skill_backup,
            export_environment_report,
            check_team_manifest_compliance,
            load_team_manifest_from_file,
            export_team_compliance_report_to_file,
            export_environment_report_to_file,
            export_audit_log_report_to_file,
            open_external_url
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

    #[test]
    fn preview_remote_skill_source_for_state_returns_desktop_dto() {
        let workspace = temp_dir("preview-remote");
        let data_root = workspace.join("data");
        let cache_root = workspace.join("cache");
        let state = DesktopAppState::new(&data_root, &cache_root);
        let skill_dir = write_skill(
            &workspace.join("checkout").join("skills"),
            "example",
            "example",
            "Remote skill preview",
        );
        let checker = FakeUpdateChecker {
            commits: HashMap::from([("remote-preview".to_string(), "abc123".to_string())]),
            behind: 0,
            summary: DiffSummary {
                files_added: 0,
                files_modified: 0,
                files_deleted: 0,
                total_changes: 0,
            },
            details: HashMap::new(),
            checkout: Some(CheckoutResult {
                checkout_dir: workspace.join("checkout").to_string_lossy().to_string(),
                skill_dir: skill_dir.to_string_lossy().to_string(),
            }),
        };

        let preview = preview_remote_skill_source_for_state_with_checker(
            &state,
            DesktopPreviewRemoteSkillSourceRequest {
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/example".to_string(),
                ref_: "main".to_string(),
            },
            &checker,
        )
        .expect("remote preview should succeed");

        assert_eq!(preview.name, "example");
        assert_eq!(preview.description.as_deref(), Some("Remote skill preview"));
        assert_eq!(preview.install_name, "example");
        assert_eq!(preview.commit, "abc123");
        assert_eq!(preview.repo_path, "skills/example");
        fs::remove_dir_all(workspace).expect("workspace should be removed");
    }

    #[test]
    fn test_source_connection_for_state_returns_user_safe_success() {
        let workspace = temp_dir("test-source-connection");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let skill_dir = write_skill(
            &workspace.join("checkout").join("skills"),
            "example",
            "example",
            "Remote skill preview",
        );
        let checker = FakeUpdateChecker {
            commits: HashMap::from([("remote-preview".to_string(), "abc123".to_string())]),
            behind: 0,
            summary: DiffSummary {
                files_added: 0,
                files_modified: 0,
                files_deleted: 0,
                total_changes: 0,
            },
            details: HashMap::new(),
            checkout: Some(CheckoutResult {
                checkout_dir: workspace.join("checkout").to_string_lossy().to_string(),
                skill_dir: skill_dir.to_string_lossy().to_string(),
            }),
        };

        let result = test_source_connection_for_state_with_checker(
            &state,
            DesktopPreviewRemoteSkillSourceRequest {
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/example".to_string(),
                ref_: "main".to_string(),
            },
            &checker,
        )
        .expect("source connection test should succeed");

        assert!(result.ok);
        assert_eq!(result.message, "连接成功，可以保存来源。");
        assert_eq!(result.skill_name, "example");
        assert_eq!(result.commit, "abc123");
        assert_eq!(result.repo_path, "skills/example");
        fs::remove_dir_all(workspace).expect("workspace should be removed");
    }

    struct FakeGitVersionProbe {
        output: Result<GitEnvironmentProbeReport, String>,
    }

    impl GitVersionProbe for FakeGitVersionProbe {
        fn git_environment(&self) -> Result<GitEnvironmentProbeReport, String> {
            self.output.clone()
        }
    }

    #[test]
    fn test_git_environment_returns_local_git_version_without_remote_probe() {
        let probe = FakeGitVersionProbe {
            output: Ok(GitEnvironmentProbeReport {
                version: "git version 2.45.0".to_string(),
                clone_ok: true,
            }),
        };

        let result =
            test_git_environment_with_probe(&probe).expect("git environment test should succeed");

        assert!(result.ok);
        assert_eq!(result.message, "Git 可用");
        assert_eq!(result.version, "git version 2.45.0");
        assert!(result.clone_ok);
    }

    #[test]
    fn preview_remote_skill_source_for_state_maps_authentication_error() {
        let workspace = temp_dir("preview-auth");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));

        let error = preview_remote_skill_source_for_state_with_checker(
            &state,
            DesktopPreviewRemoteSkillSourceRequest {
                url: "https://github.com/private/metis-skills.git".to_string(),
                repo_path: "skills/private".to_string(),
                ref_: "main".to_string(),
            },
            &AuthFailureChecker,
        )
        .expect_err("auth failure should be mapped");

        let desktop_error: DesktopError =
            serde_json::from_str(&error).expect("desktop error should be JSON");
        assert_eq!(desktop_error.category, "authentication");
        assert_eq!(desktop_error.title, "认证失败");
        fs::remove_dir_all(workspace).expect("workspace should be removed");
    }

    #[test]
    fn get_skill_targets_for_source_for_state_returns_desktop_dtos() {
        let workspace = temp_dir("sync-targets");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let custom_root = workspace.join("team-memory-skills");
        fs::create_dir_all(&custom_root).expect("custom root should exist");
        save_desktop_settings_for_state(
            &state,
            DesktopSettings {
                custom_monitored_paths: vec![DesktopCustomMonitoredPath {
                    id: "team-memory".to_string(),
                    name: "团队记忆".to_string(),
                    path: custom_root.to_string_lossy().to_string(),
                }],
                ..DesktopSettings::default()
            },
        )
        .expect("settings should save");

        let targets = get_skill_targets_for_source_for_state(
            &state,
            DesktopSkillTargetsRequest {
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/example".to_string(),
                ref_: "main".to_string(),
                commit: "abc123".to_string(),
                install_name: "example".to_string(),
            },
        )
        .expect("targets should load");

        assert_eq!(targets.len(), 6);
        assert_eq!(targets[0].agent_id, "codex");
        assert_eq!(targets[0].status, "AgentRootUnavailable");
        assert!(!targets[0].install_path.contains("{name}"));
        assert!(targets.iter().all(|target| target.agent_id != "generic"));
        let custom_target = targets
            .iter()
            .find(|target| target.agent_id == "custom-team-memory")
            .expect("custom monitored path should be an install target");
        assert_eq!(custom_target.agent_name, "团队记忆");
        assert_eq!(custom_target.root_path, custom_root.to_string_lossy());
        assert_eq!(
            custom_target.install_path,
            custom_root.join("example").to_string_lossy()
        );
        assert_eq!(custom_target.status, "NotInstalled");
        fs::remove_dir_all(workspace).expect("workspace should be removed");
    }

    #[test]
    fn install_remote_skill_to_targets_for_state_returns_per_target_results() {
        let workspace = temp_dir("desktop-install");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let checkout_skill = write_skill(
            &workspace.join("checkout"),
            "remote",
            "Remote Skill",
            "Install me",
        );
        let install_path = workspace.join("codex-skills").join("remote");
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
                checkout_dir: workspace.join("checkout").to_string_lossy().to_string(),
                skill_dir: checkout_skill.to_string_lossy().to_string(),
            }),
        };

        let result = install_remote_skill_to_targets_for_state_with_checker(
            &state,
            DesktopInstallRemoteSkillRequest {
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/remote".to_string(),
                ref_: "main".to_string(),
                commit: "abc123".to_string(),
                install_name: "remote".to_string(),
                targets: vec![DesktopInstallSkillTarget {
                    agent_id: "codex".to_string(),
                    agent_name: "Codex".to_string(),
                    install_path: install_path.to_string_lossy().to_string(),
                }],
            },
            &checker,
        )
        .expect("desktop install should complete");

        assert_eq!(result.targets.len(), 1);
        assert_eq!(result.targets[0].status, "Installed");
        assert!(result.targets[0].skill_id.is_some());
        assert!(install_path.join("SKILL.md").is_file());

        fs::remove_dir_all(workspace).expect("workspace should be removed");
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
        assert_eq!(skill.file_count, None);
        assert_eq!(skill.total_size_bytes, None);
        assert_eq!(skill.local_modified, None);
        assert!(skill.local_updated_at.is_some());
        assert!(state.sqlite_path().starts_with(&data_root));
        assert!(state.backup_root().starts_with(&data_root));
    }

    #[test]
    fn list_indexed_skills_returns_cached_local_updated_at_without_recomputing_filesystem() {
        let workspace = temp_dir("cached-local-updated-at");
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
        let state = DesktopAppState::new(data_root, cache_root);

        scan_skills_for_state(
            &state,
            DesktopScanRequest {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("scan should work");
        let first = list_indexed_skills_for_state(&state).expect("indexed skills should load");
        let cached_updated_at = first[0]
            .local_updated_at
            .clone()
            .expect("scan should cache local updated at");
        let skill_file =
            fs::File::open(skill_dir.join("SKILL.md")).expect("skill file should open");
        let future_time = SystemTime::now() + std::time::Duration::from_secs(60);
        let times = fs::FileTimes::new()
            .set_modified(future_time)
            .set_accessed(future_time);
        skill_file
            .set_times(times)
            .expect("skill file time should update");

        let second = list_indexed_skills_for_state(&state).expect("indexed skills should reload");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(
            second[0].local_updated_at.as_deref(),
            Some(cached_updated_at.as_str())
        );
    }

    #[test]
    fn get_skill_size_for_state_returns_directory_size_for_one_skill() {
        let workspace = temp_dir("skill-size");
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
        fs::create_dir_all(skill_dir.join("references")).expect("references should be created");
        fs::write(skill_dir.join("references").join("guide.md"), "hello")
            .expect("reference should be written");
        let state = DesktopAppState::new(data_root, cache_root);

        scan_skills_for_state(
            &state,
            DesktopScanRequest {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("scan should work");

        let indexed = list_indexed_skills_for_state(&state).expect("indexed skills should load");
        let skill_id = indexed[0].id.clone();

        let size =
            get_skill_size_for_state(&state, &skill_id).expect("skill size should be computed");

        assert_eq!(size.skill_id, skill_id);
        assert_eq!(size.file_count, 2);
        assert!(size.total_size_bytes > 5);
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
            vec!["codex", "claude-code", "openclaw", "hermes", "opencode"]
        );
        assert!(agents.iter().all(|agent| !agent.paths.is_empty()));
    }

    #[test]
    fn list_agents_for_state_uses_saved_path_overrides_and_named_custom_monitors() {
        let workspace = temp_dir("agents-custom-state");
        let codex_root = workspace.join("codex-skills");
        let custom_root = workspace.join("custom-skills");
        fs::create_dir_all(&codex_root).expect("codex root should be created");
        fs::create_dir_all(&custom_root).expect("custom root should be created");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        save_desktop_settings_for_state(
            &state,
            DesktopSettings {
                agent_path_overrides: vec![DesktopAgentPathOverride {
                    agent_id: "codex".to_string(),
                    path: codex_root.to_string_lossy().to_string(),
                }],
                custom_monitored_paths: vec![DesktopCustomMonitoredPath {
                    id: "team-memory".to_string(),
                    name: "团队记忆".to_string(),
                    path: custom_root.to_string_lossy().to_string(),
                }],
                team_policy_path: None,
                enterprise_network: DesktopEnterpriseNetworkSettings::default(),
                ..Default::default()
            },
        )
        .expect("settings should save");

        let agents = list_agents_for_state(&state).expect("agents should load");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        let codex = agents
            .iter()
            .find(|agent| agent.agent_id == "codex")
            .expect("codex agent should exist");
        assert_eq!(codex.paths[0].path, codex_root.to_string_lossy());

        let custom = agents
            .iter()
            .find(|agent| agent.agent_id == "custom-team-memory")
            .expect("named custom monitor should exist");
        assert_eq!(custom.agent_name, "团队记忆");
        assert_eq!(custom.paths[0].path, custom_root.to_string_lossy());
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
                agent_path_overrides: vec![DesktopAgentPathOverride {
                    agent_id: " codex ".to_string(),
                    path: "  /tmp/metis/codex  ".to_string(),
                }],
                custom_monitored_paths: vec![DesktopCustomMonitoredPath {
                    id: "".to_string(),
                    name: "  Team Memory  ".to_string(),
                    path: "  /tmp/metis/team-memory  ".to_string(),
                }],
                team_policy_path: Some("  /tmp/metis/team-policy.json  ".to_string()),
                enterprise_network: DesktopEnterpriseNetworkSettings::default(),
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
        assert_eq!(
            saved.agent_path_overrides,
            vec![DesktopAgentPathOverride {
                agent_id: "codex".to_string(),
                path: "/tmp/metis/codex".to_string(),
            }]
        );
        assert_eq!(
            saved.custom_monitored_paths,
            vec![DesktopCustomMonitoredPath {
                id: "monitor-1".to_string(),
                name: "Team Memory".to_string(),
                path: "/tmp/metis/team-memory".to_string(),
            }]
        );
        assert_eq!(loaded, saved);
        assert_eq!(
            loaded.team_policy_path.as_deref(),
            Some("/tmp/metis/team-policy.json")
        );
    }

    #[test]
    fn enterprise_network_settings_normalize_and_build_git_environment() {
        let workspace = temp_dir("enterprise-network-settings");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));

        let saved = save_desktop_settings_for_state(
            &state,
            DesktopSettings {
                custom_scan_paths: Vec::new(),
                team_policy_path: None,
                enterprise_network: DesktopEnterpriseNetworkSettings {
                    proxy_url: Some("  http://proxy.corp.example:8080  ".to_string()),
                    no_proxy: Some("  localhost,127.0.0.1,.corp.example  ".to_string()),
                    certificate_authority_bundle_path: Some(
                        "  /Users/me/certs/corp-ca.pem  ".to_string(),
                    ),
                },
                ..Default::default()
            },
        )
        .expect("settings should save");
        let environment = git_environment_for_settings(&saved);

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(
            saved.enterprise_network.proxy_url.as_deref(),
            Some("http://proxy.corp.example:8080")
        );
        assert_eq!(
            saved.enterprise_network.no_proxy.as_deref(),
            Some("localhost,127.0.0.1,.corp.example")
        );
        assert_eq!(
            saved
                .enterprise_network
                .certificate_authority_bundle_path
                .as_deref(),
            Some("/Users/me/certs/corp-ca.pem")
        );
        assert_eq!(
            environment,
            vec![
                (
                    "HTTPS_PROXY".to_string(),
                    "http://proxy.corp.example:8080".to_string()
                ),
                (
                    "HTTP_PROXY".to_string(),
                    "http://proxy.corp.example:8080".to_string()
                ),
                (
                    "NO_PROXY".to_string(),
                    "localhost,127.0.0.1,.corp.example".to_string()
                ),
                (
                    "GIT_SSL_CAINFO".to_string(),
                    "/Users/me/certs/corp-ca.pem".to_string()
                ),
            ]
        );
    }

    #[test]
    fn team_policy_summary_loads_trusted_sources_from_settings_path() {
        let workspace = temp_dir("team-policy-summary");
        let policy_path = workspace.join("policy/team-policy.json");
        fs::create_dir_all(policy_path.parent().expect("policy should have parent"))
            .expect("policy parent should be created");
        fs::write(
            &policy_path,
            r#"{
                "version": "1",
                "trusted_sources": [
                    {
                        "url": "https://github.com/example/team-skills.git",
                        "repo_path": "skills/team",
                        "ref": "main"
                    }
                ],
                "update_policy": {
                    "allow_auto_update": true,
                    "require_trusted_source": true
                }
            }"#,
        )
        .expect("policy should write");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        save_desktop_settings_for_state(
            &state,
            DesktopSettings {
                custom_scan_paths: Vec::new(),
                team_policy_path: Some(policy_path.to_string_lossy().to_string()),
                enterprise_network: DesktopEnterpriseNetworkSettings::default(),
                ..Default::default()
            },
        )
        .expect("settings should save");

        let summary = get_team_policy_summary_for_state(&state)
            .expect("policy summary should load")
            .expect("policy summary should exist");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(summary.version, "1");
        assert_eq!(summary.trusted_sources, 1);
        assert!(summary.allow_auto_update);
        assert!(summary.require_trusted_source);
    }

    #[test]
    fn bind_skill_source_for_state_applies_team_policy_defaults_and_auto_update_gate() {
        let workspace = temp_dir("team-policy-bind-source");
        let skill_root = workspace.join("skills");
        let policy_path = workspace.join("policy/team-policy.json");
        fs::create_dir_all(&skill_root).expect("skill root should be created");
        fs::create_dir_all(policy_path.parent().expect("policy should have parent"))
            .expect("policy parent should be created");
        fs::write(
            &policy_path,
            r#"{
                "version": "1",
                "trusted_sources": [
                    {
                        "url": "https://github.com/example/team-skills.git",
                        "repo_path": "skills/writer",
                        "ref": "main"
                    }
                ],
                "update_policy": {
                    "allow_auto_update": true,
                    "require_trusted_source": true
                }
            }"#,
        )
        .expect("policy should write");
        write_skill(&skill_root, "writer", "writer", "Writes things");
        write_skill(&skill_root, "personal", "personal", "Personal things");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        save_desktop_settings_for_state(
            &state,
            DesktopSettings {
                custom_scan_paths: Vec::new(),
                team_policy_path: Some(policy_path.to_string_lossy().to_string()),
                enterprise_network: DesktopEnterpriseNetworkSettings::default(),
                ..Default::default()
            },
        )
        .expect("settings should save");
        let scanned = scan_skills_for_state(
            &state,
            DesktopScanRequest {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("scan should succeed");
        let writer_id = scanned
            .skills
            .iter()
            .find(|skill| skill.name == "writer")
            .expect("writer should exist")
            .id
            .clone();
        let personal_id = scanned
            .skills
            .iter()
            .find(|skill| skill.name == "personal")
            .expect("personal should exist")
            .id
            .clone();

        let trusted = bind_skill_source_for_state(
            &state,
            DesktopBindSourceRequest {
                skill_id: writer_id,
                url: "https://github.com/example/team-skills.git".to_string(),
                repo_path: "skills/writer".to_string(),
                ref_: "main".to_string(),
                credential_ref: None,
                trusted: false,
                auto_update: true,
            },
        )
        .expect("trusted source should bind");
        let untrusted = bind_skill_source_for_state(
            &state,
            DesktopBindSourceRequest {
                skill_id: personal_id,
                url: "https://github.com/example/personal.git".to_string(),
                repo_path: "skills/personal".to_string(),
                ref_: "main".to_string(),
                credential_ref: None,
                trusted: false,
                auto_update: true,
            },
        )
        .expect("untrusted source should bind with auto update disabled");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert!(trusted.trusted);
        assert!(trusted.auto_update);
        assert!(!untrusted.trusted);
        assert!(!untrusted.auto_update);
    }

    #[test]
    fn policy_audit_reports_existing_source_recommendations_without_mutating_sources() {
        let workspace = temp_dir("policy-audit");
        let policy_path = workspace.join("policy/team-policy.json");
        fs::create_dir_all(policy_path.parent().expect("policy should have parent"))
            .expect("policy parent should be created");
        fs::write(
            &policy_path,
            r#"{
                "version": "1",
                "trusted_sources": [
                    {"url": "https://github.com/example/team.git", "repo_path": "skills/compliant", "ref": "main"},
                    {"url": "https://github.com/example/team.git", "repo_path": "skills/needs-trusted", "ref": "main"}
                ],
                "update_policy": {
                    "allow_auto_update": true,
                    "require_trusted_source": true
                }
            }"#,
        )
        .expect("policy should write");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        save_desktop_settings_for_state(
            &state,
            DesktopSettings {
                custom_scan_paths: Vec::new(),
                team_policy_path: Some(policy_path.to_string_lossy().to_string()),
                enterprise_network: DesktopEnterpriseNetworkSettings::default(),
                ..Default::default()
            },
        )
        .expect("settings should save");
        let store = state.open_store().expect("store should open");
        for (skill_id, name, source_id, repo_path, trusted, auto_update) in [
            (
                "skill-compliant",
                "Compliant",
                "source-compliant",
                "skills/compliant",
                true,
                true,
            ),
            (
                "skill-needs-trusted",
                "Needs Trusted",
                "source-needs-trusted",
                "skills/needs-trusted",
                false,
                true,
            ),
            (
                "skill-untrusted-auto",
                "Untrusted Auto",
                "source-untrusted-auto",
                "skills/untrusted",
                false,
                true,
            ),
        ] {
            store
                .upsert_source(&SourceRecord {
                    id: source_id.to_string(),
                    source_type: "git".to_string(),
                    url: if repo_path == "skills/untrusted" {
                        "https://github.com/example/personal.git".to_string()
                    } else {
                        "https://github.com/example/team.git".to_string()
                    },
                    repo_path: repo_path.to_string(),
                    ref_: "main".to_string(),
                    current_commit: Some("aaa111".to_string()),
                    remote_commit: Some("bbb222".to_string()),
                    last_checked_at: Some("2026-06-20T10:00:00Z".to_string()),
                    trusted,
                    auto_update,
                    credential_ref: Some("secret-token".to_string()),
                    created_at: None,
                    updated_at: None,
                })
                .expect("source should insert");
            store
                .upsert_skill(&SkillRecord {
                    id: skill_id.to_string(),
                    agent_id: "generic".to_string(),
                    name: name.to_string(),
                    description: Some("Policy audit skill".to_string()),
                    version: None,
                    author: None,
                    license: None,
                    tags: Vec::new(),
                    category: None,
                    install_path: workspace
                        .join(format!("skills/{skill_id}"))
                        .to_string_lossy()
                        .to_string(),
                    scope: "custom".to_string(),
                    metadata_path: None,
                    metadata_status: "found".to_string(),
                    metadata_error: None,
                    source_id: Some(source_id.to_string()),
                    local_fingerprint: None,
                    local_modified: Some(false),
                    last_scanned_at: "2026-06-20T10:00:00Z".to_string(),
                    local_updated_at: Some("2026-06-20T10:00:00Z".to_string()),
                })
                .expect("skill should insert");
        }

        let report =
            get_team_policy_audit_report_for_state(&state).expect("policy audit should load");
        let json = serde_json::to_string(&report).expect("report should serialize");
        let sources = store.list_sources().expect("sources should remain");

        drop(store);
        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(report.total_bound_sources, 3);
        assert_eq!(report.compliant, 1);
        assert_eq!(report.should_mark_trusted, 1);
        assert_eq!(report.auto_update_disallowed, 1);
        assert!(report.items.iter().any(|item| item.status == "compliant"));
        assert!(report
            .items
            .iter()
            .any(|item| item.status == "should_mark_trusted"));
        assert!(report
            .items
            .iter()
            .any(|item| item.status == "auto_update_disallowed"));
        assert!(sources.iter().any(|source| {
            source.id == "source-needs-trusted" && !source.trusted && source.auto_update
        }));
        assert!(!json.contains("secret-token"));
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
                team_policy_path: None,
                enterprise_network: DesktopEnterpriseNetworkSettings::default(),
                ..Default::default()
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

        drop(store);
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

        drop(store);
        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(results[0].status, "CheckFailed");
        assert_eq!(
            results[0].failure_reason.as_deref(),
            Some("Metis 访问不了这个仓库")
        );
    }

    #[test]
    fn desktop_error_classifies_auth_failure_with_user_suggestion_and_debug_detail() {
        let error = friendly_desktop_error(
            "authentication failed: could not read Username for 'https://github.com'",
        );

        assert_eq!(error.category, "authentication");
        assert_eq!(error.title, "认证失败");
        assert_eq!(error.message, "Metis 访问不了这个仓库");
        assert_eq!(
            error.suggestion,
            "请确认你有访问权限，或先在本机 Git 工具中完成登录。"
        );
        assert_eq!(
            error.debug_detail.as_deref(),
            Some("authentication failed: could not read Username for 'https://github.com'")
        );
    }

    #[test]
    fn desktop_error_classifies_ssh_host_key_verification_failure() {
        let raw = "git command failed: git ls-remote git@github.com:example/repo.git main: Host key verification failed.";
        let error = friendly_desktop_error(raw);

        assert_eq!(error.category, "ssh_host_key");
        assert_eq!(error.title, "SSH 主机未确认");
        assert_eq!(
            error.message,
            "Metis 不能直接确认这个 Git 主机的 SSH 指纹。"
        );
        assert_eq!(
            error.suggestion,
            "请先在终端用系统 Git 连接一次该主机并确认指纹，或改用 HTTPS 仓库地址。"
        );
        assert_eq!(error.debug_detail.as_deref(), Some(raw));
    }

    #[test]
    fn desktop_error_guides_missing_remote_ref_as_main_branch_name() {
        let raw = "remote ref not found: git@github.com:example/repo.git missing-branch";
        let error = friendly_desktop_error(raw);

        assert_eq!(error.category, "git_ref");
        assert_eq!(error.title, "分支不存在");
        assert_eq!(error.message, "Metis 能访问仓库，但找不到这个主分支名。");
        assert_eq!(
            error.suggestion,
            "请检查“主分支名”是否填写正确，一般为 main 或者 master。"
        );
        assert_eq!(error.debug_detail.as_deref(), Some(raw));
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
                "security_notice",
                "更新内容需要留意",
                "更新内容包含脚本或配置字段，Metis 已保留提示信息。",
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
            (
                "git operation failed: git command failed: git -C /tmp/cache checkout abc123: fatal: could not fetch deadbeef from promisor remote",
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
    fn open_external_url_validation_only_allows_metis_github() {
        assert!(validate_external_url("https://github.com/wylycool/metis").is_ok());
        assert!(validate_external_url("https://github.com/wylycool/metis/").is_ok());
        assert!(validate_external_url("https://github.com/example/metis").is_err());
        assert!(validate_external_url("file:///tmp/metis").is_err());
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
                local_updated_at: Some("2026-06-20T10:00:00Z".to_string()),
            })
            .expect("skill should insert");

        let report =
            export_environment_report_for_state(&state).expect("environment report should export");
        let json = serde_json::to_string(&report).expect("report should serialize");

        drop(store);
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
    fn check_team_manifest_compliance_for_state_returns_read_only_report() {
        let workspace = temp_dir("team-compliance");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let store = state.open_store().expect("store should open");
        store
            .upsert_source(&SourceRecord {
                id: "source-installed".to_string(),
                source_type: "git".to_string(),
                url: "https://github.com/example/team-skills.git".to_string(),
                repo_path: "skills/installed".to_string(),
                ref_: "main".to_string(),
                current_commit: Some("aaa111".to_string()),
                remote_commit: None,
                last_checked_at: None,
                trusted: true,
                auto_update: false,
                credential_ref: Some("secret-token".to_string()),
                created_at: None,
                updated_at: None,
            })
            .expect("source should insert");
        store
            .upsert_skill(&SkillRecord {
                id: "skill-installed".to_string(),
                agent_id: "generic".to_string(),
                name: "Installed".to_string(),
                description: Some("Installed team skill".to_string()),
                version: None,
                author: None,
                license: None,
                tags: Vec::new(),
                category: None,
                install_path: workspace
                    .join("skills/installed")
                    .to_string_lossy()
                    .to_string(),
                scope: "custom".to_string(),
                metadata_path: None,
                metadata_status: "found".to_string(),
                metadata_error: None,
                source_id: Some("source-installed".to_string()),
                local_fingerprint: None,
                local_modified: Some(false),
                last_scanned_at: "2026-06-20T10:00:00Z".to_string(),
                local_updated_at: Some("2026-06-20T10:00:00Z".to_string()),
            })
            .expect("skill should insert");
        let manifest_json = serde_json::json!({
            "version": "1",
            "exported_at": "2026-06-20T12:00:00Z",
            "skills": [
                {
                    "name": "Installed",
                    "agent_id": "generic",
                    "source_url": "https://github.com/example/team-skills.git",
                    "source_repo_path": "skills/installed",
                    "source_ref": "main",
                    "source_commit": "aaa111",
                    "install_path_hint": null
                },
                {
                    "name": "Missing",
                    "agent_id": "generic",
                    "source_url": "https://github.com/example/team-skills.git",
                    "source_repo_path": "skills/missing",
                    "source_ref": "main",
                    "source_commit": "bbb222",
                    "install_path_hint": null
                }
            ]
        })
        .to_string();

        let report = check_team_manifest_compliance_for_state(
            &state,
            DesktopTeamManifestComplianceRequest { manifest_json },
        )
        .expect("desktop compliance should return");
        let json = serde_json::to_string(&report).expect("report should serialize");

        drop(store);
        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(report.summary.total, 2);
        assert_eq!(report.summary.installed, 1);
        assert_eq!(report.summary.missing, 1);
        assert_eq!(report.items[0].status, "installed");
        assert_eq!(report.items[1].status, "missing");
        assert!(!json.contains("secret-token"));
    }

    #[test]
    fn phase4_local_governance_exports_read_and_write_reports_without_credentials() {
        let workspace = temp_dir("phase4-local-governance-exports");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let manifest_path = workspace.join("team/manifest.json");
        fs::create_dir_all(manifest_path.parent().expect("manifest should have parent"))
            .expect("manifest parent should be created");
        fs::write(
            &manifest_path,
            r#"{"version":"1","exported_at":"2026-06-20T12:00:00Z","skills":[]}"#,
        )
        .expect("manifest should write");

        let loaded_manifest = load_team_manifest_from_file_for_state(
            &state,
            manifest_path.to_string_lossy().to_string(),
        )
        .expect("manifest should load");

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
                local_updated_at: Some("2026-06-20T10:00:00Z".to_string()),
            })
            .expect("skill should insert");
        store
            .insert_audit_event(&metis_storage::db::AuditEventRecord {
                id: "audit-1".to_string(),
                skill_id: "trusted-skill".to_string(),
                action: "source_bound".to_string(),
                detail: Some("bound source without secret values".to_string()),
                commit_before: None,
                commit_after: Some("aaa111".to_string()),
                status: "success".to_string(),
                risk_summary: None,
                created_at: Some("2026-06-20T10:01:00Z".to_string()),
            })
            .expect("audit event should insert");
        drop(store);

        let compliance_report = DesktopTeamManifestComplianceReport {
            generated_at: "2026-06-20T10:02:00Z".to_string(),
            manifest_version: "1".to_string(),
            summary: DesktopTeamManifestComplianceSummary {
                total: 1,
                installed: 1,
                missing: 0,
                version_mismatch: 0,
                local_modified: 0,
                source_mismatch: 0,
            },
            items: vec![DesktopTeamManifestComplianceItem {
                name: "Trusted Skill".to_string(),
                agent_id: "generic".to_string(),
                status: "installed".to_string(),
                expected_source_url: Some("file:///tmp/metis-trusted".to_string()),
                expected_source_repo_path: Some("skills/trusted".to_string()),
                expected_source_ref: Some("main".to_string()),
                expected_commit: Some("aaa111".to_string()),
                local_skill_id: Some("trusted-skill".to_string()),
                local_install_path: Some(
                    workspace
                        .join("skills/trusted-skill")
                        .to_string_lossy()
                        .to_string(),
                ),
                local_source_url: Some("file:///tmp/metis-trusted".to_string()),
                local_source_repo_path: Some("skills/trusted".to_string()),
                local_source_ref: Some("main".to_string()),
                local_commit: Some("aaa111".to_string()),
                local_modified: Some(false),
                trusted_source: Some(true),
            }],
        };

        let compliance_output = workspace.join("reports/compliance.json");
        let environment_output = workspace.join("reports/environment.json");
        let audit_output = workspace.join("reports/audit.json");

        let compliance_written = export_team_compliance_report_to_file_for_state(
            &state,
            DesktopTeamComplianceReportExportRequest {
                output_path: compliance_output.to_string_lossy().to_string(),
                report: compliance_report,
            },
        )
        .expect("compliance report should export");
        let environment_written = export_environment_report_to_file_for_state(
            &state,
            environment_output.to_string_lossy().to_string(),
        )
        .expect("environment report should export");
        let audit_written = export_audit_log_report_to_file_for_state(
            &state,
            DesktopAuditLogExportRequest {
                output_path: audit_output.to_string_lossy().to_string(),
                limit: 200,
                offset: 0,
            },
        )
        .expect("audit report should export");

        let compliance_json =
            fs::read_to_string(&compliance_output).expect("compliance output should read");
        let environment_json =
            fs::read_to_string(&environment_output).expect("environment output should read");
        let audit_json = fs::read_to_string(&audit_output).expect("audit output should read");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert!(loaded_manifest.contains("\"version\":\"1\""));
        assert_eq!(
            compliance_written.output_path,
            compliance_output.to_string_lossy()
        );
        assert_eq!(
            environment_written.output_path,
            environment_output.to_string_lossy()
        );
        assert_eq!(audit_written.output_path, audit_output.to_string_lossy());
        assert!(compliance_json.contains("\"status\": \"installed\""));
        assert!(environment_json.contains("\"has_credential_ref\": true"));
        assert!(audit_json.contains("\"total\": 1"));
        assert!(audit_json.contains("\"action\": \"SourceBound\""));
        assert!(!compliance_json.contains("secret-token"));
        assert!(!environment_json.contains("secret-token"));
        assert!(!audit_json.contains("secret-token"));
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

        drop(store);
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
    fn list_skill_audit_events_for_state_returns_recent_skill_history() {
        let workspace = temp_dir("skill-audit-history");
        let skill_root = workspace.join("skills");
        fs::create_dir_all(&skill_root).expect("skill root should be created");
        write_skill(&skill_root, "history", "history", "History skill");
        write_skill(&skill_root, "other", "other", "Other skill");
        let state = DesktopAppState::new(workspace.join("data"), workspace.join("cache"));
        let scanned = scan_skills_for_state(
            &state,
            DesktopScanRequest {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![skill_root.to_string_lossy().to_string()],
            },
        )
        .expect("scan should insert skill");
        let skill_id = scanned
            .skills
            .iter()
            .find(|skill| skill.name == "history")
            .expect("history skill should exist")
            .id
            .clone();
        let other_skill_id = scanned
            .skills
            .iter()
            .find(|skill| skill.name == "other")
            .expect("other skill should exist")
            .id
            .clone();
        {
            let store = state.open_store().expect("store should open");
            store
                .insert_audit_event(&metis_storage::db::AuditEventRecord {
                    id: "audit-old".to_string(),
                    skill_id: skill_id.clone(),
                    action: "update_checked".to_string(),
                    detail: Some("update checked".to_string()),
                    commit_before: Some("aaa111".to_string()),
                    commit_after: Some("bbb222".to_string()),
                    status: "success".to_string(),
                    risk_summary: None,
                    created_at: Some("2026-07-01T10:00:00Z".to_string()),
                })
                .expect("first audit event should insert");
            store
                .insert_audit_event(&metis_storage::db::AuditEventRecord {
                    id: "audit-new".to_string(),
                    skill_id: skill_id.clone(),
                    action: "update_applied".to_string(),
                    detail: Some("update applied".to_string()),
                    commit_before: Some("aaa111".to_string()),
                    commit_after: Some("bbb222".to_string()),
                    status: "success".to_string(),
                    risk_summary: Some("[]".to_string()),
                    created_at: Some("2026-07-01T10:05:00Z".to_string()),
                })
                .expect("second audit event should insert");
            store
                .insert_audit_event(&metis_storage::db::AuditEventRecord {
                    id: "audit-other".to_string(),
                    skill_id: other_skill_id,
                    action: "update_applied".to_string(),
                    detail: Some("other skill updated".to_string()),
                    commit_before: None,
                    commit_after: None,
                    status: "success".to_string(),
                    risk_summary: None,
                    created_at: Some("2026-07-01T10:10:00Z".to_string()),
                })
                .expect("other audit event should insert");
        }

        let events = list_skill_audit_events_for_state(&state, skill_id.clone(), 2)
            .expect("skill audit events should load");

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].id, "audit-new");
        assert_eq!(events[0].action, "UpdateApplied");
        assert_eq!(events[1].id, "audit-old");
        assert!(events.iter().all(|event| event.skill_id == skill_id));
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
