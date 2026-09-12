---
applyTo: "**/*"
---

# Spirit Capability Boundary

## Purpose

This document unifies the responsibility boundaries across `agent-core`, the host-internal library, and the final app layer, so that CLI and Desktop do not each duplicate semantics, prompts, tool contracts, and host details.

There is only one core principle:

`agent-core` is the single Agent capability library; the host-internal library owns host-side discovery, management, and execution details; the app layer only does thin adaptation and UI.

## Provider Built-in Tools (Open Responses)

- **Do not** register an executable `web_search` host tool in `host-internal` (Moonshot `$web_search` is also out of scope).
- **OpenAI / xAI official Responses**: `tools.webSearch()` from `@ai-sdk/openai` / `@ai-sdk/xai`.
- **Vercel AI Gateway (`vercel-ai-gateway`) Open Responses**: `createGateway().tools.perplexitySearch()` from `@ai-sdk/gateway`, injected as `web_search`; the language model must go through Gateway v3 `language-model` (`createGateway().languageModel()`), because `@ai-sdk/open-responses` drops provider tools.
- **Alibaba (`alibaba`) dual path** (`alibaba-built-in-tools` + `web-search-eligibility`):
  - **Chat Completions**: via `extra_body` (`enable_search`, `enable_thinking`, `enable_code_interpreter`, `search_options`, etc.); the code interpreter requires streaming on the Chat API. Use the host `web_fetch` to fetch the body of a specific URL.
  - **Open Responses**: inject `{ type: web_search }` and `code_interpreter` via HTTP `tools` (no `web_extractor`; use the host `web_fetch` for URL bodies).
- Visibility is gated by the eligibility and fetch layers. **Do not** append provider built-in usage instructions to the system message (the model already sees them from the request `tools`); when Chat Completions capabilities go through `extra_body` and there is no function name to declare, **do not** write system essays either. Details: `llm-visible-copy.instructions.md`.

## Moonshot Formula (Chat Completions)

- **Moonshot AI direct** (`llmVendor: moonshot-ai`, `openai-compatible`): injects the remote schema `moonshot/web-search:latest` via the Formula API; when the model triggers `web_search`, `agent-core` calls `/formulas/{uri}/fibers` and writes `encrypted_output` back into the tool message.
- **Out of scope**: Kimi Code (`kimi-code`), Moonshot routed via Vercel Gateway, legacy `$web_search` builtin_function.
- **Do not** register an executable `web_search` in `host-internal`; Formula execution stays in `agent-core` `moonshot/formula/`.
- UI: `encrypted_output` is not displayable; Moonshot Formula `web_search` cards are barred from expansion via `_spiritUi.suppressExpand`.

## Kimi Code / StepFun / Z.ai Managed `web_search` (non-Formula)

- **Kimi Code** (`llmVendor: kimi-code` or `api.kimi.com`): `agent-core` injects a local `web_search` function schema; on execution it `POST https://api.kimi.com/coding/v1/search` (body `text_query`) and writes the result back into the tool message.
- **StepFun** (`llmVendor: stepfun` or `api.stepfun.com` / `api.stepfun.ai`): same kind of managed tool; on execution it posts to `{origin}/v1/search` derived from the configured base (optional `n`).
- **Z.ai / Zhipu AI** (`llmVendor: z-ai` / `zhipu-ai`, or `api.z.ai` / `open.bigmodel.cn`): same kind of managed tool; on execution it posts to `{baseUrl}/web_search` (works on both the PaaS and Coding Plan bases) with `search_engine` + `search_query` and optional `count` (1-50). Z.ai always uses `search-prime`; Zhipu AI uses `search_std` plus the required `search_intent: false`.
- **Do not** register an executable `web_search` in `host-internal`; execution stays in `agent-core` (`kimi-code/`, `stepfun/`, `zai/`), via the managed provider turn handler.
- UI: expandable preview (shares `_spiritUi` with StepFun, no `suppressExpand`).

## MiniMax Server Tools (Anthropic Messages)

- **MiniMax direct** (`llmVendor: minimax`, `transportKind: anthropic`): injects the Server Tool `{ type: web_search_20250305, name: web_search }` via the Messages API (source: [minimax.io server-tools](https://platform.minimaxi.io/docs/guides/server-tools.md), version `20250305`); **Messages API only**, not Chat Completions.
- Response blocks `server_tool_use` / `web_search_tool_result` are parsed by `agent-core` `anthropic/minimax-web-search-stream.ts`; the search executes server-side and the host **does not** send back a `tool_result`.
- **Do not** register an executable `web_search` in `host-internal`; injection and stream mapping stay in `agent-core` `anthropic/minimax-server-tools.ts`.
- UI: reuses the Responses built-in `web_search` card (`toolName: web_search` + `_spiritUi`); Detail shows the search keywords, and expanded Input/Output matches the Vercel AI Gateway web search card.

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
- Host-facing interface definitions

It does not own:

- Scanning the workspace, user directories, AppData, Keyring
- Discovering and enabling `rules`, `skills`, `plan` files
- Managing persisted state of this host metadata
- Directly executing shell, filesystem, web fetching, search
- UI forms, windows, TUI, Electron, Rust host interactions

Conclusion:

`agent-core` owns "what the model sees" and "how the runtime consumes these capabilities", not "how the host wires these capabilities to the local machine".

### 2. Host-Internal Library

The host-internal library is the shared implementation of the Host / UI layer, not a public Agent SDK.

It owns:

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
- Replacing `agent-core` as a second "capability library"

Conclusion:

The host-internal library is the implementation-side companion of `agent-core`, not a second Agent Core.

### 3. apps

The final app layer keeps only host wiring and UI.

It owns:

- Final entry points such as Rust CLI, Electron, Desktop Web, TUI
- Wiring platform events, UI interactions, and permission confirmation results into the host-internal library
- Wiring the host-internal library into `agent-core`
- Host consumption entry points such as the Desktop dreams settings page, background scheduler, and Commit

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
| Host interface definitions                                                                                           | `agent-core`                                                                                |
| Agent Hooks schema, runtime attachment points, and `HookRunner` port                                                 | `agent-core`                                                                                |
| Discovery and management of Rules / Skills / Plan                                                                    | host-internal library                                                                       |
| Agent Hooks config merge, command execution, and `createHookRunner`                                                  | host-internal library                                                                       |
| Host tool request types, parsing, validation, approval, execution                                                    | host-internal library                                                                       |
| Host UI capability facts (`hostUiPromptSection`, `hostToolDescriptionHints` — e.g. Desktop Mermaid rendering)        | apps author the facts; `agent-core` owns assembly (system section / tool description merge) |
| Dream file storage, expiry cleanup, and run logs                                                                     | host-internal library                                                                       |
| Session TODO storage, `replaceAll`, and tool execution                                                               | host-internal library                                                                       |
| LSP multi-provider processes, PATH/install detection, document sync, post-write append, and workspace cache          | host-internal library                                                                       |
| Platform adaptation for shell / search / file / web fetch                                                            | host-internal library                                                                       |
| CLI / Desktop UI and platform wiring                                                                                 | apps                                                                                        |
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

## How the Current Repo Maps to This

Under this boundary, the current repo should be understood as:

- `packages/agent-core` continues to carry the runtime, MCP, system prompts, and tool contracts.
- `packages/agent-core` carries dream tool contracts and the collector system prompt, but not Desktop session scanning or file storage.
- `packages/host-internal` carries dream tool execution, the dream store, log directories, and other host capabilities.
- `packages/host-internal/src/lsp/` carries the LSP host implementation (multi-language server processes, `LspOrchestrator` routing by extension, provider discovery/install, post-write diagnostic append, workspace cache).
- `packages/agent-core/src/lsp/` keeps only the LSP tool contract (`get_diagnostics` auto-routed by path extension), supported-extension constants, and LLM-visible diagnostic formatting.
- `packages/server` carries the shared daemon: single source of truth for sessions/turns/approvals, WS transport, and instance registry; CLI and Desktop main sessions, Automation, and Dream Collector all have no in-process fallback
- `packages/host-internal/src/credentials/` carries shared config and credential reading (`config.json` + OS keyring, with `group::{groupId}` as the canonical account scheme), used by server and acp-server to resolve transports in-process.
- `apps/desktop` carries dreams settings, background scheduling, and Commit consumption.
- Host tool implementations and rules / skills / plan discovery and management currently duplicated between CLI and Desktop should converge into the host-internal library.
- `agent-core` should not absorb these discovery and management implementations, because that would incorrectly lift Host / UI responsibilities into the Agent SDK.

## LLM Transport Families (transportKind)

The host selects the underlying protocol via `LlmTransportConfig`; **do not** conflate Chat Completions and Responses into the same config default:

| `transportKind`     | Protocol family                    | Typical SDK                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openai-compatible` | OpenAI Chat Completions compatible | `@ai-sdk/openai-compatible`, etc.                                                                                                                                                                                                                                                                                                |
| `open-responses`    | Responses / Open Responses         | OpenAI official: `responses` from `@ai-sdk/openai`; xAI: `responses` from `@ai-sdk/xai`; Azure: `@ai-sdk/azure` Responses callable by default (`provider=azure` is pinned to this transport, requires `azureResourceName` + deployment name, API Key only in this version); other compatible endpoints: `@ai-sdk/open-responses` |
| `anthropic`         | Anthropic Messages                 | `@ai-sdk/anthropic`                                                                                                                                                                                                                                                                                                              |

- `provider=openai` is **pinned to** `open-responses` (existing defaults or explicit `openai-compatible` are silently upgraded); no Chat Completions transport choice is offered.
- `provider=azure` is **pinned to** `open-responses`; no transport choice is offered. Azure has no `/models` endpoint; the deployment name is written to `ModelProfile.name`.
- OpenAI / Azure official Responses default to `store: true` and use `previous_response_id` for incremental continuation; on providers that support remote storage, `agent-core` sends only delta input
- Whether an Open Responses compatible endpoint supports server-side storage depends on the user-configured upstream; when unsupported, the transport falls back to full input

## Design Rationale

"Keeping the discovery and management of Rules / Skills / Plan in the host-internal library" does not contradict the goal of `agent-core` as the single capability library.

On the contrary, this ensures:

- `agent-core` only expresses capability contracts and runtime semantics
- The host-internal library only expresses how the local machine provides these capabilities
- Apps stop reinventing the wheel

If third parties integrate `agent-core` in the future, they should implement their own host discovery and management logic, rather than treating this repo's host scanning strategy as a hard-bound part of the SDK.

This is exactly the boundary that should exist between an SDK and a Host.
