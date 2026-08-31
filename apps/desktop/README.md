# Spirit Desktop

**An AI agent built to multiply your productivity** — a native desktop workspace where models read your repo, run tools, and ship changes alongside you.

Spirit Desktop is the graphical host for [Spirit](https://github.com/SpiritAgents/spirit). It pairs a conversational agent with an integrated development surface: file explorer, terminal, Git panel, in-app browser, and Monaco-based editor — all bound to a workspace root so context stays grounded in your project.

## Features

### Conversational agent

- **Agent, Plan, and Ask modes** — full tool access, planning-only workflows, or read-only Q&A.
- **Multi-session history** — open, switch, and delete saved conversations per workspace.
- **Tool approval** — review and allow, deny, or always-trust host tool calls before they run.
- **Subagent viewer** — inspect delegated `subagent` runs in a dedicated overlay.
- **Structured questionnaires** — answer clarifying questions when the host needs input to continue.
- **Context usage** — see how much of the model context window the current thread consumes.
- **Rewind** — roll back recent edits and resubmit from an earlier point in the conversation.

### Workspace tools

Docked panels attach to the active workspace:

| Panel       | Description                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Files**   | Browse and edit workspace files; Markdown preview; plan files under `plans/`.                                                            |
| **Shell**   | Embedded PTY terminal (Electron only).                                                                                                   |
| **Git**     | Working tree changes, commit history graph, commit / push / merge actions, and built-in `/git-commit`, `/git-push`, `/git-merge` skills. |
| **Browser** | Probe local dev servers and browse pages inside the app (Electron only).                                                                 |

**Worktrees** — work in an isolated Git worktree per session; merge back when ready.

### Configuration and extensibility

- **Models** — configure inference providers, API keys, reasoning effort, and a lightweight background model.
- **Skills and Rules** — discover workspace and user-level skills; manage Spirit rule slots (`AGENTS.md`, `.spirit/rule.md`, and user `rule.md`).
- **MCP servers** — add stdio or HTTP Model Context Protocol servers from settings.
- **Extensions** — import ZIP packages from the Extensions page; extensions can contribute tools, Desktop CSS, CLI hooks, and settings pages.
- **Dreams** (beta) — background summarization of recent session trends for the current workspace and branch.
- **LSP** — optional language-server diagnostics after file edits.
- **General** — UI locale (English / 简体中文 / 繁體中文 / 日本語 / 한국어 / Deutsch / Français / Español / Português do Brasil / Русский), system notifications, and tray / menu bar icon.
- **Appearance** — theme, translucency, pointer cursor, font, and macOS font smoothing.

### Platform

- **Electron shell** — native window, system notifications, title-bar integration, and OS terminal fallback.
- **Web host** — optional browser-based UI with remote pairing (`pnpm run dev:web`).
- **Packaged builds** — produce installable artifacts via `electron-builder`.

## Requirements

- **Node.js** 24 or newer
- **pnpm** 11+ (enable via `corepack enable` at the repo root)
- **Rust toolchain** — only when building the CLI from the monorepo root; not required for Desktop-only development after dependencies are built
- **Windows, macOS, or Linux** — Electron targets all three; some features (embedded shell, in-app browser) require the Electron shell

## Development

From the repository root:

```bash
corepack enable
pnpm install
pnpm run dev:desktop
```

This builds shared packages (`agent-core`, `host-internal`, `server`), starts the Vite renderer on `http://127.0.0.1:1420`, and launches Electron.

From `apps/desktop` (after `pnpm install` at the repo root):

```bash
pnpm run dev          # Electron + hot-reload renderer
pnpm run dev:web      # Browser UI + local web host
```

Other useful scripts:

```bash
pnpm run build        # Production renderer + Electron main/preload
pnpm run dist         # Build and package installers (electron-builder)
pnpm run test:lib     # Renderer/unit tests
pnpm run test:host    # Host service tests
```

## Project layout

```
apps/desktop/
  electron/          # Main process, preload, PTY, notifications, browser views
  src/               # React renderer (Vite + Tailwind)
  scripts/           # Build helpers, icon generation
```

Shared logic lives in monorepo packages:

- `packages/agent-core` — agent runtime, tool definitions, prompts
- `packages/host-internal` — host contracts, workspace/git helpers, shared authoring builtin skills

Git sidebar actions (Commit / Push / Merge) send inline prompt text from `src/host/git-chip-prompts.ts` as a normal user turn; they do not activate skills.

## License

See the [repository root LICENSE](https://github.com/SpiritAgents/spirit/blob/main/LICENSE).
