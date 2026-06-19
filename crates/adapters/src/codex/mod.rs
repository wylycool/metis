use crate::standard::{discover_standard_skill_dirs, parse_standard_skill_metadata};
use crate::traits::{
    AdapterError, AgentAdapter, DirectoryFormat, SkillMetadata, SkillScope, SkillSearchPath,
};

pub struct CodexAdapter;

impl CodexAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CodexAdapter {
    fn default() -> Self {
        Self::new()
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
            SkillScope::User => Some("$HOME/.codex/skills/{name}".into()),
            _ => None,
        }
    }

    fn is_installed(&self) -> bool {
        let home = dirs::home_dir().unwrap_or_default();
        home.join(".codex").exists()
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
        std::env::temp_dir().join(format!("metis-adapters-{}-{}", name, suffix))
    }

    fn write_file(path: &Path, contents: &str) {
        fs::write(path, contents).expect("test file should be writable");
    }

    #[test]
    fn discovers_first_level_skill_directories_with_skill_md() {
        let root = temp_dir("codex-discovery");
        let skill_a = root.join("alpha-skill");
        let skill_b = root.join("beta-skill");
        let ignored = root.join("notes");
        let nested_skill = ignored.join("nested-skill");

        fs::create_dir_all(&skill_a).expect("skill_a directory should be created");
        fs::create_dir_all(&skill_b).expect("skill_b directory should be created");
        fs::create_dir_all(&nested_skill).expect("nested skill directory should be created");
        write_file(&skill_a.join("SKILL.md"), "# Alpha\n");
        write_file(&skill_b.join("SKILL.md"), "# Beta\n");
        write_file(&nested_skill.join("SKILL.md"), "# Nested\n");

        let adapter = CodexAdapter::new();
        let discovered = adapter
            .discover_skill_dirs(root.to_str().expect("temp path should be utf-8"))
            .expect("discovery should succeed");

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(
            discovered,
            vec!["alpha-skill".to_string(), "beta-skill".to_string()]
        );
    }

    #[test]
    fn parses_skill_md_yaml_front_matter_metadata() {
        let root = temp_dir("codex-metadata-front-matter");
        let skill_dir = root.join("metadata-skill");
        fs::create_dir_all(&skill_dir).expect("skill directory should be created");
        write_file(
            &skill_dir.join("SKILL.md"),
            r#"---
name: metadata-skill
description: Parses complete metadata
version: 1.2.3
author: Metis Team
license: MIT
tags:
  - rust
  - adapter
dependencies:
  - helper-skill
entry_point: run.md
category: tool
---

# Body title
"#,
        );

        let adapter = CodexAdapter::new();
        let metadata = adapter
            .parse_metadata(skill_dir.to_str().expect("skill path should be utf-8"))
            .expect("metadata should parse");

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(metadata.name, "metadata-skill");
        assert_eq!(
            metadata.description.as_deref(),
            Some("Parses complete metadata")
        );
        assert_eq!(metadata.version.as_deref(), Some("1.2.3"));
        assert_eq!(metadata.author.as_deref(), Some("Metis Team"));
        assert_eq!(metadata.license.as_deref(), Some("MIT"));
        assert_eq!(
            metadata.tags,
            vec!["rust".to_string(), "adapter".to_string()]
        );
        assert_eq!(metadata.dependencies, vec!["helper-skill".to_string()]);
        assert_eq!(metadata.entry_point.as_deref(), Some("run.md"));
        assert!(matches!(
            metadata.category,
            Some(crate::traits::SkillCategory::Tool)
        ));
        assert!(matches!(
            metadata.metadata_source,
            crate::traits::MetadataSource::SkillMd
        ));
    }

    #[test]
    fn uses_markdown_h1_when_front_matter_is_missing() {
        let root = temp_dir("codex-metadata-h1");
        let skill_dir = root.join("directory-name");
        fs::create_dir_all(&skill_dir).expect("skill directory should be created");
        write_file(
            &skill_dir.join("SKILL.md"),
            "# Markdown Skill\n\nBody text\n",
        );

        let adapter = CodexAdapter::new();
        let metadata = adapter
            .parse_metadata(skill_dir.to_str().expect("skill path should be utf-8"))
            .expect("metadata should parse");

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(metadata.name, "Markdown Skill");
        assert!(matches!(
            metadata.metadata_source,
            crate::traits::MetadataSource::SkillMd
        ));
    }

    #[test]
    fn uses_directory_name_when_skill_md_has_no_name_or_heading() {
        let root = temp_dir("codex-metadata-directory");
        let skill_dir = root.join("fallback-skill");
        fs::create_dir_all(&skill_dir).expect("skill directory should be created");
        write_file(&skill_dir.join("SKILL.md"), "Body text without heading\n");

        let adapter = CodexAdapter::new();
        let metadata = adapter
            .parse_metadata(skill_dir.to_str().expect("skill path should be utf-8"))
            .expect("metadata should parse");

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(metadata.name, "fallback-skill");
        assert!(matches!(
            metadata.metadata_source,
            crate::traits::MetadataSource::DirectoryName
        ));
    }

    #[test]
    fn returns_parse_error_for_invalid_yaml_front_matter() {
        let root = temp_dir("codex-metadata-invalid-yaml");
        let skill_dir = root.join("broken-skill");
        fs::create_dir_all(&skill_dir).expect("skill directory should be created");
        write_file(
            &skill_dir.join("SKILL.md"),
            "---
name: [broken
---
",
        );

        let adapter = CodexAdapter::new();
        let result =
            adapter.parse_metadata(skill_dir.to_str().expect("skill path should be utf-8"));

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert!(matches!(result, Err(AdapterError::ParseError { .. })));
    }
}
