use std::collections::HashMap;

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
    UnsupportedVersion {
        current: String,
        required: String,
    },

    #[error("内部错误: {0}")]
    Internal(String),
}
