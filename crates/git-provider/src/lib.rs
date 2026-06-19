//! Metis Git Provider
//!
//! 封装 Git 操作，通过系统 `git` CLI 执行 fetch、checkout、diff、log。
//! 支持公开仓库和私有仓库；认证由系统 Git、SSH agent 或 Git credential helper 处理。

pub mod diff;
pub mod fetch;
pub mod source;
