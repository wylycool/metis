use chrono::{DateTime, Utc};
use metis_adapters::claude_code::ClaudeCodeAdapter;
use metis_adapters::codex::CodexAdapter;
use metis_adapters::generic::GenericAgentSkillsAdapter;
use metis_adapters::hermes::HermesAdapter;
use metis_adapters::openclaw::OpenClawAdapter;
use metis_adapters::opencode::OpencodeAdapter;
use metis_adapters::standard::{discover_standard_skill_dirs, parse_standard_skill_metadata};
use metis_adapters::traits::SkillCategory;
use metis_adapters::{AdapterError, AdapterRegistry, AgentAdapter, SkillScope};
use metis_storage::db::{SkillIndexStore, SkillRecord, StorageError};
use metis_storage::manifest::compute_local_updated_at;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default)]
pub struct ListAgentsOptions {
    pub enabled_agent_ids: Option<Vec<String>>,
    pub custom_paths: Vec<String>,
    pub agent_path_overrides: Vec<AgentPathOverride>,
    pub custom_monitored_paths: Vec<CustomMonitoredPath>,
}

#[derive(Debug, Clone, Default)]
pub struct ScanOptions {
    pub agent_ids: Option<Vec<String>>,
    pub custom_paths: Vec<String>,
    pub agent_path_overrides: Vec<AgentPathOverride>,
    pub custom_monitored_paths: Vec<CustomMonitoredPath>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentPathOverride {
    pub agent_id: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomMonitoredPath {
    pub id: String,
    pub name: String,
    pub path: String,
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
    pub version: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub tags: Vec<String>,
    pub category: Option<String>,
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

#[derive(Debug, thiserror::Error)]
pub enum DiscoveryStorageError {
    #[error("storage error: {0}")]
    Storage(#[from] StorageError),
}

pub fn list_agents(options: ListAgentsOptions) -> Vec<AgentStatus> {
    let registry = build_registry(options.custom_paths);
    let mut agents = registry
        .all()
        .iter()
        .filter(|adapter| {
            options
                .enabled_agent_ids
                .as_ref()
                .map(|ids| ids.iter().any(|id| id == adapter.agent_id()))
                .unwrap_or(true)
        })
        .map(|adapter| {
            let paths = effective_candidate_paths(adapter.as_ref(), &options.agent_path_overrides)
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
                enabled: true,
                paths,
            }
        })
        .collect::<Vec<_>>();

    agents.extend(custom_monitored_agent_statuses(
        &options.custom_monitored_paths,
        options.enabled_agent_ids.as_deref(),
    ));
    agents
}

pub fn scan_skills(options: ScanOptions) -> ScanResult {
    let registry = build_registry(options.custom_paths.clone());
    let adapters = selected_adapters(&registry, options.agent_ids.as_deref());
    let mut skills = Vec::new();
    let mut warnings = Vec::new();

    for adapter in adapters {
        for search_path in effective_candidate_paths(adapter, &options.agent_path_overrides) {
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
                    Ok(metadata) => {
                        let agent_id = adapter.agent_id().to_string();
                        skills.push(Skill {
                            id: stable_skill_id(&agent_id, &skill_path_display),
                            agent_id,
                            name: metadata.name,
                            description: metadata.description,
                            version: metadata.version,
                            author: metadata.author,
                            license: metadata.license,
                            tags: metadata.tags,
                            category: metadata.category.as_ref().map(skill_category_to_storage),
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
                        })
                    }
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
    scan_custom_monitored_paths(&options, &mut skills, &mut warnings);

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

pub fn scan_and_index_skills(
    options: ScanOptions,
    store: &SkillIndexStore,
) -> Result<ScanResult, DiscoveryStorageError> {
    let scanned_roots = scanned_roots_for_options(&options);
    let result = scan_skills(options);

    for skill in &result.skills {
        store.upsert_skill(&skill_to_record(skill))?;
    }
    cleanup_stale_indexed_skills(store, &result, &scanned_roots)?;

    Ok(result)
}

fn cleanup_stale_indexed_skills(
    store: &SkillIndexStore,
    result: &ScanResult,
    scanned_roots: &[(String, PathBuf)],
) -> Result<(), DiscoveryStorageError> {
    if scanned_roots.is_empty() {
        return Ok(());
    }

    let seen_ids = result
        .skills
        .iter()
        .map(|skill| skill.id.as_str())
        .collect::<HashSet<_>>();
    for existing in store.list_skills()? {
        if seen_ids.contains(existing.id.as_str()) {
            continue;
        }
        let install_path = Path::new(&existing.install_path);
        let was_in_scanned_root = scanned_roots.iter().any(|(agent_id, root)| {
            existing.agent_id == *agent_id && install_path.starts_with(root)
        });
        if was_in_scanned_root {
            store.delete_skill(&existing.id)?;
        }
    }

    Ok(())
}

fn scanned_roots_for_options(options: &ScanOptions) -> Vec<(String, PathBuf)> {
    let registry = build_registry(options.custom_paths.clone());
    let mut roots = selected_adapters(&registry, options.agent_ids.as_deref())
        .into_iter()
        .flat_map(|adapter| {
            effective_candidate_paths(adapter, &options.agent_path_overrides)
                .into_iter()
                .map(move |search_path| (adapter.agent_id().to_string(), search_path))
        })
        .map(|(agent_id, search_path)| (agent_id, expand_path_template(&search_path.path_template)))
        .filter(|(_, root)| is_readable_dir(root))
        .collect::<Vec<_>>();
    roots.extend(
        options
            .custom_monitored_paths
            .iter()
            .filter(|path| {
                options
                    .agent_ids
                    .as_ref()
                    .map(|ids| ids.iter().any(|id| id == &custom_agent_id(&path.id)))
                    .unwrap_or(true)
            })
            .map(|path| (custom_agent_id(&path.id), expand_path_template(&path.path)))
            .filter(|(_, root)| is_readable_dir(root)),
    );
    roots
}

fn build_registry(custom_paths: Vec<String>) -> AdapterRegistry {
    let mut registry = AdapterRegistry::new();
    registry.register(Box::new(CodexAdapter::new()));
    registry.register(Box::new(ClaudeCodeAdapter::new()));
    registry.register(Box::new(OpenClawAdapter::new()));
    registry.register(Box::new(HermesAdapter::new()));
    registry.register(Box::new(OpencodeAdapter::new()));
    if !custom_paths.is_empty() {
        registry.register(Box::new(GenericAgentSkillsAdapter::new(custom_paths)));
    }
    registry
}

fn effective_candidate_paths(
    adapter: &dyn AgentAdapter,
    overrides: &[AgentPathOverride],
) -> Vec<metis_adapters::SkillSearchPath> {
    let override_path = overrides
        .iter()
        .find(|override_path| override_path.agent_id == adapter.agent_id())
        .map(|override_path| override_path.path.trim())
        .filter(|path| !path.is_empty());
    match override_path {
        Some(path) => vec![metis_adapters::SkillSearchPath {
            path_template: path.to_string(),
            scope: SkillScope::User,
            priority: 0,
            description: format!("{} 用户自定义 skills", adapter.agent_name()),
        }],
        None => adapter.candidate_paths(),
    }
}

fn custom_monitored_agent_statuses(
    custom_paths: &[CustomMonitoredPath],
    enabled_agent_ids: Option<&[String]>,
) -> Vec<AgentStatus> {
    custom_paths
        .iter()
        .filter(|custom_path| {
            !custom_path.name.trim().is_empty() && !custom_path.path.trim().is_empty()
        })
        .filter(|custom_path| {
            enabled_agent_ids
                .map(|ids| ids.iter().any(|id| id == &custom_agent_id(&custom_path.id)))
                .unwrap_or(true)
        })
        .map(|custom_path| {
            let expanded = expand_path_template(custom_path.path.trim());
            AgentStatus {
                agent_id: custom_agent_id(&custom_path.id),
                agent_name: custom_path.name.trim().to_string(),
                enabled: true,
                paths: vec![AgentPath {
                    path: expanded.to_string_lossy().to_string(),
                    scope: PathScope::User,
                    exists: expanded.exists(),
                    readable: is_readable_dir(&expanded),
                    writable: is_writable_dir(&expanded),
                }],
            }
        })
        .collect()
}

fn scan_custom_monitored_paths(
    options: &ScanOptions,
    skills: &mut Vec<Skill>,
    warnings: &mut Vec<ScanWarning>,
) {
    for custom_path in &options.custom_monitored_paths {
        let agent_id = custom_agent_id(&custom_path.id);
        if options
            .agent_ids
            .as_ref()
            .map(|ids| !ids.iter().any(|id| id == &agent_id))
            .unwrap_or(false)
        {
            continue;
        }
        if custom_path.name.trim().is_empty() || custom_path.path.trim().is_empty() {
            continue;
        }
        let root = expand_path_template(custom_path.path.trim());
        let root_display = root.to_string_lossy().to_string();
        let discovered = match discover_standard_skill_dirs(&root_display) {
            Ok(discovered) => discovered,
            Err(error) => {
                warnings.push(ScanWarning {
                    agent_id: agent_id.clone(),
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
            match parse_standard_skill_metadata(&skill_path_display) {
                Ok(metadata) => skills.push(Skill {
                    id: stable_skill_id(&agent_id, &skill_path_display),
                    agent_id: agent_id.clone(),
                    name: metadata.name,
                    description: metadata.description,
                    version: metadata.version,
                    author: metadata.author,
                    license: metadata.license,
                    tags: metadata.tags,
                    category: metadata.category.as_ref().map(skill_category_to_storage),
                    install_path: skill_path_display.clone(),
                    scope: PathScope::User,
                    metadata_path: Some(skill_path.join("SKILL.md").to_string_lossy().to_string()),
                    metadata_status: MetadataStatus::Found,
                    source_id: None,
                    local_fingerprint: None,
                    local_modified: None,
                    last_scanned_at: Utc::now(),
                }),
                Err(error) => warnings.push(ScanWarning {
                    agent_id: agent_id.clone(),
                    path: root_display.clone(),
                    skill_path: Some(skill_path_display),
                    kind: warning_kind_for_error(&error),
                    message: error.to_string(),
                }),
            }
        }
    }
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

fn skill_to_record(skill: &Skill) -> SkillRecord {
    SkillRecord {
        id: skill.id.clone(),
        agent_id: skill.agent_id.clone(),
        name: skill.name.clone(),
        description: skill.description.clone(),
        version: skill.version.clone(),
        author: skill.author.clone(),
        license: skill.license.clone(),
        tags: skill.tags.clone(),
        category: skill.category.clone(),
        install_path: skill.install_path.clone(),
        scope: path_scope_to_storage(&skill.scope),
        metadata_path: skill.metadata_path.clone(),
        metadata_status: metadata_status_to_storage(&skill.metadata_status),
        metadata_error: metadata_error(&skill.metadata_status),
        source_id: skill.source_id.clone(),
        local_fingerprint: skill.local_fingerprint.clone(),
        local_modified: skill.local_modified,
        last_scanned_at: skill.last_scanned_at.to_rfc3339(),
        local_updated_at: compute_local_updated_at(&skill.install_path).ok().flatten(),
    }
}

fn skill_category_to_storage(category: &SkillCategory) -> String {
    match category {
        SkillCategory::Workflow => "workflow",
        SkillCategory::Knowledge => "knowledge",
        SkillCategory::Script => "script",
        SkillCategory::Resource => "resource",
        SkillCategory::Tool => "tool",
        SkillCategory::Other => "other",
    }
    .to_string()
}

fn stable_skill_id(agent_id: &str, install_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(agent_id.as_bytes());
    hasher.update([0]);
    hasher.update(install_path.as_bytes());
    let digest = hasher.finalize();
    let hex = digest
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    format!("skill_{}", hex)
}

fn path_scope_to_storage(scope: &PathScope) -> String {
    match scope {
        PathScope::User => "user",
        PathScope::Project => "project",
        PathScope::System => "system",
    }
    .to_string()
}

fn metadata_status_to_storage(status: &MetadataStatus) -> String {
    match status {
        MetadataStatus::Found => "found",
        MetadataStatus::Missing => "missing",
        MetadataStatus::ParseError { .. } => "parse_error",
    }
    .to_string()
}

fn metadata_error(status: &MetadataStatus) -> Option<String> {
    match status {
        MetadataStatus::ParseError { reason } => Some(reason.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use metis_storage::db::{SkillIndexStore, SourceRecord};
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

    fn sample_source(id: &str) -> SourceRecord {
        SourceRecord {
            id: id.to_string(),
            source_type: "git".to_string(),
            url: "https://github.com/example/metis-skills.git".to_string(),
            repo_path: "skills/indexed-skill".to_string(),
            ref_: "main".to_string(),
            current_commit: Some("abc123".to_string()),
            remote_commit: Some("def456".to_string()),
            last_checked_at: Some("2026-06-19T12:00:00Z".to_string()),
            trusted: true,
            auto_update: false,
            credential_ref: None,
            created_at: None,
            updated_at: None,
        }
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
            vec!["codex", "claude-code", "openclaw", "hermes", "opencode"]
        );
    }

    #[test]
    fn list_agents_uses_builtin_agent_path_overrides_and_named_custom_monitors() {
        let codex_root = temp_dir("codex-override-root");
        let team_root = temp_dir("team-monitor-root");
        fs::create_dir_all(&codex_root).expect("codex override root should be created");
        fs::create_dir_all(&team_root).expect("custom monitor root should be created");

        let result = list_agents(ListAgentsOptions {
            enabled_agent_ids: None,
            custom_paths: vec![],
            agent_path_overrides: vec![AgentPathOverride {
                agent_id: "codex".to_string(),
                path: codex_root.to_string_lossy().to_string(),
            }],
            custom_monitored_paths: vec![CustomMonitoredPath {
                id: "team-memory".to_string(),
                name: "团队记忆".to_string(),
                path: team_root.to_string_lossy().to_string(),
            }],
        });

        fs::remove_dir_all(&codex_root).expect("codex override root should be removed");
        fs::remove_dir_all(&team_root).expect("custom monitor root should be removed");

        let codex = result
            .iter()
            .find(|agent| agent.agent_id == "codex")
            .expect("codex agent should exist");
        assert_eq!(codex.paths.len(), 1);
        assert_eq!(codex.paths[0].path, codex_root.to_string_lossy());

        let custom = result
            .iter()
            .find(|agent| agent.agent_id == "custom-team-memory")
            .expect("named custom monitor should exist");
        assert_eq!(custom.agent_name, "团队记忆");
        assert_eq!(custom.paths[0].path, team_root.to_string_lossy());
    }

    #[test]
    fn scan_skills_uses_builtin_agent_path_overrides_and_named_custom_monitors() {
        let workspace = temp_dir("scan-agent-path-overrides");
        let codex_root = workspace.join("codex-skills");
        let custom_root = workspace.join("team-skills");
        let codex_skill = codex_root.join("planner");
        let custom_skill = custom_root.join("memory");
        fs::create_dir_all(&codex_skill).expect("codex skill directory should be created");
        fs::create_dir_all(&custom_skill).expect("custom skill directory should be created");
        write_file(&codex_skill.join("SKILL.md"), "# Planner\n");
        write_file(&custom_skill.join("SKILL.md"), "# Team Memory\n");

        let result = scan_skills(ScanOptions {
            agent_ids: None,
            custom_paths: vec![],
            agent_path_overrides: vec![AgentPathOverride {
                agent_id: "codex".to_string(),
                path: codex_root.to_string_lossy().to_string(),
            }],
            custom_monitored_paths: vec![CustomMonitoredPath {
                id: "team-memory".to_string(),
                name: "团队记忆".to_string(),
                path: custom_root.to_string_lossy().to_string(),
            }],
        });

        fs::remove_dir_all(&workspace).expect("workspace should be removed");

        assert!(result.warnings.is_empty());
        assert!(result
            .skills
            .iter()
            .any(|skill| skill.agent_id == "codex" && skill.name == "Planner"));
        assert!(result
            .skills
            .iter()
            .any(|skill| skill.agent_id == "custom-team-memory" && skill.name == "Team Memory"));
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
            ..Default::default()
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
            ..Default::default()
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

    #[test]
    fn scan_and_index_skills_persists_successful_scan_results() {
        let root = temp_dir("generic-index");
        let skill_dir = root.join("indexed-skill");
        fs::create_dir_all(&skill_dir).expect("skill directory should be created");
        write_file(
            &skill_dir.join("SKILL.md"),
            r#"---
name: indexed-skill
description: Stored in SQLite
---
"#,
        );
        let store = SkillIndexStore::open_in_memory().expect("store should open");

        let result = scan_and_index_skills(
            ScanOptions {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![root.to_string_lossy().to_string()],
                ..Default::default()
            },
            &store,
        )
        .expect("scan and index should succeed");

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert!(result.warnings.is_empty());
        assert_eq!(result.skills.len(), 1);

        let stored = store.list_skills().expect("skills should list");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].agent_id, "generic");
        assert_eq!(stored[0].name, "indexed-skill");
        assert_eq!(stored[0].description.as_deref(), Some("Stored in SQLite"));
        assert_eq!(stored[0].install_path, skill_dir.to_string_lossy());
        assert_eq!(stored[0].id, result.skills[0].id);
    }

    #[test]
    fn scan_and_index_skills_persists_skill_metadata_fields() {
        let root = temp_dir("generic-index-metadata");
        let skill_dir = root.join("metadata-skill");
        fs::create_dir_all(&skill_dir).expect("skill directory should be created");
        write_file(
            &skill_dir.join("SKILL.md"),
            r#"---
name: metadata-skill
description: Carries full metadata
version: 1.2.3
author: Metis Team
license: MIT
tags:
  - workflow
  - local
category: tool
---
"#,
        );
        let store = SkillIndexStore::open_in_memory().expect("store should open");

        scan_and_index_skills(
            ScanOptions {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![root.to_string_lossy().to_string()],
                ..Default::default()
            },
            &store,
        )
        .expect("scan and index should succeed");

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        let stored = store.list_skills().expect("skills should list");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].version.as_deref(), Some("1.2.3"));
        assert_eq!(stored[0].author.as_deref(), Some("Metis Team"));
        assert_eq!(stored[0].license.as_deref(), Some("MIT"));
        assert_eq!(
            stored[0].tags,
            vec!["workflow".to_string(), "local".to_string()]
        );
        assert_eq!(stored[0].category.as_deref(), Some("tool"));
    }

    #[test]
    fn scan_and_index_skills_updates_existing_record_on_repeat_scan() {
        let root = temp_dir("generic-index-update");
        let skill_dir = root.join("indexed-skill");
        fs::create_dir_all(&skill_dir).expect("skill directory should be created");
        let skill_md = skill_dir.join("SKILL.md");
        write_file(
            &skill_md,
            r#"---
name: indexed-skill
description: First description
---
"#,
        );
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let options = ScanOptions {
            agent_ids: Some(vec!["generic".to_string()]),
            custom_paths: vec![root.to_string_lossy().to_string()],
            ..Default::default()
        };

        let first = scan_and_index_skills(options.clone(), &store)
            .expect("first scan and index should succeed");
        write_file(
            &skill_md,
            r#"---
name: indexed-skill
description: Updated description
---
"#,
        );
        let second =
            scan_and_index_skills(options, &store).expect("second scan and index should succeed");

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        let stored = store.list_skills().expect("skills should list");
        assert_eq!(stored.len(), 1);
        assert_eq!(
            stored[0].description.as_deref(),
            Some("Updated description")
        );
        assert_eq!(stored[0].id, first.skills[0].id);
        assert_eq!(stored[0].id, second.skills[0].id);
    }

    #[test]
    fn scan_and_index_skills_preserves_existing_source_and_local_state() {
        let root = temp_dir("generic-index-preserve-state");
        let skill_dir = root.join("indexed-skill");
        fs::create_dir_all(&skill_dir).expect("skill directory should be created");
        write_file(
            &skill_dir.join("SKILL.md"),
            r#"---
name: indexed-skill
description: First description
---
"#,
        );
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let options = ScanOptions {
            agent_ids: Some(vec!["generic".to_string()]),
            custom_paths: vec![root.to_string_lossy().to_string()],
            ..Default::default()
        };

        let first = scan_and_index_skills(options.clone(), &store)
            .expect("first scan and index should succeed");
        let skill_id = first.skills[0].id.clone();
        store
            .upsert_source(&sample_source("source-1"))
            .expect("source should upsert");
        store
            .bind_skill_source(&skill_id, "source-1")
            .expect("skill should bind source");
        store
            .update_skill_local_fingerprint(&skill_id, "sha256:baseline", false)
            .expect("baseline fingerprint should update");

        write_file(
            &skill_dir.join("SKILL.md"),
            r#"---
name: indexed-skill
description: Updated description
---
"#,
        );
        scan_and_index_skills(options, &store).expect("second scan and index should succeed");

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        let stored = store
            .get_skill(&skill_id)
            .expect("skill lookup should succeed")
            .expect("skill should still exist");
        assert_eq!(stored.description.as_deref(), Some("Updated description"));
        assert_eq!(stored.source_id.as_deref(), Some("source-1"));
        assert_eq!(stored.local_fingerprint.as_deref(), Some("sha256:baseline"));
        assert_eq!(stored.local_modified, Some(false));
    }

    #[test]
    fn scan_and_index_skills_removes_records_missing_from_scanned_root() {
        let root = temp_dir("generic-index-remove-stale");
        let kept_skill = root.join("kept-skill");
        let removed_skill = root.join("removed-skill");
        fs::create_dir_all(&kept_skill).expect("kept skill directory should be created");
        fs::create_dir_all(&removed_skill).expect("removed skill directory should be created");
        write_file(&kept_skill.join("SKILL.md"), "# Kept Skill\n");
        write_file(&removed_skill.join("SKILL.md"), "# Removed Skill\n");
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let options = ScanOptions {
            agent_ids: Some(vec!["generic".to_string()]),
            custom_paths: vec![root.to_string_lossy().to_string()],
            ..Default::default()
        };

        scan_and_index_skills(options.clone(), &store).expect("first scan should index");
        fs::remove_dir_all(&removed_skill).expect("removed skill directory should delete");
        scan_and_index_skills(options, &store).expect("second scan should remove stale record");

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        let stored = store.list_skills().expect("skills should list");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].name, "Kept Skill");
        assert_eq!(stored[0].install_path, kept_skill.to_string_lossy());
    }

    #[test]
    fn scan_and_index_skills_does_not_persist_parse_warning_entries() {
        let root = temp_dir("generic-index-warning");
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
        let store = SkillIndexStore::open_in_memory().expect("store should open");

        let result = scan_and_index_skills(
            ScanOptions {
                agent_ids: Some(vec!["generic".to_string()]),
                custom_paths: vec![root.to_string_lossy().to_string()],
                ..Default::default()
            },
            &store,
        )
        .expect("scan and index should succeed");

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(result.skills.len(), 1);
        assert_eq!(result.warnings.len(), 1);

        let stored = store.list_skills().expect("skills should list");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].name, "Good Skill");
    }
}
