//! Metis Git Provider
//!
//! 封装 Git 操作，通过系统 `git` CLI 执行 fetch、checkout、diff、log。
//! 支持公开仓库和私有仓库（通过 credential_ref 引用 keychain 中的 token）。

pub mod diff;
pub mod fetch;
pub mod source;
