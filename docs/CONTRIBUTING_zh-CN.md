# 为 Spirit 贡献

[English](../CONTRIBUTING.md) · [繁體中文](CONTRIBUTING_zh-TW.md) · [日本語](CONTRIBUTING_ja.md) · [한국어](CONTRIBUTING_ko.md) · [Deutsch](CONTRIBUTING_de.md) · [Français](CONTRIBUTING_fr.md) · [Español](CONTRIBUTING_es.md) · [Português do Brasil](CONTRIBUTING_pt-BR.md) · [Русский](CONTRIBUTING_ru.md)

感谢你对 Spirit 的关注！本项目是一个开源的工具型编程智能体 monorepo，包含 Desktop（Electron）、CLI（Rust）、共享 daemon（`packages/server`）以及核心运行时（`packages/agent-core`）。无论是修订文档、修复缺陷，还是开发新功能，我们都欢迎你的帮助。如果不确定从哪里开始，可以开一个 Issue，打个招呼。

## 贡献之前

**较大的变更请先开 Issue**，以便在你投入大量精力之前，我们能先对齐方向。例如：

- 新功能或较大的用户体验变更
- 公开 API、协议，或配置 / 持久化格式的变更
- 跨越多个包的重构
- 会改变智能体行为的提示词、工具契约或上下文注入变更

**较小的变更可以直接提交 Pull Request**，例如：

- 文档、README 或注释更新
- 拼写与样式修复
- 行为影响清楚、范围有限的针对性缺陷修复

若不确定，先开一个简短的 Issue，通常比一份需要返工的大型 PR 更快。

## 借助智能体编码

欢迎使用 Cursor、Copilot 或其他智能体工具编写代码——但**你仍然要对所提交的 diff 负责**：

- 要能说明一项变更为何而做，而不只是模型生成了它
- 审阅智能体的输出：去掉无关编辑、重复逻辑和不必要的防御层
- 对**模型可见文案**（系统提示词、工具名称/描述、评测文本）格外谨慎——保持简洁、使用英文，并避免重复请求 `tools` 字段中已经声明的能力
- 在 PR 描述中说明动机、影响，以及你如何验证了这项变更

智能体可以加快实现；它们不能替代你的判断。

## 架构与范围

Spirit 有清晰的分层模型。在改动多个包之前，请先阅读 [`.github/instructions/agent-core-host-boundary.instructions.md`](../.github/instructions/agent-core-host-boundary.instructions.md)：

| 层级          | 路径                                                                              | 职责                                  |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------- |
| 智能体语义    | `packages/agent-core`                                                             | 运行时、提示词、工具契约、MCP、传输层 |
| 共享宿主逻辑  | `packages/host-internal`                                                          | 发现、扩展、工作区辅助、LSP 编排      |
| 宿主 / 适配器 | `apps/desktop`、`apps/cli`、`apps/site`、`packages/server`、`packages/acp-server` | 薄的、平台相关的 UI 与执行            |

不要在 CLI 与 Desktop 之间重复工具定义或提示词。新的工具契约属于 `agent-core`；执行属于宿主。

## 开发环境

**环境要求：** Node.js 24+、pnpm 12+（`corepack enable`），以及 Rust 工具链（用于 CLI）。

```bash
pnpm install          # 一次，在仓库根目录
pnpm run dev:desktop  # Desktop（Vite + Electron）
pnpm run dev:site     # 营销/文档站（Next.js）
pnpm run dev:cli      # 带 TUI 的 CLI
pnpm run build        # TS 包 + Desktop + site + CLI 的生产构建
```

在 `pnpm run dev:desktop` 期间，包源码的变更无需手动重新构建：渲染器所消费的包直接由其 TypeScript 源码提供（HMR）；Electron 主进程的变更会经由 watch 任务重新构建，并自动重启应用。

| 命令                        | 说明                             |
| --------------------------- | -------------------------------- |
| `pnpm run dev:desktop:web`  | Desktop 渲染器 + 浏览器 Web 宿主 |
| `pnpm run dev:site`         | 营销/文档站（Next.js）           |
| `pnpm run build:agent-core` | 仅构建 `@spiritagent/agent-core` |
| `pnpm run build:cli`        | Rust CLI 的发布构建              |
| `pnpm run eval:compare`     | agent-core 变更后的 eval 对比    |

详见 [README.md — 开发](README_zh-CN.md#开发)，以及各应用或包 README 中的具体说明。

## Git 钩子

在仓库根目录执行 `pnpm install` 会运行 `prepare`，将本地 `core.hooksPath` 设为 `.githooks`。这些钩子只检查 index，从不改写文件：

- **pre-commit：** 对 `packages` / `apps/desktop` / `apps/site` 下已暂存的 TypeScript 运行 `oxlint --deny-warnings`；当暂存文件包含 TypeScript 或文档时运行 `oxfmt --check`（其他一并暂存的可格式化路径也会带上）；对已暂存的 `apps/cli` `.rs` 文件运行 `cargo fmt --check`；对已暂存的 blob 检查不可见 Unicode（`scripts/check-invisible-unicode.py --staged`）
- **commit-msg：** 若首行已经形如 `type:` / `type(scope):`，则要求 `:` 之后有空格，且多 scope 列表中每个逗号之后有空格。Merge、revert、中文以及其他自由形式的 subject 不会被拒绝

`git commit --no-verify` 会跳过这些钩子；仅将其作为应急手段。从未运行 `pnpm install` 的纯 Rust clone，可以用 `git config core.hooksPath .githooks` 或 `node scripts/setup-git-hooks.mjs` 启用同一路径。

## 进行变更

1. Fork 本仓库，并从 `main` 创建功能分支
2. 保持提交聚焦，diff 便于审阅
3. 力求跨平台兼容（Windows、macOS、Linux），必要时使用条件编译
4. Spirit 正处于活跃的早期开发阶段——更改配置或持久化格式时，优先采用直接、可演进的结构，而不是沉重的兼容垫片；若属于破坏性变更，请在 PR 中说明理由与迁移路径

## 分支名

当变更范围限定在**单个**应用或包时，使用 `{type}/{scope}/{description}`（三段，以斜杠分隔）。**不要**写成 `{type}/{scope}-{description}`。

- `type`：Conventional Commits 类型（`feat`、`fix`、`refactor`、`style`、`chore`、`ci` 等）
- `scope`：应用或包（`desktop`、`cli`、`site`、`agent-core` 等），与提交信息中的 `scope` 一致
- `description`：简短的 kebab-case 摘要

✅ `fix/desktop/align-message-bubble-chips`

❌ `fix/desktop-align-message-bubble-chips`

涉及多个应用或包的横切变更省略 scope 段：`{type}/{description}`。

## 提交信息

本项目使用 [Conventional Commits](https://www.conventionalcommits.org/)：

- `type` 与可选的 `scope` 使用英文（例如 `feat(desktop)`、`fix(agent-core)`）
- **Subject 与 body 使用英文**；subject 为一行，末尾不加句号
- Body 为可选；若写 body，选用适合该变更的格式：用 `-` 列表（每行一项）概括要点，或在需要说明理由时写成连续的散文段落

示例：

```
feat(desktop): pin sidebar toggle beside traffic lights on macOS

- Fixed sidebar toggle beside hiddenInset traffic lights when not fullscreen
- Fullscreen falls back to inline top-bar layout via spirit-desktop-darwin-fullscreen
```

维护者与智能体侧的提交约定见 [AGENTS.md](../AGENTS.md)。

## 测试与 CI

每次 push 都会运行 [Verify 工作流](../.github/workflows/verify.yml)：

- `pnpm turbo run build`（TypeScript 包、Desktop 与 site）
- `pnpm exec oxlint --deny-warnings packages apps/desktop apps/site` 以及 `pnpm exec oxfmt --check packages apps/desktop apps/site`
- CLI 的 `cargo build`、`cargo fmt --check`、`cargo clippy -D warnings` 与 `cargo test`

开 PR 之前，在相关时于本地运行：

```bash
pnpm run build
pnpm run lint        # oxlint --deny-warnings packages apps/desktop apps/site
pnpm run format      # oxfmt --check packages apps/desktop apps/site
pnpm run lint:fix && pnpm run format:fix  # 提交之前
pnpm --filter @spiritagent/agent-core test   # 如果改了 agent-core
cargo test -p spirit                   # 如果改了 CLI
cargo fmt -p spirit --check
cargo clippy -p spirit -- -D warnings
pnpm run eval:compare                        # 如果改了模型可见的 agent-core 行为
```

## Agent-core 与模型可见变更

对系统提示词、工具定义或上下文注入的变更，可能影响所有宿主上的智能体行为。对于较大幅度的编辑：

- 运行 `pnpm run eval:compare` 并查看结果
- 默认将 LLM 可见文案保持为英文
- 遵循 [`.github/instructions/llm-visible-copy.instructions.md`](../.github/instructions/llm-visible-copy.instructions.md)

小的措辞修正、拼写修正，或非模型可见的重构，通常不需要跑完整 eval。

## Pull Request

- 使用清晰的标题和描述：**改了什么**、**为什么**，以及**如何测试**
- 当 PR 旨在关闭某个 Issue 时，在描述末尾单独写一行 `Closed #N` 或 `Fixed #N`（上方留一空行）。见 [AGENTS.md](../AGENTS.md#pull-requests-that-close-issues)
- 保持 diff 聚焦——无关的清理放到单独的 PR
- 及时回应审阅意见

## 延伸阅读

- [AGENTS.md](../AGENTS.md) — 架构说明、LLM 约定，以及上下文 push/pull 策略
- [apps/desktop/README.md](../apps/desktop/README.md)
- [apps/site/README.md](../apps/site/README.md)
- [packages/agent-core/README.md](../packages/agent-core/README.md)

## 许可证

参与贡献即表示你同意自己的贡献将按 [MIT License](../LICENSE) 授权。
