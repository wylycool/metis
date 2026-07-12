# 安全策略

## 设计原则

Metis 是一个本地优先的 Agent Skill 管理器。安全是核心设计目标，而非事后补救。

### 根本原则

1. **本地优先**：用户数据、索引、备份和审计记录默认只存本机，不上传任何远程服务。
2. **Skill 来源信任**：Skill 自动更新默认关闭。只有用户明确标记为 `trusted` 的来源才允许进入受控自动更新。
3. **凭据隔离**：Metis 当前不保存 Token、私钥等敏感凭据，只保存 `credential_ref` 引用名；真实认证由系统 Git、SSH agent 或 Git credential helper 完成。
4. **可回滚**：任何覆盖本地文件的更新操作必须先创建完整备份。
5. **不自动执行**：Metis 默认不执行 skill 内的任何脚本。安全检查只做静态分析。
6. **软件更新确认**：Metis 可以在启动时只读检查软件版本，但不会自动下载、安装、提权或重启；下载和打开安装包都必须由用户明确触发。

## 安全检查覆盖范围

每次更新前，Security 模块对变更内容进行静态检查，关注以下风险信号：

| 风险类别 | 检查项 | 默认行为 |
|---------|--------|---------|
| 脚本文件 | `.sh`、`.py`、`.js`、`.rb` 等脚本 | `Info` 提醒 |
| 可执行文件 | 文件带可执行权限 | `Info` 提醒 |
| 网络下载后执行 | `curl` / `wget` 通过管道交给 shell | `Warning` 提醒 |
| 敏感路径 | `.ssh`、keychain、`/etc/`、`.aws`、`.config/gh` 等 | `Warning` 提醒 |
| 疑似密钥字面量 | 私钥块或明显的长 token/secret 值 | `Warning` 提醒 |

### 安全等级定义

- **Info**：脚本或可执行文件等需要用户知情的内容。
- **Warning**：网络执行、敏感路径或疑似密钥字面量。
- **High**：Core 已保留阻断等级，但当前内置扫描规则尚未生成 High finding。

### Skill 自动更新策略

- 默认：所有来源 `auto_update = false`。
- 用户标记为 `trusted` 后，可开启自动更新。
- 受控自动更新只处理 `trusted && auto_update && 本地未修改` 的 Skill。
- 手动更新会返回安全 findings 并在界面中以温和文案提示；当前 Warning 不自动阻断手动更新。
- 远端安装链路会阻断 `High` finding；破坏性本机脚本的更强识别与统一阻断策略仍属于待加固项。

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

### 通过系统 Git 可用的认证方式

以下认证由用户本机 Git / SSH 配置提供，Metis 不保存、签发或直接校验对应凭据：

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
- **软件分发边界**：GitHub Release 元数据和安装包在通过内置 Tauri updater 公钥校验前不可信任；即使通过该校验，也不等同于获得操作系统代码签名信任。

## 报告安全漏洞

如果你发现安全漏洞，请优先使用仓库的 [GitHub Security Advisories](https://github.com/wylycool/metis/security/advisories/new) 私下报告。若私密报告入口不可用，请只在公开 Issue 中请求维护者提供私下联络方式，不要公开漏洞细节、PoC、token、私钥或真实本机路径。

## 依赖安全

- Rust 依赖通过 `cargo audit` 定期检查。
- 前端依赖通过 `npm audit` / `pnpm audit` 定期检查。
- Git 操作使用系统 `git` CLI，并通过固定参数、非交互环境和受控 command runner 降低命令与凭据交互风险。

## 构建与分发安全

- Release 构建通过 GitHub Actions 自动化，构建日志公开可审计。
- Metis 使用 Tauri updater 长期密钥分别签名标准 DMG、NSIS EXE 和 AppImage；应用只接受与内置公钥匹配的安装包。
- updater 私钥和密码只允许存在于维护者的加密备份与 GitHub Actions Secrets，不得进入仓库、构建产物或日志。私钥备份是发布首个携带 updater 的版本前的硬门槛。
- `latest.json` 使用固定 GitHub Releases endpoint，内嵌各平台安装包签名，并在标准安装包和 `.sig` 资产上传完成后最后发布。
- `latest.json` 本身不作为可任意指路的信任根：客户端只接受本仓库 `desktop-v<version>` tag 下、文件名与 manifest 版本及当前平台完全一致的 HTTPS 资产，并要求 Tauri 签名可信注释中的 `file:` 同样匹配该文件名。
- 下载完成回调不代表验签完成；只有 Tauri 验签成功且安装包完整写入系统 Downloads 后，界面才允许打开文件。保存时记录内容 SHA-256，打开前重新核对，拒绝已被替换或修改的 Downloads 文件。
- Metis 在最终文件出现前保留系统下载来源标记：macOS 使用 `com.apple.quarantine`，Windows 使用 Internet Zone 的 `Zone.Identifier`（MOTW）；写入失败会清理临时文件并停止保存，打开前还会在哈希通过后重新写入。该机制用于保留 Gatekeeper / SmartScreen 提示，不用于绕过系统保护。
- 当前通过 GitHub Releases 分发的 macOS 安装包尚未进行 Developer ID 签名和公证。
- 当前通过 GitHub Releases 分发的 Windows 安装包尚未进行 Authenticode 签名。
- Tauri 更新签名用于确认安装包来自 Metis 更新通道且内容未被篡改，不能消除 macOS Gatekeeper 或 Windows SmartScreen 的未知开发者提示。
- 重跑旧稳定 tag 不得把它重新设为 GitHub latest；发布 workflow 只允许不低于当前 latest 的稳定版本更新固定通道。
- 构建产物提供 SHA256 校验和。

## 隐私承诺

- Metis 不收集任何遥测数据。
- Metis 不上传 Skill 内容、本地路径、Settings、索引、备份、审计或行为数据。
- Metis 不包含任何形式的用户行为追踪。
- 启用“启动时检查软件更新”时，Metis 会访问固定 GitHub Releases 元数据地址；GitHub 可能获得普通 HTTPS 连接产生的 IP、User-Agent 等网络元数据。用户可以关闭该启动检查。
- 除可关闭的软件版本检查外，Git 访问、安装包下载、Skill 更新和其他远端交互仍由用户明确触发；软件检查和下载不会携带本机 Skill 或来源信息。
