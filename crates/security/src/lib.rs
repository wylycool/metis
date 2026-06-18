//! Metis Security
//!
//! 对 skill 更新前后的目录差异做基础静态安全检查：
//! - 新增/修改脚本文件
//! - 新增可执行文件
//! - 疑似网络调用
//! - 敏感路径访问
//! - 权限变化

pub mod checker;
pub mod findings;

// TODO: Phase 1 — 实现安全检查模块
