# @spiritagent/agent-core

TypeScript core runtime for [Spirit](https://github.com/SpiritAgents/spirit) — the **single source of agent semantics** in the project. Desktop, CLI, and ACP hosts consume this package; they supply platform-specific execution and UI.

This is an internal capability library, not a public SDK. If a public SDK ever ships, it will be a separate facade package that depends on this one.

## What it provides

- **Turn machine** — streaming assistant output, tool rounds, compaction, and context usage tracking.
- **Agent / Plan / Ask / Debug modes** — full tool access, planning-only workflows, read-only Q&A with edit tools stripped at the contract layer, or structured debugging with log-point hypotheses.
- **Subagents** — `subagent` delegates focused work to child runs with their own tool surface.
- **Model transports** — OpenAI-compatible, Open Responses, Anthropic Messages, and Amazon Bedrock routes behind one runtime, selected by the provider entry's declared `transportKind` / `sdk` in `config.json`, never by provider identity.
- **Provider tools** — the `providerTools` mechanism: literal tool entries, body merges, and declared host-side HTTP execution, all driven by the provider entry's declaration and gated by `agents.providerTools.enabled`.
- **File upload** — the generic `fileUpload` uploader: declaration-driven endpoint, purpose map, id extraction, and reference templating.
- **Service tier preferences** — the renderer-safe `model-service-tier` module defines the canonical per-model `serviceTier` config value and its validation; picker and validation read only the model's declared `serviceTiers`, and the wire effect comes from a fixed table of public transport API facts (simple form) or the literal per-tier declaration (literal form).
- **Host tool contracts** — built-in tools defined once (name, description, JSON Schema); hosts implement execution for workspace files, shell, web, delegation, planning, multimodal output, Dreams memory, and LSP diagnostics.
- **System context** — rules, skills, MCP client/registry, and mode prompts assembled for the model without duplicating tool lists in system text.
- **Materialization zone** — `src/provider-presets/` (the built-in preset manifest, loader, and materializer feeding the connect wizard), `src/model-catalog/` (catalog parsers named by API shape), and `src/model-knowledge/` (per-model facts keyed by canonical model ID, stored as JSON data). This write-time knowledge lands in `config.json` as public declarations and is never read on the runtime request path — enforced structurally by `scripts/check-no-vendor-runtime.mjs`, which runs in this package's test script.

## Service tier request contract

`service-tier-request.ts` maps the declared per-model `serviceTier` selection to request patches via `resolveServiceTierRequestPlan` (per wire surface: chat completions, Open Responses, Gateway v3, Anthropic Messages, Gemini generate-content, Bedrock). An unset tier sends nothing, preserving the request byte-for-byte; selection validity is enforced at config load, so the runtime never clamps or rewrites it.

- Simple form (a list of tier names): maps through a fixed table of public transport API parameters — the `service_tier` body field for chat completions / Open Responses, the `gateway.serviceTier` provider option (flex/priority) for the Gateway v3 protocol. Anthropic's `speed` is applied by the Anthropic transport itself; Bedrock has no tier parameter.
- Literal form (a tier → `{ headers, body }` map): the selected tier's declared headers/body apply verbatim with zero internal mapping — used for routes whose mapping varies per upstream, materialized at write time.
- Flex requests run on an extended-wait dispatcher (30-minute headers/body timeouts) instead of the standard dispatcher, so Flex queue waits do not trip the regular HTTP timeouts.

## Host configuration sources

`McpService` accepts `McpServiceOptions.configSource`. The host supplies synchronous configuration reads for immediate registry priming and a user-scope cache key. Without a source, the SDK service has no file-backed MCP servers; it does not discover a home directory or read configuration files. Hosts in this repository use `createHostMcpService` from `@spiritagent/host-internal`. MCP parsing, merging, protocol handling, and runtime semantics remain in Agent Core.

## Requirements

- Node.js 26.13.0

## Related packages

- [`@spiritagent/host-internal`](https://www.npmjs.com/package/@spiritagent/host-internal) — shared host discovery, tools, extensions, LSP helpers, and config / credential resolution.
- [`@spiritagent/acp-server`](https://www.npmjs.com/package/@spiritagent/acp-server) — ACP server adapter for editor integration.

## License

MIT — see [LICENSE](LICENSE) and the [Spirit repository](https://github.com/SpiritAgents/spirit).
