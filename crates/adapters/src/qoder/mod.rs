use crate::standard::{discover_standard_skill_dirs, parse_standard_skill_metadata};
use crate::traits::{
    AdapterError, AgentAdapter, DirectoryFormat, SkillMetadata, SkillScope, SkillSearchPath,
};

pub struct QoderAdapter;

impl QoderAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for QoderAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentAdapter for QoderAdapter {
    fn agent_id(&self) -> &str {
        "qoder"
    }

    fn agent_name(&self) -> &str {
        "Qoder"
    }

    fn candidate_paths(&self) -> Vec<SkillSearchPath> {
        vec![SkillSearchPath {
            path_template: "$HOME/.qoder/skills".into(),
            scope: SkillScope::User,
            priority: 1,
            description: "Qoder CLI 用户级 skills 目录".into(),
        }]
    }

    fn is_agent_path(&self, path: &str) -> bool {
        path.contains(".qoder/skills")
    }

    fn discover_skill_dirs(&self, search_root: &str) -> Result<Vec<String>, AdapterError> {
        discover_standard_skill_dirs(search_root)
    }

    fn parse_metadata(&self, skill_dir: &str) -> Result<SkillMetadata, AdapterError> {
        parse_standard_skill_metadata(skill_dir)
    }

    fn directory_format(&self) -> DirectoryFormat {
        DirectoryFormat::Standard
    }

    fn resolve_scope(&self, _skill_dir: &str, _search_root: &str) -> SkillScope {
        SkillScope::User
    }

    fn install_path_template(&self, scope: SkillScope) -> Option<String> {
        match scope {
            SkillScope::User => Some("$HOME/.qoder/skills/{name}".into()),
            _ => None,
        }
    }

    fn is_installed(&self) -> bool {
        dirs::home_dir()
            .map(|home| home.join(".qoder").exists())
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_qoder_user_skill_path_contract() {
        let adapter = QoderAdapter::new();

        assert_eq!(adapter.agent_id(), "qoder");
        assert_eq!(adapter.agent_name(), "Qoder");
        assert_eq!(
            adapter.candidate_paths()[0].path_template,
            "$HOME/.qoder/skills"
        );
        assert_eq!(
            adapter.install_path_template(SkillScope::User).as_deref(),
            Some("$HOME/.qoder/skills/{name}")
        );
    }
}
