use crate::traits::{
    AdapterError, AgentAdapter, DirectoryFormat, SkillMetadata, SkillScope, SkillSearchPath,
};

/// 通用适配器：处理遵循 Agent Skills 标准目录规范的 skill
pub struct GenericAgentSkillsAdapter {
    custom_paths: Vec<String>,
}

impl GenericAgentSkillsAdapter {
    pub fn new(custom_paths: Vec<String>) -> Self {
        Self { custom_paths }
    }
}

impl AgentAdapter for GenericAgentSkillsAdapter {
    fn agent_id(&self) -> &str {
        "generic"
    }
    fn agent_name(&self) -> &str {
        "Generic Agent Skills"
    }

    fn candidate_paths(&self) -> Vec<SkillSearchPath> {
        let mut paths = vec![SkillSearchPath {
            path_template: "$HOME/.agent-skills".into(),
            scope: SkillScope::User,
            priority: 1,
            description: "通用 Agent Skills 目录".into(),
        }];
        for (i, p) in self.custom_paths.iter().enumerate() {
            paths.push(SkillSearchPath {
                path_template: p.clone(),
                scope: SkillScope::User,
                priority: 10 + i as u32,
                description: format!("自定义路径: {}", p),
            });
        }
        paths
    }

    fn is_agent_path(&self, path: &str) -> bool {
        path.contains(".agent-skills") || self.custom_paths.iter().any(|p| path.contains(p))
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
            SkillScope::User => Some("$HOME/.agent-skills/{name}".into()),
            _ => None,
        }
    }

    fn is_installed(&self) -> bool {
        dirs::home_dir()
            .map(|h| h.join(".agent-skills").exists())
            .unwrap_or(false)
    }
}
