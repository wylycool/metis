# Metis 桌面版发布说明

Metis 是一个跨平台、本地优先的 Agent Skill 管理器。桌面安装包通过 GitHub Releases 分发。

## 下载

- macOS：下载 universal `.dmg`，同时支持 Apple Silicon 和 Intel Mac。
- Windows：下载 Windows installer。
- Linux：下载 `.deb` 或 `.AppImage`。
- `SHA256SUMS`：用于校验下载文件完整性。

当前发布目标、推荐版本和直接下载地址以 [README](https://github.com/wylycool/metis#readme) 为准；全部历史版本见 [GitHub Releases](https://github.com/wylycool/metis/releases)。

## 未签名说明

当前安装包未做 macOS Developer ID 签名、公证或 Windows Authenticode 签名。macOS 可能需要右键打开或在系统设置中允许；Windows SmartScreen 可能提示未知发布者，需要选择继续运行。

## 当前能力

- 在 `Skills` 和 `Settings` 两个工作区管理本机 Agent skills 与安装路径。
- 扫描 Codex、Claude Code、OpenClaw、Hermes、opencode 和自定义路径中的 `SKILL.md`。
- 为已安装 Skill 绑定 Git 来源，按需检查更新、查看文件差异、手动更新、备份和回滚。
- 在“添加 Skill”页面预览远端 Git Skill，再安装或更新到用户选择的 Agent 或自定义路径。
- 在 Skill 详情页展开安装位置后，将当前本地 Skill 复制到尚未安装的 Agent 或自定义路径；本地复制不检查远端更新，也不覆盖已有目录。
- 在 Settings 中管理内置 Agent 路径、自定义路径、受控自动更新列表，并检测本机 Git 环境。

## 远端交互边界

进入 Skill 详情页或展开安装位置不会访问远端 Git。只有用户主动预览远端来源、测试来源连接、检查更新、查看差异或执行来源更新时，Metis 才会发起 Git 交互。

## 当前限制

- 不包含 marketplace、社区 registry、云同步、账号系统或托管式企业后台。
- 不包含 AI 自动生成或改写 Skill。
- 安装包尚未进行 macOS Developer ID 签名、公证或 Windows Authenticode 签名。
