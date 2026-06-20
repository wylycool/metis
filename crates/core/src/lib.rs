//! Metis Core Engine
//!
//! Core Engine 是 Metis 的核心逻辑层，提供：
//!
//! - **Discovery**：扫描本机各 Agent 已安装的 skills
//! - **Source**：为 skill 绑定 Git 来源
//! - **Update**：检测远端更新、查看 diff、应用更新
//! - **Rollback**：回滚到历史备份版本
//! - **LockFile**：团队清单导入/导出
//! - **Audit**：审计日志查询
//! - **Config**：配置管理

pub mod audit;
pub mod config;
pub mod discovery;
pub mod local_state;
pub mod lockfile;
pub mod preview;
pub mod rollback;
pub mod source;
pub mod update;
