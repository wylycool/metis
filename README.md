# Metis — Agent Skill Manager

> A cross-platform, local-first, open-source version manager for AI agent skills.

Metis（墨提斯）是一个跨平台、本地优先、开源的 AI Agent Skill 管理器，用于发现、登记、更新、回滚和审计 Codex、Claude Code、OpenClaw、Hermes、opencode 以及其他 Agent 工具中的 skills。

它的目标不是一开始做 skill 商店，而是先解决一个更基础也更真实的问题：

> 用户本机已经有很多 skills，如何让它们可见、可追踪、可更新、可回滚、可审计。

## 当前阶段

项目处于 **Phase 2 Desktop MVP 收口阶段**：Phase 1 的 Core Engine 本地管理闭环已经完成，桌面应用已打通扫描、来源绑定、更新检查、diff、手动更新、备份回滚、设置面板和凭据引用入口，正在收口 GUI 实机验证与跨平台预览包打包流程。

## 技术栈

- **桌面框架**：Tauri
- **前端**：TypeScript
- **核心引擎**：Rust（独立于 UI，可供 CLI 复用）
- **数据库**：SQLite
- **凭据存储**：系统 Keychain / Credential Manager
- **版本管理**：Git
- **分发**：macOS / Windows / Linux，通过 GitHub Releases

## 核心价值

AI Agent 工具正在快速增长，不同工具的 skill 安装路径、目录格式、更新方式和来源管理都可能不同。个人用户可以手动复制几个 skill，但当 skills 来自多个 GitHub 仓库、公司内部私有仓库、团队 zip 包或不同 Agent 运行时，手动维护很快会变得不可控。

Agent Skill Manager 希望让这些本地 skills 具备持续治理能力：

- 可见：扫描并展示本机各 Agent 已安装的 skills。
- 可追踪：给每个 skill 绑定 Git 来源、路径、ref 和当前版本。
- 可更新：检测远端更新并支持用户确认后更新。
- 可回滚：更新前自动备份，失败或异常时可恢复旧版本。
- 可审计：记录来源、版本、更新时间、diff 和安全提醒。
- 可团队化：支持导入、导出和锁定团队统一 skill 清单。

## 目标用户

- 同时使用 Codex、Claude Code、OpenClaw、Hermes、opencode、Gemini CLI、Cursor 或其他 Agent 工具的个人开发者。
- 维护大量 prompt、workflow、脚本和资源型 skills 的高级用户。
- 在企业内部维护团队规范、排障流程、发布流程、行业知识和内部工具链 skills 的工程团队。
- 需要对本机 Agent 扩展内容做来源审计、安全检查和版本回滚的组织。

## MVP 范围

当前 MVP 聚焦本地 skill 管理闭环：

- 自动识别本机 Codex skills 路径。
- 自动识别本机 Claude Code skills 路径。
- 自动识别本机 OpenClaw skills 路径。
- 自动识别本机 Hermes skills 路径。
- 自动识别本机 opencode skill 路径。
- 支持通用 Agent Skills 标准目录。
- 展示已发现的 skill 列表。
- 解析 `SKILL.md` 中的名称、描述和基础元数据。
- 给 skill 绑定 Git 来源 URL、仓库内路径、ref 和当前 commit。
- 检测远端是否有更新。
- 显示当前版本、远端版本和本地修改状态。
- 支持手动确认更新。
- 更新前自动备份。
- 更新失败自动回滚。
- 支持查看更新 diff。
- 支持私有仓库凭据引用入口；当前只保存 `credential_ref` 名称，真实凭据仍由本机 Git / SSH agent 或后续 Keychain 接入管理。
- 支持导出和导入团队 skill 清单。

## 本地验证

```bash
cargo test
cargo clippy
cd apps/desktop && pnpm build
cd apps/desktop && pnpm tauri build
```

跨平台预览包通过 GitHub Actions workflow `Desktop Preview Packages` 构建，支持 macOS、Windows 和 Linux artifact。当前不做代码签名、公证或自动发布 GitHub Release。

## 暂不进入 MVP

以下方向重要，但不进入第一阶段：

- skill marketplace
- 云同步
- 用户账号系统
- 在线评分和排行榜
- 公共 skill 自动审核平台
- AI 自动生成或改写 skill
- 复杂企业权限管理
- 企业后台
- 插件市场
- 多人协作平台

## 初始技术方向

当前推荐方向是：

- Desktop App：Tauri
- UI：TypeScript 前端
- Core Engine：Rust core，保持独立可复用
- Storage：SQLite、lock 文件、系统 keychain、本地备份目录
- Git：支持公开仓库和私有仓库
- Distribution：macOS、Windows、Linux，后续通过 GitHub Releases 发布

架构上要求 Core Engine 不依赖具体 UI，未来可以被桌面应用和 CLI 共用。

## 文档索引

- [PROJECT_BLUEPRINT.md](PROJECT_BLUEPRINT.md)：项目愿景、边界、用户、MVP、非目标和成功标准。
- [ARCHITECTURE.md](ARCHITECTURE.md)：高层架构、模块边界、数据流、更新流程、安全模型和跨平台策略。
- [ROADMAP.md](ROADMAP.md)：Phase 0 → Phase 5 路线图，包含 MVP、Beta、企业增强和生态扩展。
- [SECURITY.md](SECURITY.md)：安全策略、凭据模型、威胁模型和隐私承诺。
- [CONTRIBUTING.md](CONTRIBUTING.md)：贡献指南，包含开发环境设置和 Adapter 贡献规范。
- [docs/design/core-engine-api.md](docs/design/core-engine-api.md)：Core Engine API 接口规格。
- [docs/design/adapter-interface.md](docs/design/adapter-interface.md)：Adapter trait 接口设计。
- [docs/design/database-schema.md](docs/design/database-schema.md)：SQLite 数据库 Schema 设计。

## 项目原则

- 本地优先：默认不依赖云端账号或远程服务。
- 安全优先：默认只检测更新，不自动更新。
- 来源透明：每个可管理 skill 都应能追踪来源和版本。
- 可回滚：任何覆盖式更新都必须先备份。
- 适配器化：每个 Agent 运行时通过独立 adapter 接入。
- 先治理再分发：先解决已安装 skills 的管理问题，再考虑 marketplace。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。贡献代码即表示你同意此条款。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。
