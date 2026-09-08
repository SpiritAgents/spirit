<div align="center">

# Spirit

An open-source AI agent built to multiply your productivity.

[Desktop app](#desktop) · [Site](#site) · [CLI](#cli) · [Server](#server) · [ACP Server](#acp-server) · [Agent Core](#agent-core) · [Development](#development)

> This project is under active development. Behavior and APIs may change between releases.

[简体中文](docs/README_zh-CN.md) · [繁體中文](docs/README_zh-TW.md) · [日本語](docs/README_ja.md) · [한국어](docs/README_ko.md) · [Deutsch](docs/README_de.md) · [Français](docs/README_fr.md) · [Español](docs/README_es.md) · [Português do Brasil](docs/README_pt-BR.md) · [Русский](docs/README_ru.md)

<img width="1552" height="1032" alt="Spirit Desktop" src="https://github.com/user-attachments/assets/7b07e79d-c800-405a-bee6-40dda9d75b13" />

</div>

## Overview

Spirit is a **tool-using coding agent** that runs against a real project root. The same runtime powers a native desktop workspace and a terminal UI. Shared logic lives in TypeScript packages; hosts add platform-specific execution, discovery, and UI.

```
┌───────────────────────────────────────────────────────┐
│  Hosts                                                │
│     ┌────────────────────────┐ ┌────────────────┐     │
│     │   Desktop       CLI    │ │   ACP Server   │     │
│     │  (Electron)    (Rust)  │ │ stdio / ndJSON │     │
│     └──────┬────────────┬────┘ └────────┬───────┘     │
│            └────────────┘               │             │
│                  ▼                      │             │
│           packages/server               │             │
│    sessions, streaming, approvals       │             │
│                  │                      │             │
│                  ▼                      │             │
│        packages/host-internal           │             │
│     discovery, tools, workspace  ◀──────┘             │
│                  │                                    │
│                  ▼                                    │
│         packages/agent-core                           │
│   runtime, prompts, tool contracts                    │
└───────────────────────────────────────────────────────┘
```

## Agent Core

[`packages/agent-core`](packages/agent-core) is the **single source of agent semantics** in this repository. Hosts consume it.

### Runtime and modes

- **Turn machine** — streaming assistant output, tool rounds, compaction, and context usage tracking.
- **Agent / Plan / Ask / Debug modes** — full tool access, planning-only workflows, read-only Q&A with edit tools stripped at the contract layer, or structured debugging with log-point hypotheses.
- **Subagents** — `subagent` delegates focused work to child runs with their own tool surface.
- **Loop control** — optional `finish_task` when multitask-style looping is enabled.
- **Rewind-friendly history** — message archive formats designed for host-side rollback and resubmit.

### Model transports

Agent Core routes inference through multiple transports behind one runtime:

| Transport             | Typical providers                                                  |
| --------------------- | ------------------------------------------------------------------ |
| **OpenAI-compatible** | OpenAI, DeepSeek, Moonshot, MiniMax, Volcengine, custom endpoints  |
| **Open Responses**    | OpenAI, SpaceXAI, Vercel AI Gateway, OpenRouter, Alibaba (Bailian) |
| **Anthropic**         | Claude via Messages API                                            |

Provider-native capabilities (for example web search on Open Responses, Alibaba built-in search and code interpreter) are injected through the request `tools` field.

### Host tool contracts

Built-in tools are defined once in Agent Core (name, description, JSON Schema). Hosts implement execution:

- **Workspace** — `read_file`, `write_file` / `create_file` / `edit_file` / `delete_file`, `apply_patch` (V4A on supported transports), `glob`, `grep`, `ls`
- **Shell** — `shell` with host-controlled approval
- **Web** — `web_fetch`; search via provider tools or host search where configured
- **Delegation** — `subagent`
- **Planning** — `create_plan`, session TODO tools (`todo_list`, `todo_write`)
- **Multimodal** — `generate_image`, `generate_video`
- **Dreams** — `dream_list`, `dream_read`, `dream_record`, `dream_update`, `dream_delete` for workspace memory summaries
- **LSP** — language-server diagnostics surfaced after edits

### System context assembly

Agent Core owns how the model sees project context:

- **Rules** — `AGENTS.md`, `.spirit/rule.md`, and user rule slots merged into system sections.
- **Skills** — catalog and active-skill injection; hosts discover files on disk.
- **MCP** — Model Context Protocol client, registry, and tool/resource/prompt bridging.
- **Mode prompts** — Agent, Plan, Ask, and Debug boundaries without re-listing tools in system text.

### Quality and evaluation

- **Smoke suites** — contract, runtime, and live provider checks under `packages/agent-core/src/smoke`.
- **Eval harness** — scenario comparison and judging for prompt or tool-definition changes (`pnpm run eval:compare` from the repo root).

`@spiritagent/agent-core` is published to npm; [`packages/host-internal`](packages/host-internal) holds shared host-side discovery, extensions, workspace helpers, and LSP orchestration used by Desktop.

## Desktop

The [Desktop app](apps/desktop) is the primary graphical host: a workspace-bound IDE surface with a conversational agent.

- **Docked panels** — file explorer with Monaco editor, embedded terminal (Electron), Git changes and history, in-app browser for local dev servers.
- **Sessions** — multi-conversation history, worktree-per-session workflows, tool approval, subagent viewer, structured questionnaires, context usage, and rewind.
- **Configuration** — model providers and API keys, Skills and Rules, MCP servers, extensions, Dreams (beta), LSP, themes, and UI locale (10 languages including English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Français, Español, Português do Brasil, and Русский).
- **Platforms** — Electron on Windows, macOS, and Linux; optional web host with remote pairing.

See [apps/desktop/README.md](apps/desktop/README.md) for Desktop-specific development and layout.

## Site

The [marketing and docs site](apps/site) is a Next.js + Fumadocs app (`@spiritagent/site`), deployed on Vercel.

```bash
pnpm run dev:site
```

See [apps/site/README.md](apps/site/README.md) for local development and the Vercel Git switch checklist.

## CLI

<img width="1014" height="744" alt="Spirit CLI" src="https://github.com/user-attachments/assets/ecf4fcec-6a9b-4562-b0da-cc14816f36d3" />

The [Rust CLI](apps/cli) (`spirit`) provides a terminal-first host with an optional Ratatui UI. It connects to the shared Spirit Server daemon over WebSocket and suits scripting, SSH sessions, and minimal environments.

```bash
pnpm run dev:cli    # cargo run -p spirit
```

## Server

[`packages/server`](packages/server) (`@spiritagent/server`, bin `spirit-server` / `spirit serve`) is the **shared daemon backend** for first-party hosts. Instead of embedding a runtime in-process, CLI and Desktop attach to the same daemon over WebSocket (JSON-RPC 2.0) — so a session started in the terminal streams live into Desktop, and vice versa.

- **Single source of truth** — sessions, streaming events, tool execution, and approval queues live in the daemon; clients render and send input.
- **Random-port instances** — binds `127.0.0.1` on an OS-assigned port and registers under `{spiritDataDir}/server/instances/`; clients attach to a live instance or spawn one. `spirit-server ps` / `kill` manage instances.
- **Bearer auth** — home-level token at `{spiritDataDir}/server.token` (mode 0600), accepted via `Authorization` header or `?token=` query; `spirit-server rotate-token` rotates it for new connections.
- **No new dependencies** — the WebSocket layer (RFC 6455) is implemented in-package.

The **CLI and Desktop are daemon-only** for agent execution (see [Epic #274](https://github.com/SpiritAgents/spirit/issues/274)). Desktop Web Host clients receive authenticated snapshot pushes from the Desktop host while agent execution remains in the daemon. Remote access (`--hostname 0.0.0.0`) is reserved for a future phase and off by default.

## ACP Server

[`packages/acp-server`](packages/acp-server) is a thin adapter that exposes Spirit as an [Agent Client Protocol](https://agentclientprotocol.com) (ACP) server over stdio / ndJSON. Any ACP-compatible editor — such as **Zed** or **JetBrains Junie** — can connect to Spirit as its AI coding engine without bespoke integration.

- **Terminal Auth** — `initialize` advertises a `type: "terminal"` auth method; clients run `spirit-acp --setup` for interactive provider configuration, then call `authenticate` before `session/new`.
- **Protocol surface** — `initialize`, `authenticate`, `logout`, `session/new`, `session/prompt`, `session/cancel`, `session/close`, `session/set_mode`.
- **Streaming & thinking** — real-time `agent_message_chunk` streaming and `agent_thought_chunk` for model reasoning output.
- **Permission bridge** — tool approval via ACP `request_permission` with allow-once / always-allow / reject options.
- **Slash commands** — workspace and user Skills are advertised as `available_commands_update`; typing `/skill-name` activates the skill and injects its instructions into the system prompt.
- **Local execution** — tools run in-process via `NodeHostToolService` (no JSON-RPC peer over stdio, which is reserved for ACP ndJSON).

### Quick start (Zed)

1. Build the server: `pnpm run build:acp-server`
2. Add to your Zed `settings.json` (no API key in `env`):

```json
"agent_servers": {
  "Spirit": {
    "command": "node",
    "args": ["path/to/packages/acp-server/dist/src/stdio-entry.js"]
  }
}
```

3. When the client prompts for authentication, choose **Run in terminal**. It spawns `--setup`, where you pick a provider, enter credentials, and select a model.
4. Setup writes to the shared Spirit data directory (`config.json` + OS keyring — same store as Desktop/CLI). After setup completes, the client calls `authenticate`, then `session/new`.

Manual setup (outside the editor):

```bash
node path/to/packages/acp-server/dist/src/stdio-entry.js --setup
```

| Environment variable   | Required | Description                                                             |
| ---------------------- | -------- | ----------------------------------------------------------------------- |
| `SPIRIT_ACP_WORKSPACE` | No       | Workspace root (default: `cwd` from client)                             |
| `SPIRIT_ACP_DATA_DIR`  | No       | Spirit data directory (default: `%APPDATA%/Spirit` or `~/.spirit-data`) |

## Development

**Requirements:** Node.js 24+, pnpm 11+ (enable via `corepack enable`). Rust toolchain required for CLI builds.

| Command                    | Description                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm install`             | Install workspace dependencies (run once at repo root)                               |
| `pnpm run dev:desktop`     | Build shared packages and start Desktop (Vite + Electron)                            |
| `pnpm run dev:desktop:web` | Desktop renderer with browser web host                                               |
| `pnpm run dev:site`        | Start the marketing/docs site (Next.js)                                              |
| `pnpm run dev:cli`         | CLI with TUI                                                                         |
| `pnpm run build`           | Production build of agent-core, host-internal, server, acp-server, Desktop, and site |
| `pnpm run eval:compare`    | Run eval comparison after agent-core changes                                         |

### Repository layout

```
apps/
  desktop/           Electron + React host
  site/              Marketing and docs site (Next.js, Vercel)
  cli/               Rust CLI and TUI
packages/
  agent-core/        Agent runtime, prompts, tool definitions, transports, MCP, eval
  host-internal/     Shared host discovery, tools, extensions, LSP helpers
  server/            Shared daemon backend (WebSocket + JSON-RPC) for CLI / Desktop / Web
  acp-server/        ACP (Agent Client Protocol) server adapter for editor integration
scripts/             Release, eval, and repo automation
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started. For architecture boundaries, commit conventions, and agent-core guidelines, also read [AGENTS.md](AGENTS.md). To report security issues, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
