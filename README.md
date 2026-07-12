# Metis：统一管理你的 Agent Skills

> 一个跨平台、本地优先、开源的 Agent Skill 管理器。

[简体中文](docs/zh-CN/README.md) | [English](docs/en/README.md) | [下载 Metis](https://github.com/wylycool/metis/releases)

Metis 帮你在一个桌面应用里发现、安装和维护 Codex、Claude Code、OpenClaw、Hermes、opencode 等 Agent 工具中的 Skills。

如果你同时使用多个 Agent，或者本机已经积累了很多来自不同 Git 仓库的 Skills，Metis 可以帮你回答这些问题：

- 我的 Skills 分别安装在哪里？
- 它们来自哪个仓库和目录？
- 远端有没有更新，本地改过什么？
- 更新出问题后，能不能恢复？
- 怎样把一个 Skill 安装到其他 Agent？

## 下载与安装

前往 [GitHub Releases](https://github.com/wylycool/metis/releases) 下载适合当前系统的安装包。

| 系统 | 安装包 | 说明 |
| --- | --- | --- |
| macOS | universal `.dmg` | 同时支持 Apple Silicon 和 Intel Mac |
| Windows | installer `.exe` | 通过安装程序完成安装 |
| Linux | `.deb` / `.AppImage` | AppImage 首次使用时可能需要添加执行权限 |

当前发布包尚未完成 macOS Developer ID 公证和 Windows Authenticode 签名。首次打开时，macOS 或 Windows 可能显示未知开发者或未知发布者提示，请仅从本仓库的 GitHub Releases 下载，并使用 Release 中的 `SHA256SUMS` 校验文件。

下一正式版为 **Metis 1.5.0**。在正式 Release 发布前，Releases 页面中可能只有历史 Beta 版本。

## 三步开始使用

### 1. 扫描本机 Skills

打开 Metis，进入 `Skills`，点击重新扫描。Metis 会读取已配置的 Agent Skill 路径，并把发现的 Skills 汇总到一个列表中。

### 2. 绑定来源并检查更新

打开一个 Skill，为它绑定 Git 仓库、仓库内目录和分支。之后可以主动检查远端更新、查看文件差异，并确认是否更新。

### 3. 安装到其他 Agent

点击“添加 Skill”可以从 Git 仓库安装远端 Skill；在已安装 Skill 的详情页，也可以把当前本地内容复制到其他尚未安装的位置。

## 主要功能

### 统一发现

- 扫描多个 Agent 的默认 Skill 路径。
- 支持添加命名的自定义监控路径。
- 读取 `SKILL.md` 中的名称、描述和基础信息。
- 合并展示同一个 Skill 的多个安装位置。

### 来源与版本追踪

- 为本地 Skill 绑定 Git 来源、仓库目录和分支。
- 主动检查远端是否有更新。
- 展示远端变化、本地修改状态和文件差异。
- 支持使用系统 Git 访问公开或私有仓库。

### 安全更新与回滚

- 更新前自动创建本地备份。
- 更新失败时尝试恢复原有内容。
- 支持查看备份并手动回滚。
- 在写入前校验目标路径，避免覆盖无关目录。
- 对 Skill 目录进行静态安全检查，但不会执行其中的脚本。

### 跨 Agent 安装

- 从远端来源预览并安装 Skill。
- 一次选择多个 Agent 或自定义目标路径。
- 将已有本地 Skill 复制到其他未安装位置。
- 本地复制不会访问远端，也不会覆盖已有目录。

### 受控的一键更新

- 由用户明确标记可信来源。
- 只有加入一键更新列表且本地未修改的 Skill 才会自动处理。
- 用户可以随时移出列表，继续使用手动检查和更新。

## 支持的 Agent

Metis 当前内置以下 Agent 路径支持：

- Codex
- Claude Code
- OpenClaw
- Hermes
- opencode
- 通用 Agent Skills 目录
- 用户自定义路径

其他使用 `SKILL.md` 的 Agent 可以先通过自定义路径进行管理。

## 隐私与网络访问

Metis 以本地工作为主：

- Skill 索引、设置、备份和审计记录保存在本机。
- Metis 不保存 Git Token、SSH 私钥或其他仓库凭据。
- 私有仓库认证依赖系统 Git、SSH agent 或 Git credential helper。
- 扫描和浏览本地 Skills 不需要访问网络。
- 只有预览远端来源、检查更新、查看远端差异或执行更新等明确操作才会访问 Git 远端。
- 可在 Settings 中关闭 Metis 启动时的软件版本检查。

安全边界、已知限制和漏洞报告方式请查看 [SECURITY.md](SECURITY.md)。

## 使用文档

- [简体中文用户文档](docs/zh-CN/README.md)
- [English documentation](docs/en/README.md)
- [快速开始](docs/zh-CN/getting-started.md)
- [用户指南](docs/zh-CN/user-guide.md)
- [故障排查](docs/zh-CN/troubleshooting.md)
- [常见问题](docs/zh-CN/faq.md)

## 参与贡献

Metis 使用 Tauri、React、TypeScript、Rust 和 SQLite 构建。欢迎报告问题、完善文档、添加 Agent 支持或提交代码改进。

开发环境、测试命令和 Pull Request 要求请查看 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请不要创建公开 Issue，应按照 [SECURITY.md](SECURITY.md) 中的方式报告。

普通使用问题请先查看[故障排查](docs/zh-CN/troubleshooting.md)和[支持说明](SUPPORT.md)。

## License

Metis 使用 [MIT License](LICENSE)。
