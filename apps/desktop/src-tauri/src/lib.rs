//! Metis Desktop App — Tauri 后端
//!
//! Tauri command 是 UI 到 Core Engine 的薄封装层。
//! 核心逻辑全部在 metis-core 中实现。

use metis_core::discovery::{
    list_agents as core_list_agents, scan_and_index_skills, AgentStatus, ListAgentsOptions,
    ScanOptions, ScanResult,
};
use metis_storage::db::{SkillIndexStore, SkillRecord};
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
    pub local_modified: Option<bool>,
    pub last_scanned_at: String,
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
        .map(desktop_skill)
        .collect()
}

fn desktop_skill(record: SkillRecord) -> Result<DesktopSkill, String> {
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
        local_modified: record.local_modified,
        last_scanned_at: record.last_scanned_at,
    })
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
            list_indexed_skills
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

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
}
