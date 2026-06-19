//! Metis Desktop App — Tauri 后端
//!
//! Tauri command 是 UI 到 Core Engine 的薄封装层。
//! 核心逻辑全部在 metis-core 中实现。

use metis_core::discovery::{
    list_agents as core_list_agents, scan_and_index_skills, AgentStatus, ListAgentsOptions,
    ScanOptions, ScanResult,
};
use metis_core::source::{
    bind_source as core_bind_source, unbind_source as core_unbind_source, Source, SourceInput,
    SourceType,
};
use metis_core::update::{
    check_updates as core_check_updates, DiffSummary, RemoteCommitChecker, UpdateCheckOptions,
    UpdateCheckResult, UpdateStatus,
};
use metis_git_provider::fetch::SystemGitCliProvider;
use metis_storage::db::{SkillIndexStore, SkillRecord, SourceRecord};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct DesktopAppState {
    sqlite_path: PathBuf,
    backup_root: PathBuf,
    cache_root: PathBuf,
}

impl DesktopAppState {
    pub fn new(data_root: impl Into<PathBuf>, cache_root: impl Into<PathBuf>) -> Self {
        let data_root = data_root.into();
        let cache_root = cache_root.into().join("metis");

        Self {
            sqlite_path: data_root.join("metis.db"),
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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopBindSourceRequest {
    pub skill_id: String,
    pub url: String,
    pub repo_path: String,
    pub ref_: String,
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
pub struct DesktopScanWarning {
    pub agent_id: String,
    pub path: String,
    pub skill_path: Option<String>,
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopScanResponse {
    pub skills: Vec<DesktopSkill>,
    pub warnings: Vec<DesktopScanWarning>,
}

pub fn list_agents_for_state(_state: &DesktopAppState) -> Result<Vec<DesktopAgentStatus>, String> {
    Ok(core_list_agents(ListAgentsOptions::default())
        .into_iter()
        .map(desktop_agent_status)
        .collect())
}

pub fn scan_skills_for_state(
    state: &DesktopAppState,
    request: DesktopScanRequest,
) -> Result<DesktopScanResponse, String> {
    let store = state.open_store()?;
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
            credential_ref: None,
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
    let checker = SystemGitCliProvider::default();
    check_skill_updates_for_state_with_checker(&state, request, &checker)
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
    }
}

fn desktop_update_check_result(result: UpdateCheckResult) -> DesktopUpdateCheckResult {
    let (status, failure_reason) = match result.status {
        UpdateStatus::UpToDate => ("UpToDate".to_string(), None),
        UpdateStatus::UpdateAvailable => ("UpdateAvailable".to_string(), None),
        UpdateStatus::NoSource => ("NoSource".to_string(), None),
        UpdateStatus::CheckFailed { reason } => ("CheckFailed".to_string(), Some(reason)),
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
            bind_skill_source,
            unbind_skill_source,
            check_skill_updates
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use metis_core::update::{CheckoutResult, DiffDetail, DiffSummary, RemoteCommitChecker};
    use metis_storage::db::SourceRecord;
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct FakeUpdateChecker {
        commits: HashMap<String, String>,
        behind: u32,
        summary: DiffSummary,
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
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<DiffDetail, String> {
            Err("not used by desktop update status tests".to_string())
        }

        fn checkout_to_cache(
            &self,
            _source: &SourceRecord,
            _target_commit: &str,
            _cache_dir: &str,
        ) -> Result<CheckoutResult, String> {
            Err("not used by desktop update status tests".to_string())
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
        assert!(source.trusted);
        assert_eq!(indexed[0].source_id.as_deref(), Some(source.id.as_str()));
        assert_eq!(
            indexed[0].source.as_ref().map(|item| item.id.as_str()),
            Some(source.id.as_str())
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
}
