# 贡献指南 (Contributing Guide)

感谢你对 Metis 的关注！本文档将帮助你了解如何参与项目贡献。

## 项目结构

```
metis/
  README.md                 # 项目概述
  LICENSE                   # MIT 许可证
  SECURITY.md              # 安全策略
  CONTRIBUTING.md          # 本文件
  PROJECT_BLUEPRINT.md     # 项目蓝图
  ARCHITECTURE.md          # 架构文档
  ROADMAP.md              # 路线图
  docs/
    decisions/             # 架构决策记录 (ADR)
    design/                # 详细设计文档
  crates/
    core/                  # Core Engine：扫描、解析、更新、回滚
    adapters/              # Agent Adapters：Codex、Claude Code 等
    git-provider/          # Git 操作封装
    storage/               # SQLite、lock 文件、备份管理
    security/              # 静态安全检查
  apps/
    desktop/               # Tauri 桌面应用 (Phase 2)
  tests/                   # 集成测试
```

## 行为准则

- 尊重所有贡献者的时间和意见。
- 建设性、具体地提出问题和建议。
- 讨论聚焦于技术和项目本身。
- 使用中文或英文均可，优先使用中文。

## 如何贡献

### 报告 Bug

1. 在 GitHub Issues 中搜索是否已有相同问题。
2. 如果没有，创建新 Issue，包含：
   - 操作系统和版本
   - Metis 版本
   - 复现步骤
   - 预期行为 vs 实际行为
   - 相关日志（注意移除敏感信息）
3. 如果是安全相关，请参阅 [SECURITY.md](SECURITY.md)。

### 提出新功能

1. 先检查 [ROADMAP.md](ROADMAP.md) 确认是否已在规划中。
2. 阅读 [PROJECT_BLUEPRINT.md](PROJECT_BLUEPRINT.md) 中的非目标部分。
3. 在 Issue 中描述：
   - 这个功能解决什么问题
   - 建议的实现方式
   - 是否愿意自己实现

### 贡献代码

1. **Fork 仓库**
2. **创建功能分支**：`feature/xxx` 或 `fix/xxx`
3. **遵循代码风格**：
   - Rust：`cargo fmt` + `cargo clippy`
   - TypeScript：通过项目 ESLint + Prettier 配置
4. **编写测试**：
   - Core Engine 的改动必须有单元测试
   - 新增 adapter 必须覆盖路径发现和元数据解析
5. **确保测试通过**：`cargo test`
6. **提交 Pull Request**：
   - 清楚描述改动内容和原因
   - 关联相关 Issue
   - 如果是新功能，更新相关文档

### 贡献 Adapter

Adapter 是最适合外部贡献的模块。新增 Agent 支持时：

1. 实现 `Adapter` trait 的所有方法。
2. 在 adapter 目录下创建独立模块。
3. 提供该 Agent 的路径发现逻辑。
4. 提供 `SKILL.md` 解析逻辑（如有差异）。
5. 在 adapter 注册表中注册。
6. 更新文档说明新增支持。

Adapter trait 接口定义见 [docs/design/adapter-interface.md](docs/design/adapter-interface.md)。

## 开发环境设置

### 前置依赖

- Rust (stable, 通过 rustup 安装)
- Node.js 18+
- pnpm (推荐)
- Tauri CLI（桌面应用开发时）
- Git

### 初始化

```bash
# 克隆仓库
git clone <repo-url>
cd metis

# 构建 Core Engine
cargo build

# 运行测试
cargo test

# 桌面应用开发 (Phase 2+)
cd apps/desktop
pnpm install
pnpm tauri dev
```

## 测试策略

- **单元测试**：每个 crate 内的单元测试。
- **集成测试**：Core Engine + Adapter + Storage 的集成测试。
- **端到端测试**：模拟真实 skill 安装、更新、回滚流程（Phase 2+）。

CI 会对每个 PR 运行：
- `cargo test`
- `cargo fmt --check`
- `cargo clippy -- -D warnings`
- `cargo audit`

## 文档贡献

文档同样重要！你可以帮助：

- 修正文档错误和过时内容。
- 补充用户指南。
- 翻译文档（中英双语）。
- 改进代码注释。

## 沟通渠道

| 用途 | 渠道 |
|------|------|
| Bug 报告、功能请求 | GitHub Issues |
| 讨论、问题 | GitHub Discussions |
| 安全漏洞报告 | 见 [SECURITY.md](SECURITY.md) |

## 许可证

贡献的代码将采用与项目相同的 [MIT 许可证](LICENSE)。提交 PR 即表示你同意此条款。
