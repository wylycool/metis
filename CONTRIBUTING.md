# Contributing to Metis / 参与贡献

[English](#english) | [简体中文](#简体中文)

## English

Thank you for helping improve Metis. You can report bugs, suggest features, improve documentation, add support for another Agent, or submit code changes.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

### Before opening an issue

- Search existing [GitHub Issues](https://github.com/wylycool/metis/issues) first.
- For bugs, include the Metis version, operating system, reproduction steps, expected behavior, and actual behavior.
- Remove tokens, private repository URLs, personal data, and complete local paths from logs and screenshots.
- Report security vulnerabilities privately through [SECURITY.md](SECURITY.md), not through a public Issue.

### Development setup

Requirements:

- Rust stable
- Node.js 22
- pnpm 10
- Git
- [Platform prerequisites for Tauri 2](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/wylycool/metis.git
cd metis
cargo test
cd apps/desktop
pnpm install
pnpm tauri dev
```

### Pull requests

- Open an Issue first for substantial new features.
- Keep each pull request focused on one feature or fix.
- Add or update tests for behavior changes.
- Update both Chinese and English user documentation when user-visible behavior changes.
- Run the checks directly related to your change. Rust changes normally require `cargo fmt --check`, relevant tests, and Clippy. Desktop changes normally require relevant frontend tests and `pnpm build`.
- Explain what changed, why it changed, how it was tested, and any known limitations.

### Adding an Agent adapter

Implement the adapter contract in `crates/adapters`, add path-discovery and metadata-parsing tests, register the adapter, and update the supported-Agent documentation.

## 简体中文

感谢你帮助改进 Metis。你可以报告问题、提出功能建议、完善文档、增加新的 Agent 支持或提交代码修改。

参与社区即表示你同意遵守[社区行为准则](CODE_OF_CONDUCT.md)。

### 提交 Issue 前

- 先搜索现有 [GitHub Issues](https://github.com/wylycool/metis/issues)。
- 报告 Bug 时，请提供 Metis 版本、操作系统、复现步骤、预期行为和实际行为。
- 从日志和截图中移除 Token、私有仓库地址、个人数据和完整本地路径。
- 安全漏洞请按照 [SECURITY.md](SECURITY.md) 私下报告，不要创建公开 Issue。

### 开发环境

需要安装：

- Rust stable
- Node.js 22
- pnpm 10
- Git
- [Tauri 2 对应平台的系统依赖](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/wylycool/metis.git
cd metis
cargo test
cd apps/desktop
pnpm install
pnpm tauri dev
```

### Pull Request 要求

- 较大的新功能请先创建 Issue 讨论。
- 每个 PR 只处理一个功能或问题。
- 行为变化需要新增或更新测试。
- 用户可见行为变化需要同步更新中英文用户文档。
- 运行与本次修改直接相关的检查。Rust 修改通常需要 `cargo fmt --check`、相关测试和 Clippy；桌面修改通常需要相关前端测试和 `pnpm build`。
- 在 PR 中说明改了什么、为什么修改、如何验证以及已知限制。

### 添加 Agent Adapter

在 `crates/adapters` 中实现适配器接口，补充路径发现和元数据解析测试，注册适配器，并更新支持的 Agent 文档。

## License

Contributions are licensed under the repository's [MIT License](LICENSE).
