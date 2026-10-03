# @spiritagent/host-internal

Shared **host-side implementation** for [Spirit](https://github.com/SpiritAgents/spirit). It sits between platform hosts (Desktop, CLI, ACP server) and [`@spiritagent/agent-core`](https://www.npmjs.com/package/@spiritagent/agent-core), providing discovery, workspace helpers, and local execution plumbing.

## What it provides

- **Discovery** — rules, skills, and workspace instruction metadata for Agent Core system assembly.
- **Tools** — `NodeHostToolService` and related helpers for in-process file, shell, grep/glob, and workspace operations.
- **Extensions** — extension install paths, local ZIP import, and lifecycle management used by Desktop and CLI.
- **LSP orchestration** — language-server probe and diagnostics wiring after file edits.
- **Storage & runtime helpers** — Spirit data directory access, provider presets, and model listing utilities shared across hosts.

## Product storage

`resolveSpiritDataDir()` resolves shared storage from `SPIRIT_DATA_DIR`, otherwise from the user home and the build's `product.userDataFolderName`. `resolveWorkspaceDataDir()` uses `product.workspaceDataFolderName`; host-specific daemon and ACP overrides remain scoped to those hosts. Electron's Chromium data is not shared storage.

This is a direct default-root change: there is no old-directory lookup, automatic migration, or dual write. Existing subdirectory layouts and host-specific extension scopes are preserved.

MCP file discovery is supplied through `createHostMcpService(workspaceRoot, spiritDataDir, includeWorkspace, options)`. It injects a configuration source into Agent Core, so a daemon's selected data root is also used for MCP reads. MCP and Hooks path helpers live in this package rather than Agent Core.

## Requirements

- Node.js 24+
- [`@spiritagent/agent-core`](https://www.npmjs.com/package/@spiritagent/agent-core) at a matching version

## Related packages

- [`@spiritagent/agent-core`](https://www.npmjs.com/package/@spiritagent/agent-core) — agent runtime, prompts, tool definitions, and transports.
- [`@spiritagent/acp-server`](https://www.npmjs.com/package/@spiritagent/acp-server) — ACP server adapter that depends on this package for local tool execution.

## License

MIT — see the [Spirit repository](https://github.com/SpiritAgents/spirit).
