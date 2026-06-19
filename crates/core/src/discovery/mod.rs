use chrono::{DateTime, Utc};
use metis_adapters::claude_code::ClaudeCodeAdapter;
use metis_adapters::codex::CodexAdapter;
use metis_adapters::generic::GenericAgentSkillsAdapter;
use metis_adapters::hermes::HermesAdapter;
use metis_adapters::openclaw::OpenClawAdapter;
use metis_adapters::opencode::OpencodeAdapter;
use metis_adapters::{AdapterError, AdapterRegistry, AgentAdapter, SkillScope};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Default)]
pub struct ListAgentsOptions {
    pub enabled_agent_ids: Option<Vec<String>>,
    pub custom_paths: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ScanOptions {
    pub agent_ids: Option<Vec<String>>,
    pub custom_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentStatus {
    pub agent_id: String,
    pub agent_name: String,
    pub enabled: bool,
    pub paths: Vec<AgentPath>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentPath {
    pub path: String,
    pub scope: PathScope,
    pub exists: bool,
    pub readable: bool,
    pub writable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PathScope {
    User,
    Project,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScanResult {
    pub skills: Vec<Skill>,
    pub warnings: Vec<ScanWarning>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub agent_id: String,
    pub name: String,
    pub description: Option<String>,
    pub install_path: String,
    pub scope: PathScope,
    pub metadata_path: Option<String>,
    pub metadata_status: MetadataStatus,
    pub source_id: Option<String>,
    pub local_fingerprint: Option<String>,
    pub local_modified: Option<bool>,
    pub last_scanned_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum MetadataStatus {
    Found,
    Missing,
    ParseError { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScanWarning {
    pub agent_id: String,
    pub path: String,
    pub skill_path: Option<String>,
    pub kind: ScanWarningKind,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScanWarningKind {
    DiscoveryError,
    MetadataParseError,
}

pub fn list_agents(options: ListAgentsOptions) -> Vec<AgentStatus> {
    let registry = build_registry(options.custom_paths);

    registry
        .all()
        .iter()
        .map(|adapter| {
            let enabled = options
                .enabled_agent_ids
                .as_ref()
                .map(|ids| ids.iter().any(|id| id == adapter.agent_id()))
                .unwrap_or(true);
            let paths = adapter
                .candidate_paths()
                .into_iter()
                .map(|path| {
                    let expanded = expand_path_template(&path.path_template);
                    AgentPath {
                        path: expanded.to_string_lossy().to_string(),
                        scope: scope_to_path_scope(path.scope),
                        exists: expanded.exists(),
                        readable: is_readable_dir(&expanded),
                        writable: is_writable_dir(&expanded),
                    }
                })
                .collect();

            AgentStatus {
                agent_id: adapter.agent_id().to_string(),
                agent_name: adapter.agent_name().to_string(),
                enabled,
                paths,
            }
        })
        .collect()
}

pub fn scan_skills(options: ScanOptions) -> ScanResult {
    let registry = build_registry(options.custom_paths);
    let adapters = selected_adapters(&registry, options.agent_ids.as_deref());
    let mut skills = Vec::new();
    let mut warnings = Vec::new();

    for adapter in adapters {
        for search_path in adapter.candidate_paths() {
            let root = expand_path_template(&search_path.path_template);
            let root_display = root.to_string_lossy().to_string();
            let discovered = match adapter.discover_skill_dirs(&root_display) {
                Ok(discovered) => discovered,
                Err(error) => {
                    warnings.push(ScanWarning {
                        agent_id: adapter.agent_id().to_string(),
                        path: root_display,
                        skill_path: None,
                        kind: ScanWarningKind::DiscoveryError,
                        message: error.to_string(),
                    });
                    continue;
                }
            };

            for relative_skill_dir in discovered {
                let skill_path = root.join(&relative_skill_dir);
                let skill_path_display = skill_path.to_string_lossy().to_string();
                match adapter.parse_metadata(&skill_path_display) {
                    Ok(metadata) => skills.push(Skill {
                        id: Uuid::new_v4().to_string(),
                        agent_id: adapter.agent_id().to_string(),
                        name: metadata.name,
                        description: metadata.description,
                        install_path: skill_path_display.clone(),
                        scope: scope_to_path_scope(
                            adapter.resolve_scope(&skill_path_display, &root_display),
                        ),
                        metadata_path: Some(
                            skill_path.join("SKILL.md").to_string_lossy().to_string(),
                        ),
                        metadata_status: MetadataStatus::Found,
                        source_id: None,
                        local_fingerprint: None,
                        local_modified: None,
                        last_scanned_at: Utc::now(),
                    }),
                    Err(error) => warnings.push(ScanWarning {
                        agent_id: adapter.agent_id().to_string(),
                        path: root_display.clone(),
                        skill_path: Some(skill_path_display),
                        kind: warning_kind_for_error(&error),
                        message: error.to_string(),
                    }),
                }
            }
        }
    }

    skills.sort_by(|left, right| {
        left.agent_id
            .cmp(&right.agent_id)
            .then_with(|| left.install_path.cmp(&right.install_path))
    });
    warnings.sort_by(|left, right| {
        left.agent_id
            .cmp(&right.agent_id)
            .then_with(|| left.path.cmp(&right.path))
            .then_with(|| left.skill_path.cmp(&right.skill_path))
    });

    ScanResult { skills, warnings }
}

fn build_registry(custom_paths: Vec<String>) -> AdapterRegistry {
    if custom_paths.is_empty() {
        return AdapterRegistry::default();
    }

    let mut registry = AdapterRegistry::new();
    registry.register(Box::new(CodexAdapter::new()));
    registry.register(Box::new(ClaudeCodeAdapter::new()));
    registry.register(Box::new(OpenClawAdapter::new()));
    registry.register(Box::new(HermesAdapter::new()));
    registry.register(Box::new(OpencodeAdapter::new()));
    registry.register(Box::new(GenericAgentSkillsAdapter::new(custom_paths)));
    registry
}

fn selected_adapters<'a>(
    registry: &'a AdapterRegistry,
    agent_ids: Option<&[String]>,
) -> Vec<&'a dyn AgentAdapter> {
    match agent_ids {
        Some(agent_ids) => registry.enabled(agent_ids),
        None => registry
            .all()
            .iter()
            .map(|adapter| adapter.as_ref())
            .collect(),
    }
}

fn expand_path_template(template: &str) -> PathBuf {
    let home = dirs::home_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let xdg_config_home = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if home.is_empty() {
                String::new()
            } else {
                format!("{}/.config", home)
            }
        });
    let xdg_data_home = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if home.is_empty() {
                String::new()
            } else {
                format!("{}/.local/share", home)
            }
        });

    let expanded = template
        .replace("$HOME", &home)
        .replace("$XDG_CONFIG_HOME", &xdg_config_home)
        .replace("$XDG_DATA_HOME", &xdg_data_home)
        .replace("$APPDATA", &std::env::var("APPDATA").unwrap_or_default())
        .replace(
            "$LOCALAPPDATA",
            &std::env::var("LOCALAPPDATA").unwrap_or_default(),
        );

    PathBuf::from(expanded)
}

fn scope_to_path_scope(scope: SkillScope) -> PathScope {
    match scope {
        SkillScope::User => PathScope::User,
        SkillScope::Project => PathScope::Project,
        SkillScope::System | SkillScope::Admin => PathScope::System,
    }
}

fn is_readable_dir(path: &Path) -> bool {
    fs::read_dir(path).is_ok()
}

fn is_writable_dir(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| !metadata.permissions().readonly())
        .unwrap_or(false)
}

fn warning_kind_for_error(error: &AdapterError) -> ScanWarningKind {
    match error {
        AdapterError::ParseError { .. } | AdapterError::InvalidFormat { .. } => {
            ScanWarningKind::MetadataParseError
        }
        _ => ScanWarningKind::DiscoveryError,
    }
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
        std::env::temp_dir().join(format!("metis-core-{}-{}", name, suffix))
    }

    fn write_file(path: &Path, contents: &str) {
        fs::write(path, contents).expect("test file should be writable");
    }

    #[test]
    fn list_agents_includes_default_mvp_adapters() {
        let result = list_agents(ListAgentsOptions::default());
        let agent_ids = result
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
    }

    #[test]
    fn scan_skills_returns_metadata_from_generic_custom_path() {
        let root = temp_dir("generic-scan");
        let skill_dir = root.join("planning-skill");
        fs::create_dir_all(&skill_dir).expect("skill directory should be created");
        write_file(
            &skill_dir.join("SKILL.md"),
            r#"---
name: planning-skill
description: Helps plan work
category: workflow
---
"#,
        );

        let result = scan_skills(ScanOptions {
            agent_ids: Some(vec!["generic".to_string()]),
            custom_paths: vec![root.to_string_lossy().to_string()],
        });

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert!(result.warnings.is_empty());
        assert_eq!(result.skills.len(), 1);

        let skill = &result.skills[0];
        assert_eq!(skill.agent_id, "generic");
        assert_eq!(skill.name, "planning-skill");
        assert_eq!(skill.description.as_deref(), Some("Helps plan work"));
        assert_eq!(skill.install_path, skill_dir.to_string_lossy());
        assert_eq!(
            skill.metadata_path.as_deref(),
            Some(skill_dir.join("SKILL.md").to_string_lossy().as_ref())
        );
        assert!(matches!(skill.metadata_status, MetadataStatus::Found));
    }

    #[test]
    fn scan_skills_records_parse_warnings_and_keeps_scanning() {
        let root = temp_dir("generic-parse-warning");
        let good_skill = root.join("good-skill");
        let broken_skill = root.join("broken-skill");
        fs::create_dir_all(&good_skill).expect("good skill directory should be created");
        fs::create_dir_all(&broken_skill).expect("broken skill directory should be created");
        write_file(&good_skill.join("SKILL.md"), "# Good Skill\n");
        write_file(
            &broken_skill.join("SKILL.md"),
            "---
name: [broken
---
",
        );

        let result = scan_skills(ScanOptions {
            agent_ids: Some(vec!["generic".to_string()]),
            custom_paths: vec![root.to_string_lossy().to_string()],
        });

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(result.skills.len(), 1);
        assert_eq!(result.skills[0].name, "Good Skill");
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(result.warnings[0].agent_id, "generic");
        assert!(matches!(
            result.warnings[0].kind,
            ScanWarningKind::MetadataParseError
        ));
    }
}
