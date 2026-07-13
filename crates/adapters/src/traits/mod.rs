use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Agent 适配器统一接口
pub trait AgentAdapter: Send + Sync {
    /// 适配器唯一标识，如 "codex"、"claude-code"
    fn agent_id(&self) -> &str;

    /// 人类可读的 Agent 名称
    fn agent_name(&self) -> &str;

    /// 该 Agent 的所有候选 skill 搜索路径，按优先级从高到低排列
    fn candidate_paths(&self) -> Vec<SkillSearchPath>;

    /// 判断给定路径是否属于此 Agent
    fn is_agent_path(&self, path: &str) -> bool;

    /// 在给定目录中扫描并发现 skill 目录列表，返回相对于 search_root 的路径
    fn discover_skill_dirs(&self, search_root: &str) -> Result<Vec<String>, AdapterError>;

    /// 解析单个 skill 目录的元数据
    fn parse_metadata(&self, skill_dir: &str) -> Result<SkillMetadata, AdapterError>;

    /// 该 Agent 的 skill 目录结构格式
    fn directory_format(&self) -> DirectoryFormat;

    /// 返回 skill 目录在 Agent 中的安装范围
    fn resolve_scope(&self, skill_dir: &str, search_root: &str) -> SkillScope;

    /// 安装 skill 的路径模板（用于导入 lock 文件时自动选择安装路径）
    fn install_path_template(&self, scope: SkillScope) -> Option<String>;

    /// 用户级 skill 安装根目录及当前本机可用状态
    fn user_skill_root(&self) -> Option<SkillInstallRoot> {
        let path_template = self.install_path_template(SkillScope::User)?;
        let root_template = install_root_template_from_skill_template(&path_template);
        let path = expand_path_template(&root_template, None).ok()?;
        let status = evaluate_install_root_status(Path::new(&path));

        Some(SkillInstallRoot {
            agent_id: self.agent_id().to_string(),
            agent_name: self.agent_name().to_string(),
            path_template: root_template,
            path,
            scope: SkillScope::User,
            exists: matches!(
                status,
                SkillInstallRootStatus::Available
                    | SkillInstallRootStatus::NotReadable
                    | SkillInstallRootStatus::NotWritable
            ),
            readable: matches!(
                status,
                SkillInstallRootStatus::Available | SkillInstallRootStatus::NotWritable
            ),
            writable: matches!(status, SkillInstallRootStatus::Available),
            status,
        })
    }

    /// Agent 是否已安装
    fn is_installed(&self) -> bool;

    /// 最低支持的 Agent 版本
    fn min_agent_version(&self) -> Option<&str> {
        None
    }

    /// Adapter 自身版本
    fn adapter_version(&self) -> &str {
        "0.1.0"
    }
}

// ---- 辅助数据结构 ----

/// 描述一个 Agent 的 skill 搜索路径
#[derive(Debug, Clone)]
pub struct SkillSearchPath {
    pub path_template: String,
    pub scope: SkillScope,
    pub priority: u32,
    pub description: String,
}

/// 描述一个 Agent 的用户级 skill 安装根目录
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillInstallRoot {
    pub agent_id: String,
    pub agent_name: String,
    pub path_template: String,
    pub path: String,
    pub scope: SkillScope,
    pub exists: bool,
    pub readable: bool,
    pub writable: bool,
    pub status: SkillInstallRootStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillInstallRootStatus {
    Available,
    Missing,
    NotReadable,
    NotWritable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillScope {
    User,
    Project,
    System,
    Admin,
}

/// Agent skill 目录结构格式
#[derive(Debug, Clone)]
pub enum DirectoryFormat {
    Standard,
    Flat,
    Packaged { manifest_file: String },
    Hierarchical,
}

/// 标准化的 Skill 元数据
#[derive(Debug, Clone)]
pub struct SkillMetadata {
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub tags: Vec<String>,
    pub dependencies: Vec<String>,
    pub entry_point: Option<String>,
    pub category: Option<SkillCategory>,
    pub metadata_source: MetadataSource,
    /// Agent 特有字段（自由格式，不参与核心逻辑）
    pub extra: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub enum MetadataSource {
    SkillMd,
    DirectoryName,
    ManifestFile(String),
}

#[derive(Debug, Clone)]
pub enum SkillCategory {
    Workflow,
    Knowledge,
    Script,
    Resource,
    Tool,
    Other,
}

/// Adapter 错误类型
#[derive(Debug, thiserror::Error)]
pub enum AdapterError {
    #[error("路径不存在: {path}")]
    PathNotFound { path: String },

    #[error("路径不可读: {path}, 原因: {reason}")]
    PathNotReadable { path: String, reason: String },

    #[error("格式无效: {path}, 详情: {detail}")]
    InvalidFormat { path: String, detail: String },

    #[error("解析失败: {path}, 详情: {detail}")]
    ParseError { path: String, detail: String },

    #[error("Agent 未安装: {agent_name}")]
    NotInstalled { agent_name: String },

    #[error("Agent 版本不支持: 当前 {current}, 需要 {required}")]
    UnsupportedVersion { current: String, required: String },

    #[error("内部错误: {0}")]
    Internal(String),
}

pub fn expand_path_template(template: &str, name: Option<&str>) -> Result<String, AdapterError> {
    let mut expanded = template.to_string();
    expanded = replace_path_variable(expanded, "$HOME", dirs::home_dir())?;
    expanded = replace_path_variable(expanded, "$XDG_CONFIG_HOME", dirs::config_dir())?;
    expanded = replace_path_variable(expanded, "$XDG_DATA_HOME", dirs::data_dir())?;
    expanded = replace_env_variable(expanded, "$APPDATA", "APPDATA")?;
    expanded = replace_env_variable(expanded, "$LOCALAPPDATA", "LOCALAPPDATA")?;

    if let Some(name) = name {
        expanded = expanded.replace("{name}", name);
    }

    Ok(expanded)
}

fn replace_path_variable(
    input: String,
    variable: &str,
    value: Option<PathBuf>,
) -> Result<String, AdapterError> {
    if !input.contains(variable) {
        return Ok(input);
    }
    let value =
        value.ok_or_else(|| AdapterError::Internal(format!("无法展开路径变量 {}", variable)))?;
    Ok(input.replace(variable, &value.to_string_lossy()))
}

fn replace_env_variable(
    input: String,
    variable: &str,
    env_name: &str,
) -> Result<String, AdapterError> {
    if !input.contains(variable) {
        return Ok(input);
    }
    let value = std::env::var(env_name)
        .map_err(|_| AdapterError::Internal(format!("无法展开路径变量 {}", variable)))?;
    Ok(input.replace(variable, &value))
}

fn install_root_template_from_skill_template(template: &str) -> String {
    template
        .strip_suffix("/{name}")
        .or_else(|| template.strip_suffix("\\{name}"))
        .unwrap_or(template)
        .to_string()
}

fn evaluate_install_root_status(path: &Path) -> SkillInstallRootStatus {
    if !path.exists() {
        return SkillInstallRootStatus::Missing;
    }
    if fs::read_dir(path).is_err() {
        return SkillInstallRootStatus::NotReadable;
    }
    if !can_write_directory(path) {
        return SkillInstallRootStatus::NotWritable;
    }
    SkillInstallRootStatus::Available
}

fn can_write_directory(path: &Path) -> bool {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let probe = path.join(format!(".metis-write-check-{}", suffix));
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => fs::remove_file(probe).is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude_code::ClaudeCodeAdapter;
    use crate::codex::CodexAdapter;
    use crate::cursor::CursorAdapter;
    use crate::gemini_cli::GeminiCliAdapter;
    use crate::hermes::HermesAdapter;
    use crate::openclaw::OpenClawAdapter;
    use crate::opencode::OpencodeAdapter;
    use crate::qoder::QoderAdapter;

    #[test]
    fn expands_install_path_template_variables_and_name() {
        let expanded = expand_path_template("$HOME/.codex/skills/{name}", Some("example-skill"))
            .expect("template should expand");

        assert!(expanded.ends_with(".codex/skills/example-skill"));
        assert!(!expanded.contains("$HOME"));
        assert!(!expanded.contains("{name}"));
    }

    #[test]
    fn builtin_adapters_expose_user_skill_roots_with_status() {
        let adapters: Vec<Box<dyn AgentAdapter>> = vec![
            Box::new(CodexAdapter::new()),
            Box::new(ClaudeCodeAdapter::new()),
            Box::new(OpenClawAdapter::new()),
            Box::new(HermesAdapter::new()),
            Box::new(OpencodeAdapter::new()),
            Box::new(CursorAdapter::new()),
            Box::new(QoderAdapter::new()),
            Box::new(GeminiCliAdapter::new()),
        ];

        let roots = adapters
            .iter()
            .map(|adapter| {
                adapter
                    .user_skill_root()
                    .expect("builtin sync adapters should expose a user root")
            })
            .collect::<Vec<_>>();

        assert_eq!(roots.len(), 8);
        assert_eq!(roots[0].agent_id, "codex");
        assert_eq!(roots[1].agent_id, "claude-code");
        assert_eq!(roots[2].agent_id, "openclaw");
        assert_eq!(roots[3].agent_id, "hermes");
        assert_eq!(roots[4].agent_id, "opencode");
        assert_eq!(roots[5].agent_id, "cursor");
        assert_eq!(roots[6].agent_id, "qoder");
        assert_eq!(roots[7].agent_id, "gemini-cli");
        assert!(roots.iter().all(|root| root.scope == SkillScope::User));
        assert!(roots
            .iter()
            .all(|root| !root.path.contains("{name}") && !root.path.contains("$HOME")));
        assert!(roots.iter().all(|root| matches!(
            root.status,
            SkillInstallRootStatus::Available
                | SkillInstallRootStatus::Missing
                | SkillInstallRootStatus::NotReadable
                | SkillInstallRootStatus::NotWritable
        )));
    }
}
