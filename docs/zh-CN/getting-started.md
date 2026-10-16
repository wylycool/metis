# 快速开始

[English](../en/getting-started.md) | 简体中文

## 1. 安装 Metis

前往 [GitHub Releases](https://github.com/wylycool/metis/releases)，选择包含当前系统安装包的版本。`Source code` 是源码归档，不是安装包；若没有对应安装包，请等待该版本的安装包发布。

按系统选择：

- macOS：universal `.dmg`
- Windows：安装程序 `.exe`
- Linux：`.deb` 或 `.AppImage`

macOS：打开 DMG，把 Metis 拖到 Applications，复制完成后推出 DMG，再从“应用程序”打开 Metis。Windows：运行 EXE 安装程序，按提示完成安装。

Metis 1.5.0 的 macOS 和 Windows 安装包尚未完成操作系统代码签名，首次启动时可能出现未知开发者提示。请只从官方 Releases 下载，并使用 `SHA256SUMS` 校验文件。

Linux AppImage 如果无法启动，可以先执行：

```bash
chmod +x Metis_*.AppImage
```

## 2. 使用前提

- 扫描、浏览本地 Skills，以及把当前已安装 Skill 复制到其他本地位置，不要求系统 Git。
- 预览远端来源、测试连接、从远端安装、检查更新、查看远端差异和应用来源更新，需要本机可用的系统 Git。
- 可以在 `Settings` 中检测 Git 是否可用。Metis 1.5.0 缺少系统 Git 时不支持远端仓库功能。
- 私有仓库认证依赖系统 Git、SSH agent 或 Git credential helper；Metis 不提供 Token 输入框，也不保存凭据。

## 3. 扫描本机 Skills

打开 Metis 后进入 `Skills`，点击重新扫描。Metis 会检查 Codex、Claude Code、OpenClaw、Hermes、opencode、Cursor、Qoder、Gemini CLI 和自定义路径。

如果没有发现内容，请进入 `Settings` 检查 Agent 路径，并确认目标目录包含 `SKILL.md`。

## 4. 绑定 Git 来源

打开一个 Skill，在来源区域填写 Git 仓库地址、仓库内 Skill 目录和分支。私有仓库需要先在系统 Git 中配置 SSH agent 或 credential helper；Metis 不保存 Token 或私钥。

## 5. 检查并应用更新

点击检查更新后，先查看检查结果、本地修改和文件差异，再决定是否更新。覆盖式更新会先创建备份；更新后如有问题，可以从备份列表回滚。

## 6. 添加或复制 Skill

- 添加远端 Skill：点击“添加 Skill”，粘贴 GitHub Skill 目录页面或仓库地址，预览后选择目标路径。
- 复制本地 Skill：在详情页展开安装位置，把当前内容复制到尚未安装的 Agent。该操作不访问远端，也不会覆盖已有目录。

更多说明请查看[用户指南](user-guide.md)和[故障排查](troubleshooting.md)。
