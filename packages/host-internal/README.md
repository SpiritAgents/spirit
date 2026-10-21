# @spiritagent/host-internal

Shared **host-side implementation** for [Spirit](https://github.com/SpiritAgents/spirit). It sits between platform hosts (Desktop, CLI, ACP server) and [`@spiritagent/agent-core`](https://www.npmjs.com/package/@spiritagent/agent-core), providing discovery, workspace helpers, and local execution plumbing.

This package is in a transitional role: it currently still owns the shared host config and credential resolution, and the recorded direction is for it to be gradually hollowed out into `agent-core`. Only the provider presets and the wizard/catalog materialization core have moved so far; the rest follows opportunistically.

## What it provides

- **Discovery** — rules, skills, and workspace instruction metadata for Agent Core system assembly.
- **Tools** — `NodeHostToolService` and related helpers for in-process file, shell, grep/glob, and workspace operations.
- **Extensions** — extension install paths, local ZIP import, and lifecycle management used by Desktop and CLI.
- **LSP orchestration** — language-server probe and diagnostics wiring after file edits.
- **Storage & runtime helpers** — Spirit data directory access, the `config.json` v1 schema and validation, credential channel resolution against the OS keyring, and model listing utilities shared across hosts.

## Product storage

`resolveSpiritDataDir()` resolves shared storage from `SPIRIT_DATA_DIR`, otherwise from the user home and the build's `product.userDataFolderName`. `resolveWorkspaceDataDir()` uses `product.workspaceDataFolderName`; host-specific daemon and ACP overrides remain scoped to those hosts. Electron's Chromium data is not shared storage.

This is a direct default-root change: there is no old-directory lookup, automatic migration, or dual write. Existing subdirectory layouts and host-specific extension scopes are preserved.

MCP file discovery is supplied through `createHostMcpService(workspaceRoot, spiritDataDir, includeWorkspace, options)`. It injects a configuration source into Agent Core, so a daemon's selected data root is also used for MCP reads. MCP and Hooks path helpers live in this package rather than Agent Core.

## Config and credentials

`config.json` is `schemaVersion: 1`; any other version fails to load. Each `providers[]` entry is fully declarative — `apiBase`, `transportKind`, `sdk`, `headers` / `body`, `providerTools`, `fileUpload`, `options`, plus flat model-level defaults its `models[]` inherit. Unknown keys, unknown `sdk` package names, unknown `credentials` slots, and out-of-range `serviceTier` / `reasoningEffort` / `reasoningMode` selections are fail-fast schema errors; the file is never silently rewritten.

Provider keys resolve through the declared channels in order — `apiKey` (plaintext escape hatch, not recommended), `apiKeyEnv`, `apiKeyKeyring`, then the internal OS keyring (service `Spirit`, account `provider::{id}`; composite credential slots use `provider::{id}::{slot}`). A value that resolves to an empty string falls through to the next channel.

## Model service tier preferences

Each model entry in `config.json` (`providers[].models[]`) may carry an optional `serviceTier` — a canonical Agent Core value: `auto`, `default`, `flex`, `fast`, `priority`, or `ultrafast`. The field is valid only when the model (or its provider entry) declares `serviceTiers`, and the value must be one of the declared tiers; anything else is a fail-fast config error, not a silent rewrite. The declared `serviceTiers` come in two forms: a simple list of tier names (mapped on the wire through a fixed table of public transport API parameters) or a literal tier → `{ headers, body }` map whose declarations apply verbatim.

## Requirements

- Node.js 24+
- [`@spiritagent/agent-core`](https://www.npmjs.com/package/@spiritagent/agent-core) at a matching version

## Related packages

- [`@spiritagent/agent-core`](https://www.npmjs.com/package/@spiritagent/agent-core) — agent runtime, prompts, tool definitions, transports, and the provider preset / catalog materialization zone.
- [`@spiritagent/acp-server`](https://www.npmjs.com/package/@spiritagent/acp-server) — ACP server adapter that depends on this package for local tool execution.

## License

MIT — see the [Spirit repository](https://github.com/SpiritAgents/spirit).
