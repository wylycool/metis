# 安全策略 (Security Policy)

## 设计原则

Metis 是一个本地优先的 Agent Skill 管理器。安全是核心设计目标，而非事后补救。

### 根本原则

1. **本地优先**：用户数据、索引、备份和审计记录默认只存本机，不上传任何远程服务。
2. **显式信任**：默认只检测更新，不自动更新。只有用户明确标记为 `trusted` 的来源才允许自动更新。
3. **凭据隔离**：Metis 当前不保存 Token、私钥等敏感凭据，只保存 `credential_ref` 引用名；真实认证由系统 Git、SSH agent 或 Git credential helper 完成。
4. **可回滚**：任何覆盖本地文件的更新操作必须先创建完整备份。
5. **不自动执行**：Metis 默认不执行 skill 内的任何脚本。安全检查只做静态分析。

## 安全检查覆盖范围

每次更新前，Security 模块对变更内容进行静态检查，关注以下风险信号：

| 风险类别 | 检查项 | 默认行为 |
|---------|--------|---------|
| 脚本文件 | 新增 `.sh`、`.py`、`.js`、`.rb` 等脚本 | 标记提醒 |
| 可执行文件 | 新增可执行文件或权限变更为可执行 | 标记提醒 |
| 网络调用 | 脚本中包含 `curl`、`wget`、`fetch`、`requests` 等 | 高风险标记 |
| 敏感路径 | 访问 `~/.ssh`、`~/.gnupg`、keychain、环境变量 | 高风险标记 |
| 元数据变更 | `SKILL.md` 被删除或替换 | 标记提醒 |
| 权限变更 | 文件权限从只读变为可写/可执行 | 标记提醒 |

### 安全等级定义

- **低风险**：仅新增文档、配置或资源文件，无脚本、无可执行文件。
- **中风险**：新增或修改脚本文件，但无敏感操作。
- **高风险**：包含网络调用、敏感路径访问或可执行文件变更。

### 自动更新策略

- 默认：所有来源 `auto_update = false`。
- 用户标记为 `trusted` 后，可开启自动更新。
- 自动更新遇到中/高风险变更时，**阻止自动更新**，降级为手动确认。
- 手动更新遇到高风险变更时，显示警告并要求二次确认。

## 凭据安全

### 存储规范

| 存储位置 | 允许内容 | 禁止内容 |
|---------|---------|---------|
| 系统 Git / SSH agent / credential helper | Token、私钥、密码 | Metis 不直接读取 |
| 配置文件 | `credential_ref: "name"` | Token 明文、带 token 的 URL |
| lock 文件 | 来源 URL、ref、commit | Token 明文 |
| SQLite | `credential_ref` 字符串 | Token 明文 |
| 导出报告 | 来源 URL、版本信息 | Token 明文、credential_ref |
| 日志文件 | — | Token、私钥、密码 |

### 支持的认证方式

- GitHub Personal Access Token (classic + fine-grained)
- GitLab Personal Access Token / Deploy Token
- Gitea Token
- SSH Key（通过 ssh-agent）
- GitHub Enterprise Server PAT

## 威胁模型

Metis 的威胁模型假设：

- **可信边界**：用户本机操作系统和文件系统是可信任的。
- **不可信边界**：远端 Git 仓库内容不可信任，必须经过安全检查。
- **半可信边界**：局域网内的私有 Git 服务（如企业 GitLab）属于半可信，仍需安全检查但可标记为 trusted source。

## 报告安全漏洞

如果你发现安全漏洞，请通过以下方式私下报告：

- Email: [待补充]
- 不要在公开 Issue 中披露安全漏洞。

我们会在 48 小时内确认收到报告，并在 90 天内披露已修复的漏洞。

## 依赖安全

- Rust 依赖通过 `cargo audit` 定期检查。
- 前端依赖通过 `npm audit` / `pnpm audit` 定期检查。
- Git 库优先使用成熟的 Rust Git 实现，减少外部命令注入风险。

## 构建与分发安全

- Release 构建通过 GitHub Actions 自动化，构建日志公开可审计。
- macOS 版本提供代码签名和公证。
- Windows 版本提供 Authenticode 签名。
- 构建产物提供 SHA256 校验和。
- 所有 commit 需签名验证（不强制在 MVP 阶段执行，但 Beta 阶段应引入）。

## 隐私承诺

- Metis 不收集任何遥测数据。
- Metis 不向任何远程服务发送用户数据。
- Metis 不包含任何形式的用户行为追踪。
- 所有网络请求仅由用户主动触发的 Git 操作产生。
