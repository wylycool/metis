# 用户指南

[English](../en/user-guide.md) | 简体中文

## Skills 工作区

- 扫描：发现各 Agent 路径中的 `SKILL.md`。
- 来源：为本地 Skill 绑定 Git URL、仓库目录和分支或引用。
- 检查更新：仅在用户主动操作时访问远端 Git。
- 差异：查看本地版本与待更新内容之间的文件变化。
- 更新：确认后覆盖本地目录，操作前自动创建备份。
- 回滚：从已有备份恢复，并保留恢复前状态。
- 跨 Agent 安装：从远端安装到多个 Agent，或把现有本地 Skill 复制到尚未安装的位置。

## Settings 工作区

- 查看和修改内置 Agent 的 Skill 路径。
- 添加命名的自定义监控路径。
- 检测本机 Git 环境。
- 管理受信任来源和一键更新列表。
- 检查 Metis 软件版本。

## 凭据与网络

Metis 不保存 Git Token 或 SSH 私钥。私有仓库认证依赖系统 Git、SSH agent 或 Git credential helper。扫描本地 Skills 不需要访问网络；预览来源、检查更新、查看远端差异或执行更新时才会访问 Git 远端。
