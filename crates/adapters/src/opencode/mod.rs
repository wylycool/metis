use crate::standard::{discover_standard_skill_dirs, parse_standard_skill_metadata};
use crate::traits::{
    AdapterError, AgentAdapter, DirectoryFormat, SkillMetadata, SkillScope, SkillSearchPath,
};

pub struct OpencodeAdapter;

impl OpencodeAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for OpencodeAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentAdapter for OpencodeAdapter {
    fn agent_id(&self) -> &str {
        "opencode"
    }

    fn agent_name(&self) -> &str {
        "opencode"
    }

    fn candidate_paths(&self) -> Vec<SkillSearchPath> {
        vec![SkillSearchPath {
            path_template: "$HOME/.config/opencode/skill".into(),
            scope: SkillScope::User,
            priority: 1,
            description: "opencode 用户级 skill 目录".into(),
        }]
    }

    fn is_agent_path(&self, path: &str) -> bool {
        path.contains(".config/opencode/skill")
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
            SkillScope::User => Some("$HOME/.config/opencode/skill/{name}".into()),
            _ => None,
        }
    }

    fn is_installed(&self) -> bool {
        dirs::home_dir()
            .map(|home| home.join(".config/opencode").exists())
            .unwrap_or(false)
    }
}
