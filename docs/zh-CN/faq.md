# 常见问题

[English](../en/faq.md) | 简体中文

## Metis 会上传我的 Skills 吗？

不会。Skill 索引、设置、备份和审计数据保存在本机。Metis 不收集遥测，也不会上传 Skill 内容或本地路径。

## 扫描时会访问网络吗？

不会。扫描和浏览本地 Skills 只读取本机文件。预览远端来源、检查更新、查看远端变化和执行更新时才会访问 Git 远端。启动时检查 Metis 软件版本可以在 Settings 中关闭。

## Metis 会保存 Git Token 或 SSH 私钥吗？

不会。私有仓库认证依赖系统 Git、SSH agent 或 Git credential helper。

## 一键更新会覆盖本地修改吗？

不会。一键更新只处理可信、已加入列表且本地未修改的 Skill。手动更新可以覆盖本地修改，但需要用户明确确认，并会先创建备份。

## 可以管理暂未内置支持的 Agent 吗？

可以尝试把它的 Skill 根目录添加为自定义路径。目录中的 Skill 需要使用 `SKILL.md`。

## 为什么安装包显示未知开发者？

当前 macOS 和 Windows 安装包尚未完成操作系统代码签名。请只从本仓库 GitHub Releases 下载并校验 `SHA256SUMS`。更多信息见 [安全策略](../../SECURITY.md)。

## 卸载 Metis 会删除我的 Agent Skills 吗？

Metis 管理的是现有 Agent Skill 目录。正常卸载应用不应删除这些目录，但清理应用数据可能删除 Metis 自己的索引和备份。执行系统级清理前请确认备份需求。
