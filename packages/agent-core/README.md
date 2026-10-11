# @spiritagent/agent-core

TypeScript core runtime for [Spirit](https://github.com/SpiritAgents/spirit) — the **single source of agent semantics** in the project. Desktop, CLI, and ACP hosts consume this package; they supply platform-specific execution and UI.

## What it provides

- **Turn machine** — streaming assistant output, tool rounds, compaction, and context usage tracking.
- **Agent / Plan / Ask / Debug modes** — full tool access, planning-only workflows, read-only Q&A with edit tools stripped at the contract layer, or structured debugging with log-point hypotheses.
- **Subagents** — `subagent` delegates focused work to child runs with their own tool surface.
- **Model transports** — OpenAI-compatible, Open Responses, and Anthropic routes behind one runtime (OpenAI, DeepSeek, Anthropic, Google, Bedrock, Vertex, Gateway, OpenRouter, Alibaba, and others).
- **Service tier preferences** — the renderer-safe `model-service-tier` module defines the canonical per-model `serviceTier` config value, provider/upstream capability gating, validation (`parseModelServiceTierConfig`), and trigger-label resolution; transports map the preference to native request fields (OpenAI `service_tier`, Anthropic `speed: "fast"`, Google/Vertex service tier options, Gateway/OpenRouter mappings).

## Service tier request contract

`service-tier-request.ts` maps the canonical per-model `serviceTier` to each transport's native fields via `resolveServiceTierRequestPlan` (per-surface: chat completions, Open Responses, Gateway v3, Anthropic Messages). Unset tiers and routes outside the capability matrix send nothing, preserving the previous request byte-for-byte; the configured value is recorded on the request trace.

- Direct OpenAI Responses: `auto`/`default`/`flex`/`fast` map to the SDK `openai.serviceTier` provider option; Ultrafast (GPT-6 Astra and GPT-6.1 Sol) sends the body `service_tier` through that same provider option.
- Anthropic: `fast` maps to native `speed: "fast"` and the `fast-mode-2026-02-01` beta header (added by the SDK); off/unset sends nothing, never `speed: "standard"`. Aggregators never inject `speed`/beta.
- Google: `default`/`flex`/`priority` map to the `google.serviceTier` provider option (serialized as a top-level body field). Vertex: Flex and Priority map to the `vertex.sharedRequestType` / `requestType: "shared"` provider options (serialized as `X-Vertex-AI-LLM-*` request headers), gated to the `global` endpoint.
- Vercel AI Gateway: on the v3 gateway surface, supported tiers map to the `gateway.serviceTier` unified enum (Ultrafast forwards through the `openai` namespace instead); on the generic Responses route they map to a top-level body `service_tier`.
- OpenRouter: supported tiers map to a top-level body `service_tier` per upstream, including an explicit `service_tier: "default"` to override `:nitro`/`:floor` variant admission.
- Flex requests run on an extended-wait dispatcher (30-minute headers/body timeouts) instead of the standard dispatcher, so Flex queue waits do not trip the regular HTTP timeouts.
- **Host tool contracts** — built-in tools defined once (name, description, JSON Schema); hosts implement execution for workspace files, shell, web, delegation, planning, multimodal output, Dreams memory, and LSP diagnostics.
- **System context** — rules, skills, MCP client/registry, and mode prompts assembled for the model without duplicating tool lists in system text.

## Host configuration sources

`McpService` accepts `McpServiceOptions.configSource`. The host supplies synchronous configuration reads for immediate registry priming and a user-scope cache key. Without a source, the SDK service has no file-backed MCP servers; it does not discover a home directory or read configuration files. Hosts in this repository use `createHostMcpService` from `@spiritagent/host-internal`. MCP parsing, merging, protocol handling, and runtime semantics remain in Agent Core.

## Requirements

- Node.js 24+

## Related packages

- [`@spiritagent/host-internal`](https://www.npmjs.com/package/@spiritagent/host-internal) — shared host discovery, tools, extensions, and LSP helpers.
- [`@spiritagent/acp-server`](https://www.npmjs.com/package/@spiritagent/acp-server) — ACP server adapter for editor integration.

## License

MIT — see [LICENSE](LICENSE) and the [Spirit repository](https://github.com/SpiritAgents/spirit).
