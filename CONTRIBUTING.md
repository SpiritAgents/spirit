# Contributing to Spirit

Thank you for your interest in Spirit! This project is an open-source, tool-using coding agent monorepo — Desktop (Electron), CLI (Rust), a shared daemon (`packages/server`), and the core runtime (`packages/agent-core`). Whether you are fixing docs, squashing bugs, or building new features, we welcome your help. If you are unsure where to start, feel free to open an Issue and say hello.

## Before you contribute

**Open an Issue first for larger changes** so we can align on direction before you invest significant effort. Examples:

- New features or substantial UX changes
- Public API, protocol, or config / persistence format changes
- Refactors that span multiple packages
- Prompt, tool contract, or context-injection changes that alter agent behavior

**Smaller changes can go straight to a pull request**, such as:

- Documentation, README, or comment updates
- Spelling and styling fixes
- Focused bug fixes with clear, limited behavioral impact

When in doubt, a quick Issue is usually faster than a large PR that needs rework.

## Agentic coding

Using Cursor, Copilot, or other agent tools to write code is welcome — but **you are still responsible for the diff you submit**:

- Be able to explain _why_ a change was made, not just that a model produced it
- Review agent output: remove unrelated edits, duplicated logic, and unnecessary defensive layers
- Treat **model-visible copy** (system prompts, tool names/descriptions, eval text) with extra care — keep it concise, in English, and avoid repeating capabilities already declared in the request `tools` field
- In your PR description, state the motivation, impact, and how you verified the change

Agents can speed up implementation; they cannot replace your judgment.

## Architecture and scope

Spirit has a clear layering model. Before touching multiple packages, read [`.github/instructions/agent-core-host-boundary.instructions.md`](.github/instructions/agent-core-host-boundary.instructions.md):

| Layer             | Path                                                                              | Role                                                        |
| ----------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Agent semantics   | `packages/agent-core`                                                             | Runtime, prompts, tool contracts, MCP, transports           |
| Shared host logic | `packages/host-internal`                                                          | Discovery, extensions, workspace helpers, LSP orchestration |
| Hosts / adapters  | `apps/desktop`, `apps/cli`, `apps/site`, `packages/server`, `packages/acp-server` | Thin platform-specific UI and execution                     |

Do not duplicate tool definitions or prompts across CLI and Desktop. New tool contracts belong in `agent-core`; execution belongs in the host.

## Development setup

**Requirements:** Node.js 24+, pnpm 11+ (`corepack enable`), and the Rust toolchain (for CLI).

```bash
pnpm install          # once, at the repo root
pnpm run dev:desktop  # Desktop (Vite + Electron)
pnpm run dev:site     # Marketing/docs site (Next.js)
pnpm run dev:cli      # CLI with TUI
pnpm run build        # production build of TS packages + Desktop + site + CLI
```

| Command                     | Description                              |
| --------------------------- | ---------------------------------------- |
| `pnpm run dev:desktop:web`  | Desktop renderer with browser web host   |
| `pnpm run dev:site`         | Marketing/docs site (Next.js)            |
| `pnpm run build:agent-core` | Build `@spiritagent/agent-core` only     |
| `pnpm run build:cli`        | Release build of the Rust CLI            |
| `pnpm run eval:compare`     | Eval comparison after agent-core changes |

See [README.md — Development](README.md#development) and each app/package README for package-specific details.

## Git hooks

`pnpm install` at the repo root runs `prepare`, which sets local `core.hooksPath` to `.githooks`. The hooks check the index only and never rewrite files:

- **pre-commit:** `oxlint --deny-warnings` on staged TypeScript under `packages` / `apps/desktop` / `apps/site`; `oxfmt --check` when staged files include TypeScript or docs (and other formattable staged paths that ride along); `cargo fmt --check` on staged `apps/cli` `.rs` files; invisible Unicode on staged blobs (`scripts/check-invisible-unicode.py --staged`)
- **commit-msg:** if the first line already looks like `type:` / `type(scope):`, require a space after `:` and after each comma in a multi-scope list. Merge, revert, Chinese, and other free-form subjects are not rejected

`git commit --no-verify` skips the hooks; use it only as an escape hatch. A Rust-only clone that never runs `pnpm install` can enable the same path with `git config core.hooksPath .githooks` or `node scripts/setup-git-hooks.mjs`.

## Making changes

1. Fork the repository and create a feature branch from `main`
2. Keep commits focused and diffs reviewable
3. Aim for cross-platform compatibility (Windows, macOS, Linux), including conditional compilation where needed
4. Spirit is in active early development — when changing config or persistence formats, prefer direct, evolvable structures over heavy compatibility shims; if a change is breaking, explain the rationale and migration path in your PR

## Branch names

When the change is scoped to a **single** app or package, use `{type}/{scope}/{description}` (three slash-separated segments). Do **not** write `{type}/{scope}-{description}`.

- `type`: Conventional Commits type (`feat`, `fix`, `refactor`, `style`, `chore`, `ci`, …)
- `scope`: the app or package (`desktop`, `cli`, `site`, `agent-core`, …), matching commit `scope`
- `description`: short kebab-case summary

✅ `fix/desktop/align-message-bubble-chips`

❌ `fix/desktop-align-message-bubble-chips`

Cross-cutting changes that touch multiple apps or packages omit the scope segment: `{type}/{description}`.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

- `type` and optional `scope` in English (e.g. `feat(desktop)`, `fix(agent-core)`)
- **Subject and body in English**; subject is one line, no trailing period
- Body is optional; if present, use a `-` bullet list, one item per line

Example:

```
feat(desktop): pin sidebar toggle beside traffic lights on macOS

- Fixed sidebar toggle beside hiddenInset traffic lights when not fullscreen
- Fullscreen falls back to inline top-bar layout via spirit-desktop-darwin-fullscreen
```

Maintainer and agent-side commit conventions are documented in [AGENTS.md](AGENTS.md).

## Testing and CI

Every push runs the [Verify workflow](.github/workflows/verify.yml):

- `pnpm turbo run build` (TypeScript packages, Desktop, and site)
- `pnpm exec oxlint --deny-warnings packages apps/desktop apps/site` and `pnpm exec oxfmt --check packages apps/desktop apps/site`
- `cargo build`, `cargo fmt --check`, `cargo clippy -D warnings`, and `cargo test` for the CLI

Before opening a PR, run locally when relevant:

```bash
pnpm run build
pnpm run lint        # oxlint --deny-warnings packages apps/desktop apps/site
pnpm run format      # oxfmt --check packages apps/desktop apps/site
pnpm run lint:fix && pnpm run format:fix  # before commit
pnpm --filter @spiritagent/agent-core test   # if you changed agent-core
cargo test -p spirit                   # if you changed the CLI
cargo fmt -p spirit --check
cargo clippy -p spirit -- -D warnings
pnpm run eval:compare                        # if you changed model-visible agent-core behavior
```

## Agent-core and model-visible changes

Changes to system prompts, tool definitions, or context injection can affect agent behavior across all hosts. For substantial edits:

- Run `pnpm run eval:compare` and review the results
- Keep LLM-visible copy in English by default
- Follow [`.github/instructions/llm-visible-copy.instructions.md`](.github/instructions/llm-visible-copy.instructions.md)

Small wording fixes, spelling, or non-model-visible refactors usually do not need a full eval run.

## Pull requests

- Use a clear title and description: **what** changed, **why**, and **how you tested it**
- When the PR is meant to close an Issue, end the description with a standalone last line `Closed #N` or `Fixed #N` (blank line above it). See [AGENTS.md](AGENTS.md#pull-requests-that-close-issues)
- Keep the diff focused — unrelated cleanups belong in a separate PR
- Respond to review feedback in a timely way

## Further reading

- [AGENTS.md](AGENTS.md) — architecture notes, LLM conventions, and context push/pull strategy
- [apps/desktop/README.md](apps/desktop/README.md)
- [apps/site/README.md](apps/site/README.md)
- [packages/agent-core/README.md](packages/agent-core/README.md)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
