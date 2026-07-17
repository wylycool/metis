//! Metis Agent Adapters
//!
//! 每个 AI Agent 工具（Codex、Claude Code 等）对应一个 Adapter 实现。
//! Adapter 的职责是隔离不同 Agent 在安装路径、目录格式和元数据规范上的差异。

pub mod claude_code;
pub mod codex;
pub mod cursor;
pub mod gemini_cli;
pub mod generic;
pub mod hermes;
pub mod openclaw;
pub mod opencode;
pub mod qoder;
pub mod registry;
pub mod standard;
pub mod traits;

// Re-export
pub use registry::AdapterRegistry;
pub use traits::{
    AdapterError, AgentAdapter, DirectoryFormat, MetadataSource, SkillMetadata, SkillScope,
    SkillSearchPath,
};
