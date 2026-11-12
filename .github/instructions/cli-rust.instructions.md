---
applyTo: "apps/cli/**/*.rs"
---

# Spirit — Rust CLI (`apps/cli`)

## Code Style

- Prefer the existing Rust style: `anyhow::Result`, explicit error context, clear enum dispatch and `match` structures.
- Keep changes localized; avoid rearranging unrelated code for formatting.
- Refer to existing patterns in these files: `apps/cli/src/main.rs`, `apps/cli/src/host_runtime.rs`, `apps/cli/src/ports.rs`, `apps/cli/src/daemon/`, `apps/cli/src/runtime_sync.rs`, `apps/cli/src/tui.rs`, `apps/cli/src/ui.rs`.

## Architecture (within this directory)

- `apps/cli/src/ports.rs` defines the core abstraction interfaces; prefer extending capabilities through ports instead of scattering implementation details into upper layers.
- `apps/cli/src/daemon/` carries the WebSocket connection between the CLI and `@spiritagent/server`; `apps/cli/src/host_protocol/` defines the daemon event/snapshot protocol types; `apps/cli/src/runtime_sync.rs` projects the protocol into TUI state; `apps/cli/src/host_runtime.rs` handles runtime events and tool UI formatting that the host still reuses.
- `apps/cli/src/main.rs` is the CLI entry point and subcommand dispatch; `apps/cli/src/tui.rs` and `apps/cli/src/ui.rs` handle the interactive interface.
- The TypeScript domain packages are the shared behavior baseline. Provider/Model configuration, MCP writes, Skill activation, stored sessions, fork/rewind, tool execution, and other cross-platform domain behavior must go through typed daemon RPC.
- `packages/agent-core` owns MCP protocol and model-visible semantics; `packages/mcp` owns Host configuration and workspace registries. Do not recreate either in Rust.
- Rust retains clap parsing, terminal forms and rendering, TUI projection, signal handling, CLI argument precedence, and daemon discovery/startup. Do not add silent local business-logic fallbacks or direct Node helper paths when the daemon is unavailable.
- Locale YAML is generated from `packages/i18n/src/cli-locales` into ignored `apps/cli/target/i18n` by `build.rs`. Edit the canonical JSON resources, not generated YAML.
- Domain failures may carry `error.data.domainError`; map its stable code and safe parameters to CLI locale strings without exposing secrets. Preserve unknown system errors instead of inventing domain codes.

See `.github/instructions/agent-core-host-boundary.instructions.md` for package ownership and dependency rules.

## Build and Test

- Run Rust commands from the repo root by default: `cargo check -p spirit`, `cargo test -p spirit` (or `cd apps/cli` first and use the local `cargo check`).
- This repo enables the `tui` feature by default; when touching UI code, make sure your changes do not break the default build path.
- After modifying the CLI, runtime, or toolchain, prefer running `cargo test` once, with `cargo check` for verification when needed.

## Conventions

- Prefer cross-platform compatibility, especially Windows-related branches and conditional compilation.
- When modifying async streams, polling loops, or tool execution paths, avoid introducing blocking waits or unnecessary global state.
