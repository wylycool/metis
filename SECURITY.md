# Security Policy / 安全策略

[English](#english) | [简体中文](#简体中文)

## English

### Reporting a vulnerability

Please use [GitHub Security Advisories](https://github.com/wylycool/metis/security/advisories/new) to report vulnerabilities privately. Do not publish vulnerability details, proof-of-concept code, tokens, private repository URLs, or real local paths in a public Issue.

If private reporting is unavailable, open a public Issue asking the maintainer for a private contact method without including technical details.

### Security and privacy boundaries

- Metis stores its index, settings, backups, and audit data locally.
- Metis does not collect telemetry or upload Skill contents, local paths, settings, or usage data.
- Metis does not store Git tokens, SSH private keys, or repository passwords. Remote source actions require system Git, and private repository access relies on the user's SSH agent or Git credential helper.
- Local scanning does not require network access. Remote access occurs after explicit actions such as previewing a source, checking for updates, viewing remote changes, or downloading an update.
- The optional startup update check contacts GitHub Releases and can be disabled in Settings.
- Metis performs static checks on Skill files but does not execute scripts contained in a Skill. Static warnings are not a sandbox or antivirus guarantee.
- File-replacing updates create a backup first. Users should still review changes from untrusted repositories before applying them.

### Application distribution

Metis 1.5.0 is still in final release preparation, and no installable package is currently available. After the official release, download Metis only from this repository's [GitHub Releases](https://github.com/wylycool/metis/releases); release assets will include SHA-256 checksums.

The planned Metis 1.5.0 macOS packages are not signed and notarized with Apple Developer ID, and the planned Windows packages are not signed with Authenticode. After release, Gatekeeper or SmartScreen may therefore display an unknown-developer warning. The in-app Tauri update signature verifies the Metis update channel and file integrity, but it does not replace operating-system code signing.

## 简体中文

### 报告安全漏洞

请优先使用 [GitHub Security Advisories](https://github.com/wylycool/metis/security/advisories/new) 私下报告漏洞。不要在公开 Issue 中发布漏洞细节、PoC、Token、私有仓库地址或真实本机路径。

如果私密报告入口不可用，可以创建一个不包含技术细节的公开 Issue，请求维护者提供私下联系方式。

### 安全与隐私边界

- Metis 的索引、设置、备份和审计数据保存在本机。
- Metis 不收集遥测，也不会上传 Skill 内容、本地路径、设置或使用数据。
- Metis 不保存 Git Token、SSH 私钥或仓库密码。远端来源操作需要系统 Git，私有仓库访问依赖用户已有的 SSH agent 或 Git credential helper。
- 扫描本地 Skills 不需要网络。预览来源、检查更新、查看远端变化或下载安装包等明确操作才会访问远端。
- 启动时检查软件更新是可选功能，可以在 Settings 中关闭。
- Metis 会对 Skill 文件进行静态检查，但不会执行 Skill 中的脚本。静态提示不能替代沙箱或杀毒软件。
- 覆盖本地文件的更新会先创建备份。对于不可信仓库，用户仍应在更新前检查变化内容。

### 应用分发

Metis 1.5.0 正在进行正式发布前准备，当前暂无可安装的软件包。正式发布后，请只从本仓库的 [GitHub Releases](https://github.com/wylycool/metis/releases) 下载 Metis；Release 资产将包含 SHA-256 校验和。

计划中的 Metis 1.5.0 macOS 安装包尚未使用 Apple Developer ID 签名和公证，Windows 安装包尚未使用 Authenticode 签名。正式发布后，Gatekeeper 或 SmartScreen 可能显示未知开发者提示。应用内的 Tauri 更新签名用于确认 Metis 更新通道和文件完整性，但不能替代操作系统代码签名。
