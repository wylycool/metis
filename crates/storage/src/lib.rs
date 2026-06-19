//! Metis Storage
//!
//! 本地持久化层，管理：
//! - SQLite 数据库（skill 索引、source 绑定、备份记录、审计日志）
//! - 文件清单（用于本地修改检测）
//! - 备份目录（更新前的完整 skill 快照）
//! - lock 文件（团队可共享的版本锁定文件）

pub mod backup;
pub mod db;
pub mod manifest;
pub mod migrations;
