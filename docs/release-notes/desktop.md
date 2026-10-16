# Metis 桌面版

[English](https://github.com/wylycool/metis/blob/main/docs/release-notes/desktop.en.md) | 简体中文

Metis 是一个跨平台、本地优先的 Agent Skill 管理器。

### 下载

- macOS：适用于 Apple Silicon 和 Intel Mac 的 universal `.dmg`
- Windows：安装程序 `.exe`
- Linux：`.deb` 或 `.AppImage`
- `SHA256SUMS`：用于校验发布文件完整性

### 主要能力

- 发现 Codex、Claude Code、OpenClaw、Hermes、opencode、Cursor、Qoder、Gemini CLI 和自定义路径中的 Skills。
- 为本地 Skill 绑定 Git 来源，并按需检查更新。
- 更新前查看文件变化和本地修改状态。
- 覆盖前创建备份，并支持恢复旧版本。
- 将远端 Skill 安装到用户选择的 Agent 路径。
- 把已有本地 Skill 复制到其他 Agent，不访问远端，也不覆盖已有目录。
- 在 Settings 中管理 Agent 路径、自定义路径、可信来源和一键更新列表。

### 系统 Git 要求

本地扫描、浏览和本地复制不要求 Git。预览来源、测试连接、从远端安装、检查更新、查看远端差异和来源更新需要本机可用的系统 Git。私有仓库认证使用用户已有的 SSH agent 或 Git credential helper；Metis 不保存仓库凭据。

### 网络和安装行为

扫描本地 Skills 不会访问远端 Git。只有预览来源、测试连接、检查更新、查看差异或执行更新等明确操作才会访问 Git 远端。启动时检查 Metis 软件更新是可选功能，可以在 Settings 中关闭。

Metis 不会静默安装、提权或自动重启。应用更新安装包会保存到系统 Downloads，由用户手动完成安装。

### 签名提示

当前 macOS 安装包尚未使用 Apple Developer ID 签名和公证，Windows 安装包尚未使用 Authenticode 签名，因此 Gatekeeper 或 SmartScreen 可能显示未知开发者提示。请只从本仓库下载，并校验 `SHA256SUMS`。
