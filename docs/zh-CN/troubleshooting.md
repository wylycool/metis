# 故障排查

[English](../en/troubleshooting.md) | 简体中文

## 没有扫描到 Skill

- 确认目标目录中存在 `SKILL.md`。
- 在 Settings 检查对应 Agent 路径是否正确。
- 确认当前用户对目录具有读取权限。

## Git 来源无法连接

- 在 Settings 运行 Git 检测。
- 在终端确认 `git` 可以访问相同仓库。
- 私有仓库请先配置 SSH agent 或 Git credential helper。
- 检查仓库地址、分支和 Skill 子目录是否正确。

## 无法安装或更新

- 确认目标 Agent 路径存在且可写。
- 非 Skill 冲突目录不会被自动覆盖，请先人工确认目录内容。
- 查看界面中的安全提示和错误说明，不要在 Issue 中上传 Token、私有仓库地址或完整本地路径。

仍无法解决时，请在 GitHub Issues 中提供 Metis 版本、操作系统、复现步骤和脱敏后的日志。
