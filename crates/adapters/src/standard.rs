use crate::traits::{AdapterError, MetadataSource, SkillCategory, SkillMetadata};
use serde::Deserialize;
use serde_yaml::Value;
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::Path;

pub fn discover_standard_skill_dirs(search_root: &str) -> Result<Vec<String>, AdapterError> {
    let root = Path::new(search_root);
    if !root.exists() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(root).map_err(|err| readable_error(search_root, err))?;
    let mut skill_dirs = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|err| readable_error(search_root, err))?;
        let file_type = entry
            .file_type()
            .map_err(|err| readable_error(search_root, err))?;

        if !file_type.is_dir() {
            continue;
        }

        let skill_md = entry.path().join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }

        skill_dirs.push(entry.file_name().to_string_lossy().to_string());
    }

    skill_dirs.sort();
    Ok(skill_dirs)
}

fn readable_error(path: &str, err: io::Error) -> AdapterError {
    AdapterError::PathNotReadable {
        path: path.to_string(),
        reason: err.to_string(),
    }
}

pub fn parse_standard_skill_metadata(skill_dir: &str) -> Result<SkillMetadata, AdapterError> {
    let skill_path = Path::new(skill_dir);
    if !skill_path.exists() {
        return Err(AdapterError::PathNotFound {
            path: skill_dir.to_string(),
        });
    }

    let metadata_path = skill_path.join("SKILL.md");
    if !metadata_path.is_file() {
        return Err(AdapterError::InvalidFormat {
            path: skill_dir.to_string(),
            detail: "missing SKILL.md".into(),
        });
    }

    let contents =
        fs::read_to_string(&metadata_path).map_err(|err| AdapterError::PathNotReadable {
            path: metadata_path.to_string_lossy().to_string(),
            reason: err.to_string(),
        })?;

    let directory_name = skill_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| skill_dir.to_string());

    match split_front_matter(&contents, &metadata_path.to_string_lossy())? {
        Some((front_matter, body)) => parse_front_matter_metadata(
            &front_matter,
            body,
            &directory_name,
            &metadata_path.to_string_lossy(),
        ),
        None => Ok(metadata_from_markdown_body(&contents, &directory_name)),
    }
}

#[derive(Debug, Deserialize)]
struct FrontMatter {
    name: Option<Value>,
    description: Option<Value>,
    version: Option<Value>,
    author: Option<Value>,
    license: Option<Value>,
    tags: Option<Value>,
    dependencies: Option<Value>,
    entry_point: Option<Value>,
    category: Option<Value>,
}

fn split_front_matter<'a>(
    contents: &'a str,
    path: &str,
) -> Result<Option<(String, &'a str)>, AdapterError> {
    let mut line_start = 0;
    let mut front_matter_start = None;

    for (line_index, line) in contents.split_inclusive('\n').enumerate() {
        let line_end = line_start + line.len();
        let trimmed = line.trim_end_matches(['\r', '\n']);

        if line_index == 0 {
            if trimmed != "---" {
                return Ok(None);
            }
            front_matter_start = Some(line_end);
        } else if trimmed == "---" {
            let start = front_matter_start.expect("front matter start should exist");
            let yaml = contents[start..line_start].to_string();
            let body = &contents[line_end..];
            return Ok(Some((yaml, body)));
        }

        line_start = line_end;
    }

    Err(AdapterError::ParseError {
        path: path.to_string(),
        detail: "front matter missing closing delimiter".into(),
    })
}

fn parse_front_matter_metadata(
    front_matter: &str,
    body: &str,
    directory_name: &str,
    path: &str,
) -> Result<SkillMetadata, AdapterError> {
    let raw = serde_yaml::from_str::<FrontMatter>(front_matter).map_err(|err| {
        AdapterError::ParseError {
            path: path.to_string(),
            detail: err.to_string(),
        }
    })?;

    let name = string_value(raw.name.as_ref())
        .or_else(|| markdown_h1(body))
        .unwrap_or_else(|| directory_name.to_string());
    let metadata_source =
        if string_value(raw.name.as_ref()).is_some() || markdown_h1(body).is_some() {
            MetadataSource::SkillMd
        } else {
            MetadataSource::DirectoryName
        };

    Ok(SkillMetadata {
        name,
        description: string_value(raw.description.as_ref()),
        version: string_value(raw.version.as_ref()),
        author: string_value(raw.author.as_ref()),
        license: string_value(raw.license.as_ref()),
        tags: string_list(raw.tags.as_ref()),
        dependencies: string_list(raw.dependencies.as_ref()),
        entry_point: string_value(raw.entry_point.as_ref()),
        category: raw.category.as_ref().and_then(category_value),
        metadata_source,
        extra: HashMap::new(),
    })
}

fn metadata_from_markdown_body(contents: &str, directory_name: &str) -> SkillMetadata {
    let heading = markdown_h1(contents);
    SkillMetadata {
        name: heading
            .clone()
            .unwrap_or_else(|| directory_name.to_string()),
        description: None,
        version: None,
        author: None,
        license: None,
        tags: vec![],
        dependencies: vec![],
        entry_point: None,
        category: None,
        metadata_source: if heading.is_some() {
            MetadataSource::SkillMd
        } else {
            MetadataSource::DirectoryName
        },
        extra: HashMap::new(),
    }
}

fn markdown_h1(contents: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let trimmed = line.trim();
        trimmed
            .strip_prefix("# ")
            .map(str::trim)
            .filter(|heading| !heading.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn string_value(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => non_empty(text),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Sequence(items)) => items
            .iter()
            .filter_map(|item| string_value(Some(item)))
            .collect(),
        Some(Value::String(text)) => non_empty(text).into_iter().collect(),
        _ => vec![],
    }
}

fn category_value(value: &Value) -> Option<SkillCategory> {
    let value = string_value(Some(value))?.to_ascii_lowercase();
    match value.as_str() {
        "workflow" => Some(SkillCategory::Workflow),
        "knowledge" => Some(SkillCategory::Knowledge),
        "script" => Some(SkillCategory::Script),
        "resource" => Some(SkillCategory::Resource),
        "tool" => Some(SkillCategory::Tool),
        "other" => Some(SkillCategory::Other),
        _ => None,
    }
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}
