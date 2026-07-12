# Metis：Agent Skill 管理器

> 一个跨平台、本地优先、开源的 AI Agent Skill 版本管理器。

Metis（墨提斯）是一个跨平台、本地优先、开源的 AI Agent Skill 管理器，用于发现、登记、更新、回滚和审计 Codex、Claude Code、OpenClaw、Hermes、opencode 以及其他 Agent 工具中的 skills。

它的目标不是一开始做 skill 商店，而是先解决一个更基础也更真实的问题：

> 用户本机已经有很多 skills，如何让它们可见、可追踪、可更新、可回滚、可审计。

## 下载

下一正式版是 **Metis 1.5.0**，计划 tag 为 `desktop-v1.5.0`，目前正在进行发布准备。正式 Release 创建前不提供可能失效的 1.5.0 直接下载链接。

当前历史 Beta 安装包和全部发布记录可在 [GitHub Releases](https://github.com/wylycool/metis/releases) 查看。通过 GitHub Releases 分发的安装包尚未进行系统级签名；macOS 或 Windows 首次打开时可能需要手动允许。

## 当前阶段

Phase 1 Core Engine 本地管理闭环、Phase 2 Desktop MVP、Phase 3 稳定化、Phase 3.5 GitHub Release 分发、Phase 4 本地治理能力、Phase 5 产品化收口和 Phase 6 前端体验重构均已完成。项目当前正在准备 **Metis 1.5.0 正式版**。

桌面应用当前提供 `Skills` 和 `Settings` 两个工作区：Skills 用于扫描、来源绑定、更新检查、diff、手动更新、备份回滚和安装；Settings 用于管理内置 Agent 路径、自定义路径、受控自动更新列表和本机 Git 检测。添加 Skill 页面支持预览远端 Git Skill 后安装到选中路径；已安装 Skill 的详情页支持把当前本地目录直接复制到其他未安装路径。

## 技术栈

- **桌面框架**：Tauri
- **前端**：TypeScript
- **核心引擎**：Rust（独立于 UI，可供 CLI 复用）
- **数据库**：SQLite
- **凭据处理**：Metis 当前不存储凭据；Git 认证依赖系统 Git、SSH agent 或 Git credential helper
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
- 显示检查结果、文件差异和本地修改状态。
- 支持手动确认更新。
- 更新前自动备份。
- 更新失败自动回滚。
- 支持查看更新 diff。
- 支持通过本机 Git、SSH agent 或 Git credential helper 访问私有仓库；Metis 不保存 Keychain、token 或私钥。Storage 仍兼容 `credential_ref` 备注字段，但当前正式 UI 不提供凭据输入入口。
- 支持受控自动更新：只处理用户同时标记为 trusted 和 auto update、且本地未修改的 source。
- 支持添加远端 Skill：预览 Git 来源后，选择 Codex、Claude Code、OpenClaw、Hermes、opencode 或自定义路径进行安装或更新。
- 支持详情页本地复制：展开安装位置后，把当前已安装 Skill 复制到其他尚未安装的 Agent 或自定义路径；此过程不检查远端更新，也不覆盖已有目录。
- 支持在 Settings 编辑内置 Agent 路径、管理命名自定义路径和检测本机 Git 环境。

## 本地验证

```bash
cargo test
cargo clippy
(cd apps/desktop && pnpm build)
(cd apps/desktop && pnpm tauri build)
(cd apps/desktop && pnpm tauri:build:mac-universal)
```

macOS 面向发布的首选安装包是 universal DMG，输出在 `target/universal-apple-darwin/release/bundle/dmg/Metis_<version>_universal.dmg`，同时兼容 Apple Silicon 和 Intel Mac。跨平台桌面发布包由 GitHub Actions workflow `Desktop Release Packages` 构建 macOS universal、Windows 和 Linux artifact。发布检查清单见 [docs/release-checklist.md](docs/release-checklist.md)。

## 安装提示

Metis 桌面版通过 [GitHub Releases](https://github.com/wylycool/metis/releases) 直接分发，不发布到 App Store 或 Microsoft Store。下一正式版 tag 为 `desktop-v1.5.0`，当前尚在准备中。

- macOS：下载 universal `.dmg`，挂载后拖拽或启动 Metis。当前包未签名和公证，首次启动可能需要右键打开，或到系统设置中允许打开。
- Windows：下载 Windows installer。当前包未做 Authenticode 签名，SmartScreen 可能提示未知发布者，需要选择继续运行。
- Linux：下载 `.deb` 或 `.AppImage`；AppImage 如无执行权限，可先执行 `chmod +x <file>.AppImage`。
- 校验：Release 中的 `SHA256SUMS` 可用于核对下载文件完整性，macOS/Linux 可运行 `shasum -a 256 -c SHA256SUMS`。

签名、公证和 Windows Authenticode 属于后续信任增强；当前未签名状态需要在发布说明和安装提示中持续明确。

首次打开后的建议路径：

1. 在 `Skills` 工作区点击重新扫描，确认本机已安装 skills。
2. 对需要跟踪更新的 Skill 绑定 Git 来源，并按需加入受控自动更新列表。
3. 点击“添加 Skill”，预览远端 Git Skill 后安装或更新到选中的 Agent 或自定义路径。
4. 进入已安装 Skill 的详情页，展开安装位置，把当前本地 Skill 复制到其他尚未安装的路径；此操作不会检查远端更新。
5. 在 `Settings` 工作区调整内置 Agent 路径、添加命名自定义路径或检测本机 Git 环境。

## 当前不做

以下方向重要，但不进入当前 1.5.0 发布范围：

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

## 文档索引

- [简体中文用户文档](docs/zh-CN/README.md)：安装、使用和故障排查入口。
- [English documentation](docs/en/README.md): installation, usage, and troubleshooting.
- [SECURITY.md](SECURITY.md)：安全策略、凭据模型、威胁模型和隐私承诺。
- [CONTRIBUTING.md](CONTRIBUTING.md)：贡献指南，包含开发环境设置和 Adapter 贡献规范。

## 项目原则

- 本地优先：默认不依赖云端账号或远程服务。
- 安全优先：默认只检测更新；受控自动更新只允许 trusted source，并继续执行安全检查。
- 来源透明：每个可管理 skill 都应能追踪来源和版本。
- 可回滚：任何覆盖式更新都必须先备份。
- 适配器化：每个 Agent 运行时通过独立 adapter 接入。
- 先治理再分发：先解决已安装 skills 的管理问题，再考虑 marketplace。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。贡献代码即表示你同意此条款。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。
