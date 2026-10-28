---
applyTo: "**/*"
---

# Spirit Capability Boundary

## Purpose

This document unifies the responsibility boundaries across `agent-core`, the host-internal library, and the final app layer, so that CLI and Desktop do not each duplicate semantics, prompts, tool contracts, and host details.

There is only one core principle:

`agent-core` is the single Agent capability library; the host-internal library owns host-side discovery, management, and execution details; the app layer only does thin adaptation and UI.

One correction to the old framing: `agent-core` is an **internal** capability library. The hypothetical "agent-core published as a public SDK" premise is abandoned — if a public SDK ever appears, it will be a separate facade package that depends on `agent-core`, not `agent-core` itself. TODO, automations, Dreams, and every other piece of agent logic belong to `agent-core` by default.

## Layering Boundaries

### 1. agent-core

`agent-core` is the single Agent capability library and the only place allowed to carry model-semantic assets.

It owns:

- The main system prompt
- Semantics and assembly of system sections such as Rules / Skills catalog, Agent mode, Extensions, Dreams, Basic info
- The full text of a user-explicitly-activated Skill injected via the `<active_skill>` meta of a user message (not a system section)
- Model-visible definitions of built-in tools: name, description, JSON Schema
- MCP protocol, MCP tool / resource / prompt semantics and runtime integration
- Model-visible contracts of dream tools and collector system prompt semantics
- Generic orchestration capabilities such as Agent runtime, turn machine, streaming, tool rounds
- LLM transports (`openai-compatible` / `open-responses` / `anthropic` / `bedrock`) and the SDK adapter packages behind them
- The provider tool mechanism (`providerTools`): injection, recognition, declared HTTP execution, result rendering
- The file upload mechanism (`fileUpload`): the generic uploader driven by the upload declaration
- Host-facing interface definitions
- **The write-time materialization zone**: `src/provider-presets/` (the built-in preset manifest `provider-presets.json`, its loader, and the materializer), `src/model-catalog/` (catalog parsers named by API shape), and `src/model-knowledge/` (per-model facts keyed by canonical model ID, stored as JSON data). This is where vendor knowledge legitimately lives — it is consumed only at write time (connect wizard, catalog refresh), never read by the runtime request path.

It does not own:

- Scanning the workspace, user directories, AppData, Keyring
- Discovering and enabling `rules`, `skills`, `plan` files
- Managing persisted state of this host metadata
- Directly executing shell, filesystem, web fetching, search
- UI forms, windows, TUI, Electron, Rust host interactions

Conclusion:

`agent-core` owns "what the model sees", "how the runtime consumes these capabilities", and "what the wizard / catalog write into config" — not "how the host wires these capabilities to the local machine".

### 2. Host-Internal Library

The host-internal library is the shared implementation of the Host / UI layer. It is in a transitional role: it currently still owns the shared host config and credentials, and its recorded endgame direction is to be gradually hollowed out into `agent-core`. That hollowing is **not** done in the current change — only the presets and the wizard/catalog materialization core moved to `agent-core`; the rest follows opportunistically.

It owns:

- `config.json` schema, fail-fast validation, load/save (the v1 declarative provider contract)
- Credential channel resolution and the OS keyring (account scheme `provider::{id}` / `provider::{id}::{slot}`)
- Discovery logic for `rules`, `skills`, `plan`
- Enabling, disabling, state persistence, and parsing of this metadata
- The registry of host implementations for built-in tools
- Tool request types, parameter parsing, parameter validation
- Authorization, approval, follow-up questions, host error copy
- Host capability implementations such as search, file read/write, web fetch, shell execution
- Agent Hooks (`hooks.json`) config loading, command script spawn, and timeout/failClosed execution
- Host execution of dream tools, file storage, expiry cleanup, and log persistence
- Platform, path, permission, configuration, and user-directory details

It does not own:

- Redefining a second set of model-visible tool names, tool descriptions, JSON Schemas
- Duplicating the system prompt text
- Re-explaining the semantics of Rules / Skills / Plan to the model
- Provider presets, catalog parsers, or model knowledge (those live in `agent-core`'s materialization zone)
- Replacing `agent-core` as a second "capability library"

Conclusion:

The host-internal library is the implementation-side companion of `agent-core`, not a second Agent Core — and over time it shrinks into it.

### 3. apps

The final app layer keeps only host wiring and UI.

It owns:

- Final entry points such as Rust CLI, Electron, Desktop Web, TUI
- Wiring platform events, UI interactions, and permission confirmation results into the host-internal library
- Wiring the host-internal library into `agent-core`
- Host consumption entry points such as the Desktop dreams settings page, background scheduler, and Commit
- The connect wizard's forms (site / plan / credential form choices) as UI, fed by the preset manifest's data

It does not own:

- Maintaining its own tool contracts
- Maintaining its own system prompt
- Maintaining its own shared discovery / management logic

Conclusion:

Apps must stay as thin as possible to avoid CLI and Desktop diverging again.

### 2.5 server (daemon layer)

`packages/server` is the optional shared backend: it runs the `agent-core` runtime and the host-internal execution surface in a long-lived daemon process, with CLI / Desktop / Web connecting as thin clients over WebSocket (JSON-RPC 2.0).

It owns:

- Session lifecycle and turn orchestration (one `AgentRuntime` per session, a 25ms pump drives `poll` inside the daemon)
- Streaming events and snapshot push (`runtime.event` / `session.snapshot` / `session.turnFinished`)
- Client routing of approvals / questions / workspace capability trust (broadcast, first-come-first-served; auto deny/skip when the last client disconnects)
- Tool execution inside the daemon process (`NodeHostToolService` + per-workspace shared `McpService`)
- In-process reading of host config and credentials (`config.json` + OS keyring; secrets never cross WS)
- `host.*` workspace/config management RPCs (rules/skills/hooks/extensions/marketplace/todos/MCP management)
- Instance registry (random port + `{spiritDataDir}/server/instances/`) and home-level bearer token

It does not own:

- Redefining model-visible semantics (tool contracts and system prompts stay in `agent-core`)
- Reimplementing host execution (it calls the host-internal library, no fork)
- Client UI and platform capabilities (windows, TUI rendering, file pickers stay in apps)

Conclusion:

Server is where the runtime is hosted, not a fourth semantic layer; apps must stay thin after degrading into clients.

## The No-Vendor-Runtime Rule

The config.json model/provider section is fully declarative. Runtime code (agent-core's request paths, host-internal's transport resolution, CLI / Desktop runtime reads) must not branch on provider identity — the provider entry's declared fields are the only inputs.

- The dividing line is **wire fact vs behavior name**, not how many implementers exist. Config may hold any vendor-flavored literal identifiable on the wire — URLs, headers, request body fields, literal tool entries, URI schemes the other server resolves — and may name code mechanisms: transport protocol names (`openai-compatible`, `anthropic`, …) and npm adapter package names (`@ai-sdk/openai-compatible`, …). `bedrock` is a published protocol name; `ms://` is the other server's scheme; both are legal even with a single implementer.
- Forbidden are **behavior names**: concepts that exist only inside Spirit and never appear on the wire (the old `minimax-files`, `kimi-code-managed`, `llmVendor`, `upstreamProvider` family). They are vendor branches in disguise.
- The runtime may branch, but the branch key must be a mechanism name declared in config (`transportKind`, `sdk`, `options.auth`, …), and the branch body must be that mechanism's generic implementation. It must never change behavior semantics based on "whose service this is".
- The rule is enforced structurally, not by convention: `packages/agent-core/scripts/check-no-vendor-runtime.mjs` builds a forbidden-token list from the preset manifest (preset ids + declared endpoint hostnames) plus the legacy field names and fails `agent-core`'s test script on any hit in runtime sources. The materialization zone directories (`provider-presets`, `model-catalog`, `model-knowledge`, plus `smoke` / `eval`) are excluded from the scan — write-time knowledge is legitimate there.

## Declarative Providers (config.json v1)

`schemaVersion` is `1`; any other value is rejected with a delete-and-reconnect error. There is no migration from older shapes.

- `apiBase` is the single source of truth. The runtime never re-derives it; site, billing-plan, and cloud differences are materialized into the final URL by the wizard at write time.
- `transportKind` selects the wire protocol; `sdk` names the npm adapter package. Built-in presets always declare `sdk` explicitly; custom entries may omit it for the transport default. Unknown package names are fail-fast config errors (Spirit ships bundled adapters; no runtime package installation).
- `headers` / `body` are literal merge points the runtime does not understand; they are the designated outlet for long-tail wire quirks, not the preferred form.
- Key channels, in resolution order: `apiKey` (plaintext escape hatch, not recommended) → `apiKeyEnv` (environment variable name) → `apiKeyKeyring` (external keyring entry) → the internal OS keyring (implicit fallback, account `provider::{id}`). Composite credentials (Bedrock IAM, Vertex service accounts) use `credentials` slot maps; each slot resolves `value` → `env` → `keyring` → internal keyring (`provider::{id}::{slot}`; the `apiKey` slot is `provider::{id}`).
- `options` carries transport parameters keyed by `transportKind` × `sdk` (`awsRegion`, `project` / `location`, `auth`, `storedState`, `applyPatch`); unknown keys are rejected.
- Model-level fields declared flat on the provider entry inherit to all its models; a model's own declaration wins. `supportedReasoningEfforts` / `supportedReasoningModes` cover reasoning semantics, while `effortSemantics: "output"` plus `supportedEfforts` covers Claude's output-wide effort. Together with `serviceTiers`, they are the picker and validation sources for their respective declarations — out-of-list values are fail-fast config errors, never silently clamped. The two effort families are never read as aliases or fallbacks for each other.

## Provider Tools (`providerTools`)

Provider-exposed tools (web search, code interpreters, …) are a declaration block on the provider entry. The runtime does not understand entry semantics; it only injects, recognizes, and executes as declared. This one mechanism replaces the old vendor-specific built-in tool sections (OpenAI / xAI Responses tools, Vercel gateway tools, Alibaba body switches, Kimi Code / StepFun / Z.ai managed search, MiniMax server tools) — those shapes are now preset materialization templates in `agent-core`'s `provider-presets.json`.

- An entry carries literal `tools` entries merged into the request `tools[]` and/or entry-level `body` fields merged into the request body while the entry is enabled. At least one of the two is required; unknown keys, including removed declaration sources, are fail-fast config errors.
- `execute` absent = the upstream executes inside the request; the runtime recognizes calls to the declared names as provider tool calls and waits for the transport's in-band result shapes. `execute` present requires literal `tools`: the host intercepts calls to the declared name set and performs the declared HTTP execution (path/url, body template with `{toolName}` / `{argumentsJson}` / `{arg.<path>}` placeholders, `statusPath` / `errorPath` / `resultPath` / `resultsPath` + `fields` extraction). With neither result extraction form, the complete response JSON is returned as text without field projection.
- `ui.expand: false` forbids expanding the tool-call details — a display restriction dictated by the other side's data nature, the only display fact that belongs in config. Spirit's own display behavior stays in code.
- The global toggle is `agents.providerTools.enabled` (opt-out, on by default). `false` means no injection, no recognition, no body merges.
- Name collisions with local (host / MCP / extension) tools resolve per-name in favor of the local tool, with a console warning per skipped name.
- Materialized literal entries carry full JSON schemas; argument validation against the declared schema is fail-fast — out-of-bounds or missing required arguments come back as tool argument errors to the model, never silently clamped.
- Presets materialize on connect/reconnect; existing config is not updated implicitly. Removed declaration keys are rejected rather than retained as no-op compatibility fields, so affected entries must be reconnected or rewritten to the static declaration.

## File Upload (`fileUpload`)

A purpose-agnostic upload declaration for "this turn references a local file that should not go inline": `path` / `url` (endpoint, `url` wins), `purpose` (string shorthand or per-purpose map; a purpose absent from the map goes inline), `idPath` (dot path of the file id in the upload response, default `"id"`, stringified), `refTemplate` (required, must contain `{id}`; the scheme is the upstream server's resolution convention, passed through verbatim), `maxBytes` (local pre-upload cap). Absent `fileUpload` = media go through the transport's generic inline path. The constant HTTP mechanics (multipart POST, `file` field name, Bearer reuse, path + mtime cache) stay in code, at the same level as redirect handling.

## Terminology

### Tool Definition

"Tool definition" here means only the model-visible tool contract, not the host execution implementation.

It contains only:

- Tool name
- Tool purpose description
- JSON Schema parameter definition

It does not contain:

- Host-internal request types
- Parameter parsing implementation
- Approval and authorization implementation
- Actual execution implementations for shell / file / search / network

### Tool Implementation

"Tool implementation" means the local capabilities the host provides to fulfill the tool contract, including:

- Parsing function calls into host request objects
- Parameter validation and error copy
- Authorization, approval, and question flows
- Concrete execution logic
- Platform-specific adaptation

## Ownership Table

| Asset                                                                                                                | Owner                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Main system prompt                                                                                                   | `agent-core`                                                                                |
| Semantics of system sections such as Rules / Skills catalog                                                          | `agent-core`                                                                                |
| User-turn `<active_skill>` meta (full text of explicitly activated Skill)                                            | `agent-core` (assembled by `user-turn-timestamp`)                                           |
| Built-in tool names, descriptions, JSON Schemas                                                                      | `agent-core`                                                                                |
| Dream tool names, descriptions, JSON Schemas, and collector system prompt                                            | `agent-core`                                                                                |
| Session TODO tool name, description, JSON Schema (no separate todos system section)                                  | `agent-core`                                                                                |
| LSP tool contract, `get_diagnostics` Schema (routed to per-language servers by extension), and diagnostic formatting | `agent-core`                                                                                |
| MCP protocol, MCP tool / resource / prompt runtime                                                                   | `agent-core`                                                                                |
| LLM transports and SDK adapters                                                                                      | `agent-core`                                                                                |
| Provider tool / file upload / service tier / reasoning mechanisms (declaration-driven)                               | `agent-core`                                                                                |
| Built-in provider presets, wizard/catalog materialization, catalog parsers, model knowledge data                     | `agent-core` (`src/provider-presets/`, `src/model-catalog/`, `src/model-knowledge/`)        |
| Host interface definitions                                                                                           | `agent-core`                                                                                |
| Agent Hooks schema, runtime attachment points, and `HookRunner` port                                                 | `agent-core`                                                                                |
| `config.json` schema, validation, load/save                                                                          | host-internal library                                                                       |
| Credential channel resolution and OS keyring access (`provider::{id}[::<slot>]`)                                     | host-internal library                                                                       |
| Discovery and management of Rules / Skills / Plan                                                                    | host-internal library                                                                       |
| Agent Hooks config merge, command execution, and `createHookRunner`                                                  | host-internal library                                                                       |
| Host tool request types, parsing, validation, approval, execution                                                    | host-internal library                                                                       |
| Host UI capability facts (`hostUiPromptSection`, `hostToolDescriptionHints` — e.g. Desktop Mermaid rendering)        | apps author the facts; `agent-core` owns assembly (system section / tool description merge) |
| Dream file storage, expiry cleanup, and run logs                                                                     | host-internal library                                                                       |
| Session TODO storage, `replaceAll`, and tool execution                                                               | host-internal library                                                                       |
| LSP multi-provider processes, PATH detection, document sync, post-write append, and workspace cache                  | host-internal library                                                                       |
| Platform adaptation for shell / search / file / web fetch                                                            | host-internal library                                                                       |
| CLI / Desktop UI and platform wiring, including the connect wizard's forms                                           | apps                                                                                        |
| Desktop dreams settings page, background scheduling, and Commit consumption                                          | apps                                                                                        |
| Desktop / CLI Composer TODO cards and strip UI                                                                       | apps                                                                                        |
| Single source of truth for sessions/turns/approvals in the shared backend                                            | `packages/server`                                                                           |
| Shared-backend instance registry, client auth, and WS transport                                                      | `packages/server`                                                                           |

## Hard Constraints

To prevent future drift, the constraints are:

1. Any model-visible text that describes tool contracts or system rule semantics must be defined only in `agent-core`.
   Host UI capability facts (e.g. "the host renders Mermaid") are the one exception: apps author them, but they reach the model only through `agent-core`-owned assembly points — `hostUiPromptSection` (system section) or `hostToolDescriptionHints` (merged into tool/parameter descriptions).
2. Any host scanning, path, permission, or state persistence logic must not enter `agent-core`.
3. No app entry point may define a new copy of tool Schemas or system prompts.
4. The host-internal library may only implement the contracts exposed by `agent-core`; it must not rewrite contract semantics.
5. No runtime code path may branch on provider identity; only on mechanism names declared in config. The structural check (`check-no-vendor-runtime.mjs`, wired into `agent-core`'s test script) is the enforcement — keep its token list honest.
6. Vendor knowledge (preset bases, site templates, billing plans, tool shape templates, per-model reasoning/thinking facts) lives only in the `agent-core` materialization zone as write-time data, and lands in config as public declarations.

## How the Current Repo Maps to This

Under this boundary, the current repo should be understood as:

- `packages/agent-core` carries the runtime, MCP, system prompts, tool contracts, transports, and the materialization zone (`provider-presets/`, `model-catalog/`, `model-knowledge/`).
- `packages/agent-core` carries dream tool contracts and the collector system prompt, but not Desktop session scanning or file storage.
- `packages/host-internal` carries the `config.json` v1 schema and credential resolution, dream tool execution, the dream store, log directories, and other host capabilities.
- `packages/host-internal/src/lsp/` carries the LSP host implementation (multi-language server processes, `LspOrchestrator` routing by extension, provider discovery, post-write diagnostic append, workspace cache).
- `packages/agent-core/src/lsp/` keeps only the LSP tool contract (`get_diagnostics` auto-routed by path extension), supported-extension constants, and LLM-visible diagnostic formatting.
- `packages/server` carries the shared daemon: single source of truth for sessions/turns/approvals, WS transport, and instance registry; CLI and Desktop main sessions, Automation, and Dream Collector all have no in-process fallback
- `packages/host-internal/src/credentials/` carries shared config and credential reading (`config.json` + OS keyring, with `provider::{id}` / `provider::{id}::{slot}` as the canonical account scheme), used by server and acp-server to resolve transports in-process.
- `apps/desktop` carries dreams settings, background scheduling, and Commit consumption.
- Host tool implementations and rules / skills / plan discovery and management currently duplicated between CLI and Desktop should converge into the host-internal library — and the host-internal library itself shrinks into `agent-core` over time.

## Design Rationale

"Keeping the discovery and management of Rules / Skills / Plan in the host-internal library" does not contradict the goal of `agent-core` as the single capability library.

On the contrary, this ensures:

- `agent-core` expresses capability contracts, runtime semantics, and the write-time knowledge that materializes public config declarations
- The host-internal library only expresses how the local machine provides these capabilities
- Apps stop reinventing the wheel

The same logic is why the preset manifest belongs to `agent-core`: its materialization templates contain model-visible copy (tool descriptions), which this document's own hard constraints assign to `agent-core`. And it is why the runtime stays declaration-driven: vendor identity on the request path would be a second, hidden capability library — one that no config can inspect and no structural check can see.
