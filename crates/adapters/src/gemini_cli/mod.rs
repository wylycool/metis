use crate::standard::{discover_standard_skill_dirs, parse_standard_skill_metadata};
use crate::traits::{
    AdapterError, AgentAdapter, DirectoryFormat, SkillMetadata, SkillScope, SkillSearchPath,
};

pub struct GeminiCliAdapter;

impl GeminiCliAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GeminiCliAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentAdapter for GeminiCliAdapter {
    fn agent_id(&self) -> &str {
        "gemini-cli"
    }

    fn agent_name(&self) -> &str {
        "Gemini CLI"
    }

    fn candidate_paths(&self) -> Vec<SkillSearchPath> {
        vec![SkillSearchPath {
            path_template: "$HOME/.gemini/skills".into(),
            scope: SkillScope::User,
            priority: 1,
            description: "Gemini CLI 用户级 skills 目录".into(),
        }]
    }

    fn is_agent_path(&self, path: &str) -> bool {
        path.contains(".gemini/skills")
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
            SkillScope::User => Some("$HOME/.gemini/skills/{name}".into()),
            _ => None,
        }
    }

    fn is_installed(&self) -> bool {
        dirs::home_dir()
            .map(|home| home.join(".gemini").exists())
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_gemini_cli_user_skill_path_contract() {
        let adapter = GeminiCliAdapter::new();

        assert_eq!(adapter.agent_id(), "gemini-cli");
        assert_eq!(adapter.agent_name(), "Gemini CLI");
        assert_eq!(
            adapter.candidate_paths()[0].path_template,
            "$HOME/.gemini/skills"
        );
        assert_eq!(
            adapter.install_path_template(SkillScope::User).as_deref(),
            Some("$HOME/.gemini/skills/{name}")
        );
    }
}
