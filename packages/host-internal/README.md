# @spiritagent/host-internal

Shared **host-side implementation** for [Spirit](https://github.com/SpiritAgents/spirit). It sits between platform hosts (Desktop, CLI, ACP server) and [`@spiritagent/agent-core`](https://www.npmjs.com/package/@spiritagent/agent-core), providing discovery, workspace helpers, and local execution plumbing.

## What it provides

- **Discovery** — rules, skills, and workspace instruction metadata for Agent Core system assembly.
- **Tools** — `NodeHostToolService` and related helpers for in-process file, shell, grep/glob, and workspace operations.
- **Extensions** — extension install paths, local ZIP import, and lifecycle management used by Desktop and CLI.
- **LSP orchestration** — language-server install, probe, and diagnostics wiring after file edits.
- **Storage & runtime helpers** — Spirit data directory access, provider presets, and model listing utilities shared across hosts.

## Requirements

- Node.js 24+
- [`@spiritagent/agent-core`](https://www.npmjs.com/package/@spiritagent/agent-core) at a matching version

## Related packages

- [`@spiritagent/agent-core`](https://www.npmjs.com/package/@spiritagent/agent-core) — agent runtime, prompts, tool definitions, and transports.
- [`@spiritagent/acp-server`](https://www.npmjs.com/package/@spiritagent/acp-server) — ACP server adapter that depends on this package for local tool execution.

## License

MIT — see the [Spirit repository](https://github.com/SpiritAgents/spirit).
