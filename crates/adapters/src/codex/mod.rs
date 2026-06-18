use crate::traits::{
    AdapterError, AgentAdapter, DirectoryFormat, SkillMetadata, SkillScope, SkillSearchPath,
};

pub struct CodexAdapter;

impl CodexAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl AgentAdapter for CodexAdapter {
    fn agent_id(&self) -> &str {
        "codex"
    }
    fn agent_name(&self) -> &str {
        "Codex"
    }

    fn candidate_paths(&self) -> Vec<SkillSearchPath> {
        vec![
            SkillSearchPath {
                path_template: "$HOME/.codex/skills".into(),
                scope: SkillScope::User,
                priority: 1,
                description: "Codex 用户级 skills".into(),
            },
            SkillSearchPath {
                path_template: "$HOME/.config/codex/skills".into(),
                scope: SkillScope::User,
                priority: 2,
                description: "Codex 配置目录 skills".into(),
            },
        ]
    }

    fn is_agent_path(&self, path: &str) -> bool {
        path.contains(".codex/skills") || path.contains(".config/codex/skills")
    }

    fn discover_skill_dirs(&self, _search_root: &str) -> Result<Vec<String>, AdapterError> {
        // TODO: Phase 1 — 实现目录扫描
        Ok(vec![])
    }

    fn parse_metadata(&self, _skill_dir: &str) -> Result<SkillMetadata, AdapterError> {
        // TODO: Phase 1 — 实现 SKILL.md 解析
        Err(AdapterError::Internal("not implemented".into()))
    }

    fn directory_format(&self) -> DirectoryFormat {
        DirectoryFormat::Standard
    }

    fn resolve_scope(&self, _skill_dir: &str, _search_root: &str) -> SkillScope {
        SkillScope::User
    }

    fn install_path_template(&self, scope: SkillScope) -> Option<String> {
        match scope {
            SkillScope::User => Some("$HOME/.codex/skills/{name}".into()),
            _ => None,
        }
    }

    fn is_installed(&self) -> bool {
        let home = dirs::home_dir().unwrap_or_default();
        home.join(".codex").exists()
    }
}
