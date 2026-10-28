import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  assertSpiritConfigSchemaVersion,
  defaultSdkPackageName,
  emptyModelRef,
  findModelByRef,
  findModelEntry,
  findProviderEntry,
  isEmptyModelRef,
  KNOWN_SDK_PACKAGE_NAMES,
  listAllModelRefs,
  loadSpiritConfig,
  modelExistsInProvider,
  modelRefKey,
  modelRefsEqual,
  parseModelRef,
  providerCredentialSlotNames,
  resolveModelByRef,
  resolveModelEntry,
  resolveProviderSdkPackageName,
  resolveProviderTransportKind,
  saveSpiritConfig,
  SpiritConfigSchemaError,
  SPIRIT_CONFIG_SCHEMA_VERSION,
  validateSpiritConfig,
} from "./config.js";
import type { ModelRef, ProviderEntry, SpiritConfigFile } from "./config.js";

function validProvider(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-provider",
    apiBase: "https://example.com/v1",
    models: [{ name: "test-model" }],
    ...overrides,
  };
}

function validConfig(providers: unknown[] = [validProvider()]): Record<string, unknown> {
  return {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providers,
    activeModel: { providerId: "test-provider", name: "test-model" },
  };
}

function assertSchemaError(run: () => void, match: string | RegExp): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(
      error instanceof SpiritConfigSchemaError,
      `expected SpiritConfigSchemaError, got ${String(error)}`,
    );
    if (typeof match === "string") {
      assert.ok(
        error.message.includes(match),
        `error message ${JSON.stringify(error.message)} should include ${JSON.stringify(match)}`,
      );
    } else {
      assert.match(error.message, match);
    }
    return true;
  });
}

test("assertSpiritConfigSchemaVersion rejects anything but 1", () => {
  assertSchemaError(() => assertSpiritConfigSchemaVersion({}), "schemaVersion 1");
  assertSchemaError(() => assertSpiritConfigSchemaVersion({ schemaVersion: 2 }), "schemaVersion 1");
  assertSchemaError(() => assertSpiritConfigSchemaVersion("nope"), "schemaVersion 1");
  assertSchemaError(
    () => assertSpiritConfigSchemaVersion({ schemaVersion: 2 }),
    "delete the old config and reconnect a provider",
  );
  assert.doesNotThrow(() => assertSpiritConfigSchemaVersion({ schemaVersion: 1 }));
});

test("ModelRef helpers use providerId", () => {
  const ref: ModelRef = { providerId: "kimi-code", name: "k3" };
  assert.equal(modelRefKey(ref), "kimi-code::k3");
  assert.equal(modelRefsEqual(ref, { ...ref }), true);
  assert.equal(modelRefsEqual(ref, { providerId: "kimi-code", name: "k3-256k" }), false);
  assert.equal(modelRefsEqual(ref, undefined), false);
  assert.equal(isEmptyModelRef(emptyModelRef()), true);
  assert.equal(isEmptyModelRef(ref), false);
  assert.deepEqual(parseModelRef({ providerId: " a ", name: " b " }), {
    providerId: "a",
    name: "b",
  });
  assert.equal(parseModelRef({ providerId: "", name: "m" }), undefined);
  assert.equal(parseModelRef({ groupId: "legacy", name: "m" }), undefined);
  assert.equal(parseModelRef("m"), undefined);
});

test("find helpers resolve entries by id and name", () => {
  const providers = validateSpiritConfig(
    validConfig([
      validProvider(),
      validProvider({ id: "other", models: [{ name: "shared" }, { name: "extra" }] }),
    ]),
  ).providers;
  assert.equal(findProviderEntry(providers, "other")?.id, "other");
  assert.equal(findProviderEntry(providers, "missing"), undefined);
  assert.equal(findProviderEntry(providers, ""), undefined);
  const other = findProviderEntry(providers, "other")!;
  assert.equal(findModelEntry(other, "shared")?.name, "shared");
  assert.equal(findModelEntry(other, "missing"), undefined);
  assert.equal(modelExistsInProvider(providers, "other", "extra"), true);
  assert.equal(modelExistsInProvider(providers, "other", "nope"), false);
  assert.equal(
    findModelByRef(providers, { providerId: "other", name: "shared" })?.provider.id,
    "other",
  );
  assert.equal(findModelByRef(providers, emptyModelRef()), undefined);
  assert.deepEqual(listAllModelRefs(providers), [
    { providerId: "test-provider", name: "test-model" },
    { providerId: "other", name: "shared" },
    { providerId: "other", name: "extra" },
  ]);
});

test("validateSpiritConfig accepts the spec's full example", () => {
  const config = validateSpiritConfig({
    schemaVersion: 1,
    providers: [
      {
        id: "kimi-code",
        label: "Kimi Code",
        apiBase: "https://api.kimi.com/coding/v1",
        sdk: "@ai-sdk/openai-compatible",
        apiKeyKeyring: { service: "MyCompany Vault", account: "kimi-code-prod" },
        providerTools: [
          {
            label: "Web Search",
            tools: [
              {
                type: "function",
                function: {
                  name: "web_search",
                  description: "Search the web for up-to-date information.",
                  parameters: {
                    type: "object",
                    properties: { query: { type: "string", description: "Search query." } },
                    required: ["query"],
                    additionalProperties: false,
                  },
                },
              },
            ],
            execute: {
              path: "/search",
              body: { text_query: "{arg.query}" },
              resultsPath: "search_results",
              fields: {
                title: "title",
                url: "url",
                site: "site_name",
                time: "date",
                snippet: "snippet",
                content: "content",
              },
            },
          },
        ],
        fileUpload: {
          path: "/files",
          purpose: { video: "video" },
          refTemplate: "ms://{id}",
          maxBytes: 134217728,
        },
        models: [
          {
            name: "k3",
            capabilities: ["languageModel", "image", "video"],
            contextLength: 1048576,
            reasoningEffort: "high",
            supportedReasoningEfforts: ["low", "high", "max"],
            supportsThinkingType: "only",
          },
          { name: "k3-256k", capabilities: ["languageModel", "image"], contextLength: 262144 },
        ],
      },
      {
        id: "moonshot-ai",
        apiBase: "https://api.moonshot.cn/v1",
        sdk: "@ai-sdk/moonshotai",
        apiKeyEnv: "MOONSHOT_API_KEY",
        providerTools: [
          {
            label: "Web Search",
            tools: [
              {
                type: "function",
                function: {
                  name: "web_search",
                  description:
                    "Search the web for up-to-date information. Returns page titles, URLs, snippets, and content.",
                  parameters: {
                    type: "object",
                    properties: {
                      query: { type: "string", description: "Search query." },
                      max_results: {
                        type: "integer",
                        minimum: 1,
                        maximum: 20,
                        description: "Maximum number of results to return (default 5).",
                      },
                      sites: {
                        type: "array",
                        items: { type: "string" },
                        maxItems: 5,
                        description:
                          "Restrict search to specific sites; multiple sites are combined with OR.",
                      },
                      time_window: {
                        type: "object",
                        properties: {
                          start: {
                            type: "string",
                            description: "Start date in YYYY, YYYY-MM, or YYYY-MM-DD format.",
                          },
                          end: {
                            type: "string",
                            description: "End date in YYYY, YYYY-MM, or YYYY-MM-DD format.",
                          },
                        },
                        description: "Restrict results to a time window.",
                      },
                    },
                    required: ["query"],
                    additionalProperties: false,
                  },
                },
              },
            ],
            execute: {
              path: "/tools/search_pro",
              body: {
                text_query: "{arg.query}",
                limit: "{arg.max_results}",
                sites: "{arg.sites}",
                time_window: "{arg.time_window}",
              },
            },
          },
        ],
        fileUpload: { path: "/files", purpose: { video: "video" }, refTemplate: "ms://{id}" },
        capabilities: ["languageModel", "image"],
        supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
        reasoningEffort: "default",
        contextLength: 262144,
        models: [
          { name: "kimi-k2.6" },
          {
            name: "kimi-k3",
            contextLength: 1048576,
            supportedReasoningEfforts: ["low", "high", "max"],
            reasoningEffort: "max",
          },
        ],
      },
      {
        id: "z-ai",
        apiBase: "https://api.z.ai/v1",
        sdk: "@ai-sdk/openai-compatible",
        apiKeyEnv: "Z_AI_API_KEY",
        providerTools: [
          {
            label: "Web Search",
            tools: [
              {
                type: "function",
                function: {
                  name: "web_search",
                  description: "Search the web.",
                  parameters: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                      max_results: { type: "integer", minimum: 1, maximum: 50 },
                    },
                    required: ["query"],
                    additionalProperties: false,
                  },
                },
              },
            ],
            execute: {
              path: "/web_search",
              body: {
                search_engine: "search-prime",
                search_query: "{arg.query}",
                count: "{arg.max_results}",
              },
              resultsPath: "search_result",
              fields: {
                title: "title",
                url: "link",
                site: "media",
                time: "publish_date",
                content: "content",
              },
            },
          },
        ],
        models: [
          { name: "glm-5", capabilities: ["languageModel", "image"], contextLength: 200000 },
        ],
      },
      {
        id: "minimax",
        apiBase: "https://api.minimax.io/anthropic/v1",
        transportKind: "anthropic",
        sdk: "@ai-sdk/anthropic",
        apiKeyEnv: "MINIMAX_API_KEY",
        providerTools: [
          { label: "Web Search", tools: [{ type: "web_search_20250305", name: "web_search" }] },
        ],
        fileUpload: {
          url: "https://api.minimax.io/v1/files/upload",
          purpose: { video: "video_understanding" },
          idPath: "file.file_id",
          refTemplate: "mm_file://{id}",
        },
        models: [
          {
            name: "minimax-m3",
            capabilities: ["languageModel", "image", "video"],
            contextLength: 512000,
          },
        ],
      },
      {
        id: "vercel-ai-gateway",
        apiBase: "https://ai-gateway.vercel.sh/v1",
        transportKind: "open-responses",
        sdk: "@ai-sdk/gateway",
        apiKey: "vck_test",
        providerTools: [
          {
            label: "Perplexity Search",
            tools: [
              { type: "provider", id: "gateway.perplexity_search", name: "web_search", args: {} },
            ],
          },
        ],
        capabilities: ["languageModel"],
        supportedReasoningEfforts: ["none", "low", "medium", "high"],
        models: [
          {
            name: "anthropic/claude-opus-5.5",
            capabilities: ["languageModel", "image"],
            contextLength: 1000000,
            serviceTiers: ["default", "priority"],
            serviceTier: "priority",
          },
          {
            name: "openai/gpt-5.5",
            capabilities: ["languageModel", "image"],
            contextLength: 1000000,
            serviceTiers: ["auto", "default", "flex", "fast"],
            serviceTier: "auto",
          },
          {
            name: "openai/gpt-6-astra",
            capabilities: ["languageModel", "image"],
            contextLength: 1050000,
            reasoningEffort: "max",
            supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
            supportedReasoningModes: ["standard", "pro"],
            reasoningMode: "pro",
          },
        ],
      },
      {
        id: "alibaba",
        apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        sdk: "@ai-sdk/openai-compatible",
        apiKeyEnv: "DASHSCOPE_API_KEY",
        providerTools: [
          {
            label: "Web Search",
            body: { enable_search: true, search_options: { search_strategy: "agent_max" } },
          },
        ],
        models: [
          { name: "qwen3.8-max", capabilities: ["languageModel", "image"], contextLength: 262144 },
        ],
      },
      {
        id: "anthropic",
        apiBase: "https://api.anthropic.com",
        transportKind: "anthropic",
        sdk: "@ai-sdk/anthropic",
        apiKeyKeyring: { service: "1Password CLI", account: "anthropic" },
        providerTools: [
          { label: "Web Search", tools: [{ type: "web_search_20250305", name: "web_search" }] },
        ],
        models: [
          {
            name: "claude-opus-5.5",
            capabilities: ["languageModel", "image"],
            contextLength: 1000000,
            supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
            serviceTiers: {
              fast: {
                headers: { "anthropic-beta": "fast-mode-2026-02-01" },
                body: { speed: "fast" },
              },
            },
            serviceTier: "fast",
          },
        ],
      },
      {
        id: "my-lab-llm",
        label: "Lab LLM",
        apiBase: "http://192.168.1.10:8000/v1",
        headers: { "X-Org-Id": "robotics" },
        capabilities: ["languageModel"],
        contextLength: 131072,
        models: [{ name: "qwen3-local" }],
      },
      {
        id: "amazon-bedrock",
        apiBase: "https://bedrock-runtime.us-east-1.amazonaws.com",
        transportKind: "bedrock",
        options: { awsRegion: "us-east-1" },
        credentials: {
          accessKeyId: { env: "AWS_ACCESS_KEY_ID" },
          secretAccessKey: { env: "AWS_SECRET_ACCESS_KEY" },
        },
        models: [
          {
            name: "anthropic.claude-opus-5-5-v1",
            capabilities: ["languageModel", "image"],
            contextLength: 200000,
          },
        ],
      },
      {
        id: "google-vertex-ai",
        apiBase: "https://us-central1-aiplatform.googleapis.com",
        sdk: "@ai-sdk/google-vertex",
        options: { project: "my-gcp-project", location: "us-central1" },
        credentials: {
          clientEmail: { env: "GOOGLE_CLIENT_EMAIL" },
          privateKey: { keyring: { service: "1Password CLI", account: "vertex-sa" } },
        },
        models: [
          {
            name: "publishers/google/models/gemini-3.5-flash",
            capabilities: ["languageModel", "image"],
            contextLength: 1048576,
          },
        ],
      },
      {
        id: "meituan",
        apiBase: "https://api.longcat.chat/openai/v1",
        sdk: "@ai-sdk/openai-compatible",
        apiKeyEnv: "MEITUAN_API_KEY",
        supportsThinkingSwitch: true,
        thinkingSwitch: {
          on: { body: { thinking: { type: "enabled" } } },
          off: { body: { thinking: { type: "disabled" } } },
        },
        models: [
          {
            name: "longcat-2.5-preview",
            capabilities: ["languageModel", "image"],
            contextLength: 1048576,
          },
        ],
      },
    ],
    activeModel: { providerId: "vercel-ai-gateway", name: "google/gemini-4-argon" },
    imageGenerationModel: { providerId: "vercel-ai-gateway", name: "openai/gpt-image-2.5-flare" },
    videoGenerationModel: { providerId: "vercel-ai-gateway", name: "alibaba/wan-v2.5-t2v-preview" },
    secondaryLanguageModel: { providerId: "kimi-code", name: "k3" },
    permission: { shell: {} },
    agents: { providerTools: { enabled: true } },
  });
  assert.equal(config.providers.length, 11);
  assert.deepEqual(config.activeModel, {
    providerId: "vercel-ai-gateway",
    name: "google/gemini-4-argon",
  });
  assert.deepEqual(config.secondaryLanguageModel, { providerId: "kimi-code", name: "k3" });
  assert.deepEqual(config.permission, { shell: {} });
});

test("validateSpiritConfig rejects malformed top-level and provider entries", () => {
  assertSchemaError(
    () => validateSpiritConfig({ schemaVersion: 1 }),
    '"providers" must be an array',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([{ apiBase: "https://x", models: [] }])),
    'providers[0]: "id" must be a non-empty string',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([{ id: "x", models: [] }])),
    'providers[0]: "apiBase" must be a non-empty string',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ models: [{ contextLength: 5 }] })])),
    'providers[0].models[0]: "name" must be a non-empty string',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ models: "nope" })])),
    'providers[0]: "models" must be an array',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig(["nope"])),
    "providers[0] must be an object",
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ provider: "kimi-code" })])),
    'providers[0]: unknown key "provider"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ models: [{ name: "m", upstreamProvider: "openai" }] })]),
      ),
    'providers[0].models[0]: unknown key "upstreamProvider"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(validConfig([validProvider(), validProvider({ id: "test-provider" })])),
    'duplicate provider id "test-provider"',
  );
});

test("transportKind and sdk are validated against the known mechanism sets", () => {
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ transportKind: "openai" })])),
    '"transportKind" must be one of',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ sdk: "@ai-sdk/mistral" })])),
    'unknown "sdk" "@ai-sdk/mistral"',
  );
  for (const sdk of KNOWN_SDK_PACKAGE_NAMES) {
    assert.doesNotThrow(() => validateSpiritConfig(validConfig([validProvider({ sdk })])));
  }
});

test("sdk default derivation follows transportKind", () => {
  assert.equal(defaultSdkPackageName("openai-compatible"), "@ai-sdk/openai-compatible");
  assert.equal(defaultSdkPackageName("open-responses"), "@ai-sdk/open-responses");
  assert.equal(defaultSdkPackageName("anthropic"), "@ai-sdk/anthropic");
  assert.equal(defaultSdkPackageName("bedrock"), undefined);
  assert.equal(resolveProviderTransportKind({}), "openai-compatible");
  assert.equal(resolveProviderTransportKind({ transportKind: "bedrock" }), "bedrock");
  assert.equal(resolveProviderSdkPackageName({}), "@ai-sdk/openai-compatible");
  assert.equal(
    resolveProviderSdkPackageName({ transportKind: "open-responses" }),
    "@ai-sdk/open-responses",
  );
  assert.equal(resolveProviderSdkPackageName({ transportKind: "bedrock" }), undefined);
  assert.equal(resolveProviderSdkPackageName({ sdk: "@ai-sdk/xai" }), "@ai-sdk/xai");
});

test("options keys are scoped by transportKind and sdk", () => {
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({ transportKind: "bedrock", options: { awsRegion: "us-east-1" } }),
      ]),
    ),
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(validConfig([validProvider({ options: { awsRegion: "us-east-1" } })])),
    'unknown "options" key "awsRegion" for transportKind "openai-compatible"',
  );
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({ sdk: "@ai-sdk/google-vertex", options: { project: "p", location: "l" } }),
      ]),
    ),
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ sdk: "@ai-sdk/google", options: { project: "p" } })]),
      ),
    'unknown "options" key "project"',
  );
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          transportKind: "open-responses",
          options: {
            auth: "aws-sigv4",
            storedState: true,
            applyPatch: true,
            reasoningSummary: true,
          },
        }),
      ]),
    ),
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(validConfig([validProvider({ options: { reasoningSummary: true } })])),
    'unknown "options" key "reasoningSummary" for transportKind "openai-compatible"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({ transportKind: "open-responses", options: { reasoningSummary: false } }),
        ]),
      ),
    '"options.reasoningSummary" must be true',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ transportKind: "open-responses", options: { auth: "iam" } })]),
      ),
    '"options.auth" must be "aws-sigv4"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({ transportKind: "open-responses", options: { storedState: false } }),
        ]),
      ),
    '"options.storedState" must be true',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ transportKind: "anthropic", options: { applyPatch: true } })]),
      ),
    'unknown "options" key "applyPatch" for transportKind "anthropic"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ transportKind: "bedrock", options: { awsRegion: " " } })]),
      ),
    '"options.awsRegion" must be a non-empty string',
  );
});

test("mechanism options keys validate value shapes and transport scope", () => {
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          options: { toolsRejectReasoningEffort: true, maxInlineMediaBytes: 52428800 },
        }),
      ]),
    ),
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ options: { toolsRejectReasoningEffort: false } })]),
      ),
    '"options.toolsRejectReasoningEffort" must be true',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({
            transportKind: "open-responses",
            options: { toolsRejectReasoningEffort: true },
          }),
        ]),
      ),
    'unknown "options" key "toolsRejectReasoningEffort" for transportKind "open-responses"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ options: { maxInlineMediaBytes: "50MB" } })]),
      ),
    '"options.maxInlineMediaBytes" must be a positive integer',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(validConfig([validProvider({ options: { maxInlineMediaBytes: 0 } })])),
    '"options.maxInlineMediaBytes" must be a positive integer',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ options: { maxInlineMediaBytes: 1024.5 } })]),
      ),
    '"options.maxInlineMediaBytes" must be a positive integer',
  );
  // openRouterAnthropicReasoning spans both OpenAI-family surfaces, never anthropic/bedrock.
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([validProvider({ options: { openRouterAnthropicReasoning: true } })]),
    ),
  );
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          transportKind: "open-responses",
          options: { openRouterAnthropicReasoning: true },
        }),
      ]),
    ),
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ options: { openRouterAnthropicReasoning: false } })]),
      ),
    '"options.openRouterAnthropicReasoning" must be true',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({
            transportKind: "anthropic",
            options: { openRouterAnthropicReasoning: true },
          }),
        ]),
      ),
    'unknown "options" key "openRouterAnthropicReasoning" for transportKind "anthropic"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({ transportKind: "open-responses", options: { maxInlineMediaBytes: 1 } }),
        ]),
      ),
    'unknown "options" key "maxInlineMediaBytes" for transportKind "open-responses"',
  );

  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          transportKind: "open-responses",
          options: { applyPatch: true, defaultInputItemStatus: "completed" },
        }),
      ]),
    ),
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({
            transportKind: "open-responses",
            options: { defaultInputItemStatus: "" },
          }),
        ]),
      ),
    '"options.defaultInputItemStatus" must be a non-empty string',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({
            transportKind: "open-responses",
            options: { defaultInputItemStatus: true },
          }),
        ]),
      ),
    '"options.defaultInputItemStatus" must be a non-empty string',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({
            transportKind: "anthropic",
            options: { defaultInputItemStatus: "completed" },
          }),
        ]),
      ),
    'unknown "options" key "defaultInputItemStatus" for transportKind "anthropic"',
  );
});

test("preset mechanism options round trip through save/load", async () => {
  const spiritDataDir = mkdtempSync(join(tmpdir(), "spirit-config-options-"));
  const config: SpiritConfigFile = {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providers: [
      {
        id: "cloudflare-ai-gateway",
        apiBase: "https://api.cloudflare.com/client/v4/accounts/acc/ai/v1",
        sdk: "@ai-sdk/openai-compatible",
        options: { toolsRejectReasoningEffort: true },
        models: [{ name: "openai/gpt-5.5" }],
      },
      {
        id: "deepseek",
        apiBase: "https://api.deepseek.com/v1",
        sdk: "@ai-sdk/openai-compatible",
        models: [{ name: "deepseek-v4-flash" }],
      },
      {
        id: "volcengine",
        apiBase: "https://ark.cn-beijing.volces.com/api/v3",
        transportKind: "open-responses",
        sdk: "@ai-sdk/open-responses",
        options: { defaultInputItemStatus: "completed" },
        models: [{ name: "doubao-seed-2-0" }],
      },
      {
        id: "byteplus",
        apiBase: "https://ark.ap-southeast.bytepluses.com/api/v3",
        transportKind: "open-responses",
        sdk: "@ai-sdk/open-responses",
        options: { defaultInputItemStatus: "completed" },
        models: [{ name: "seed-2-0" }],
      },
      {
        id: "xiaomi",
        apiBase: "https://api.xiaomimimo.com/v1",
        sdk: "@ai-sdk/openai-compatible",
        options: { maxInlineMediaBytes: 52428800 },
        models: [{ name: "mimo-v2.5" }],
      },
    ],
    activeModel: { providerId: "deepseek", name: "deepseek-v4-flash" },
  };
  await saveSpiritConfig(spiritDataDir, config);
  const loaded = loadSpiritConfig(spiritDataDir);
  assert.ok(loaded);
  const byId = new Map(loaded.providers.map((provider) => [provider.id, provider]));
  assert.deepEqual(byId.get("cloudflare-ai-gateway")?.options, {
    toolsRejectReasoningEffort: true,
  });
  assert.equal(byId.get("deepseek")?.options, undefined);
  assert.deepEqual(byId.get("volcengine")?.options, { defaultInputItemStatus: "completed" });
  assert.deepEqual(byId.get("byteplus")?.options, { defaultInputItemStatus: "completed" });
  assert.deepEqual(byId.get("xiaomi")?.options, { maxInlineMediaBytes: 52428800 });
});

test("credentials slots are scoped by mechanism and conflict with flat keys", () => {
  assert.deepEqual(providerCredentialSlotNames("openai-compatible", undefined), ["apiKey"]);
  assert.deepEqual(providerCredentialSlotNames("bedrock", undefined), [
    "apiKey",
    "accessKeyId",
    "secretAccessKey",
  ]);
  assert.deepEqual(providerCredentialSlotNames("openai-compatible", "@ai-sdk/google-vertex"), [
    "apiKey",
    "clientEmail",
    "privateKey",
  ]);
  assert.deepEqual(providerCredentialSlotNames("open-responses", undefined, {}), ["apiKey"]);
  assert.deepEqual(
    providerCredentialSlotNames("open-responses", undefined, { auth: "aws-sigv4" }),
    ["apiKey", "accessKeyId", "secretAccessKey"],
  );

  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          transportKind: "open-responses",
          options: { auth: "aws-sigv4" },
          credentials: {
            accessKeyId: { env: "AWS_ACCESS_KEY_ID" },
            secretAccessKey: { keyring: { service: "Vault", account: "bedrock" } },
          },
        }),
      ]),
    ),
  );

  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          transportKind: "bedrock",
          credentials: {
            apiKey: { env: "BEDROCK_API_KEY" },
            accessKeyId: { env: "AWS_ACCESS_KEY_ID" },
            secretAccessKey: { keyring: { service: "Vault", account: "bedrock" } },
          },
        }),
      ]),
    ),
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ credentials: { accessKeyId: { env: "X" } } })]),
      ),
    'unknown credentials slot "accessKeyId"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({ sdk: "@ai-sdk/google", credentials: { clientEmail: { env: "X" } } }),
        ]),
      ),
    'unknown credentials slot "clientEmail"',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ credentials: { token: {} } })])),
    'unknown credentials slot "token"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ credentials: { apiKey: { vault: "x" } } })]),
      ),
    'providers[0].credentials.apiKey: unknown key "vault"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ credentials: { apiKey: { keyring: { service: "s" } } } })]),
      ),
    '"account" must be a non-empty string',
  );
  for (const flat of [
    { apiKey: "k" },
    { apiKeyEnv: "E" },
    { apiKeyKeyring: { service: "s", account: "a" } },
  ]) {
    assertSchemaError(
      () =>
        validateSpiritConfig(
          validConfig([validProvider({ ...flat, credentials: { apiKey: { env: "E" } } })]),
        ),
      'cannot coexist with "credentials.apiKey"',
    );
  }
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          transportKind: "bedrock",
          apiKeyEnv: "BEDROCK_API_KEY",
          credentials: { accessKeyId: { env: "AWS_ACCESS_KEY_ID" } },
        }),
      ]),
    ),
  );
});

test("fileUpload declarations are validated fail-fast", () => {
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ fileUpload: { refTemplate: "ms://{id}" } })]),
      ),
    'fileUpload requires at least one of "path" or "url"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ fileUpload: { path: "/files", refTemplate: "ms://" } })]),
      ),
    '"refTemplate" must contain the "{id}" placeholder',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({ fileUpload: { path: "/files", refTemplate: "ms://{id}", region: "x" } }),
        ]),
      ),
    'providers[0].fileUpload: unknown key "region"',
  );
});

test("providerTools entries are validated via the agent-core validator", () => {
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ providerTools: [{}] })])),
    'must declare at least one of "tools" or "body"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ providerTools: [{ execute: { path: "/search" } }] })]),
      ),
    '"execute" requires "tools"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({
            providerTools: [
              {
                tools: [{ type: "function", function: { name: "web_search" } }],
                execute: { path: "/s", resultsPath: "r", fields: { bogus: "x" } },
              },
            ],
          }),
        ]),
      ),
    'unknown "execute.fields" slot "bogus"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ providerTools: [{ body: {}, extra: true }] })]),
      ),
    'unknown key "extra"',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ providerTools: "nope" })])),
    "must be an array",
  );
});

test("inheritable model fields are type and enum checked", () => {
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ capabilities: ["languageModel", "pdf"] })]),
      ),
    '"capabilities" must be one of',
  );
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([validProvider({ models: [{ name: "m", capabilities: ["audio"] }] })]),
    ),
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ contextLength: -1 })])),
    '"contextLength" must be a positive number',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ outputLimit: "100" })])),
    '"outputLimit" must be a positive number',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ models: [{ name: "m", reasoningEffort: "turbo" }] })]),
      ),
    '"reasoningEffort" must be one of',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ models: [{ name: "m", reasoningMode: "max" }] })]),
      ),
    '"reasoningMode" must be one of',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ supportsThinkingType: "switch" })])),
    '"supportsThinkingType" must be "only"',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ supportsThinkingSwitch: "yes" })])),
    '"supportsThinkingSwitch" must be a boolean',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ headers: { "X-Key": 3 } })])),
    'providers[0].headers: "X-Key" must be a string',
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ body: [1] })])),
    '"body" must be an object',
  );
});

test("thinkingSwitch wire patches are validated recursively", () => {
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          supportsThinkingSwitch: true,
          thinkingSwitch: {
            on: { body: { thinking: { type: "enabled" } } },
            off: { headers: { "X-Thinking": "off" } },
          },
        }),
      ]),
    ),
  );
  // The providerOptions form (gateway v3 surface) is a valid wire-patch member.
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          supportsThinkingSwitch: true,
          thinkingSwitch: {
            on: {
              body: { thinking: { type: "enabled" } },
              providerOptions: { anthropic: { thinking: { type: "enabled" } } },
            },
          },
        }),
      ]),
    ),
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ thinkingSwitch: { on: { providerOptions: "anthropic" } } })]),
      ),
    'providers[0].thinkingSwitch.on: "providerOptions" must be an object',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ thinkingSwitch: { on: { params: {} } } })]),
      ),
    'providers[0].thinkingSwitch.on: unknown key "params"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ thinkingSwitch: { on: {}, off: {}, mid: {} } })]),
      ),
    'providers[0].thinkingSwitch: unknown key "mid"',
  );
});

test("serviceTiers declarations and serviceTier selection are cross-checked", () => {
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          models: [{ name: "m", serviceTiers: ["default", "flex"], serviceTier: "flex" }],
        }),
      ]),
    ),
  );
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          models: [
            { name: "m", serviceTiers: { fast: { body: { speed: "fast" } } }, serviceTier: "fast" },
          ],
        }),
      ]),
    ),
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ models: [{ name: "m", serviceTier: "flex" }] })]),
      ),
    '"serviceTier" is set but no "serviceTiers" are declared',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({
            models: [{ name: "m", serviceTiers: ["default"], serviceTier: "flex" }],
          }),
        ]),
      ),
    '"serviceTier" "flex" is not in the declared "serviceTiers"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({
            models: [{ name: "m", serviceTiers: { fast: {} }, serviceTier: "flex" }],
          }),
        ]),
      ),
    '"serviceTier" "flex" is not in the declared "serviceTiers"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({ models: [{ name: "m", serviceTiers: ["default", "warp"] }] }),
        ]),
      ),
    '"serviceTiers" must be one of',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ models: [{ name: "m", serviceTiers: { warp: {} } }] })]),
      ),
    'unknown service tier "warp"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({ models: [{ name: "m", serviceTiers: { fast: { query: {} } } }] }),
        ]),
      ),
    'unknown key "query"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ models: [{ name: "m", serviceTier: "warp" }] })]),
      ),
    '"serviceTier" must be one of',
  );
});

test("serviceTiers validates maxInputTokens as a positive integer", () => {
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          models: [
            {
              name: "m",
              serviceTiers: {
                default: { body: { service_tier: "default" } },
                fast: { body: { service_tier: "fast" }, maxInputTokens: 278528 },
              },
              serviceTier: "fast",
            },
          ],
        }),
      ]),
    ),
  );

  for (const maxInputTokens of [0, -1, 1.5, "278528", null, Number.POSITIVE_INFINITY]) {
    assertSchemaError(
      () =>
        validateSpiritConfig(
          validConfig([
            validProvider({
              models: [{ name: "m", serviceTiers: { fast: { maxInputTokens } } }],
            }),
          ]),
        ),
      '"maxInputTokens" must be a positive integer',
    );
  }

  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ thinkingSwitch: { on: { maxInputTokens: 278528 } } })]),
      ),
    'unknown key "maxInputTokens"',
  );
});

test("reasoning selections are checked against declared lists, with spec asymmetries", () => {
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({
            models: [
              { name: "m", reasoningEffort: "max", supportedReasoningEfforts: ["low", "high"] },
            ],
          }),
        ]),
      ),
    '"reasoningEffort" "max" is not in the declared "supportedReasoningEfforts"',
  );
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          models: [
            { name: "m", reasoningEffort: "default", supportedReasoningEfforts: ["low", "high"] },
          ],
        }),
      ]),
    ),
  );
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([validProvider({ models: [{ name: "m", reasoningEffort: "max" }] })]),
    ),
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({
            models: [{ name: "m", reasoningMode: "pro", supportedReasoningModes: ["standard"] }],
          }),
        ]),
      ),
    '"reasoningMode" "pro" is not in the declared "supportedReasoningModes"',
  );
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([validProvider({ models: [{ name: "m", reasoningMode: "pro" }] })]),
    ),
  );
});

test("thinkingEnabled requires a declared supportsThinkingSwitch", () => {
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          models: [{ name: "m", supportsThinkingSwitch: true, thinkingEnabled: false }],
        }),
      ]),
    ),
  );
  // Provider-level flat declaration of the switch satisfies the model-level state.
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          supportsThinkingSwitch: true,
          models: [{ name: "m", thinkingEnabled: false }],
        }),
      ]),
    ),
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ models: [{ name: "m", thinkingEnabled: false }] })]),
      ),
    '"thinkingEnabled" is set but "supportsThinkingSwitch" is not declared',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ models: [{ name: "m", thinkingEnabled: "off" }] })]),
      ),
    '"thinkingEnabled" must be a boolean',
  );
  // The user state is model-level only: a provider-level key is rejected as unknown.
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ thinkingEnabled: false })])),
    'unknown key "thinkingEnabled"',
  );
});

test("provider-level flat declarations are validated and inherited by models", () => {
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          serviceTiers: ["default", "flex"],
          serviceTier: "flex",
          supportedReasoningEfforts: ["low", "high"],
          reasoningEffort: "high",
        }),
      ]),
    ),
  );
  assertSchemaError(
    () => validateSpiritConfig(validConfig([validProvider({ serviceTier: "flex" })])),
    'providers[0]: "serviceTier" is set but no "serviceTiers" are declared',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([validProvider({ serviceTiers: ["default"], serviceTier: "flex" })]),
      ),
    'providers[0]: "serviceTier" "flex" is not in the declared "serviceTiers"',
  );
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          serviceTiers: ["default", "flex"],
          models: [{ name: "m", serviceTier: "flex" }],
        }),
      ]),
    ),
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({
            serviceTiers: ["default"],
            models: [{ name: "m", serviceTier: "flex" }],
          }),
        ]),
      ),
    '"serviceTier" "flex" is not in the declared "serviceTiers"',
  );
  assertSchemaError(
    () =>
      validateSpiritConfig(
        validConfig([
          validProvider({
            supportedReasoningModes: ["standard"],
            models: [{ name: "m", reasoningMode: "pro" }],
          }),
        ]),
      ),
    '"reasoningMode" "pro" is not in the declared "supportedReasoningModes"',
  );
  assert.doesNotThrow(() =>
    validateSpiritConfig(
      validConfig([
        validProvider({
          reasoningEffort: "low",
          supportedReasoningEfforts: ["low", "high"],
          models: [{ name: "m", supportedReasoningEfforts: ["max"], reasoningEffort: "max" }],
        }),
      ]),
    ),
  );
});

test("resolveModelEntry merges provider defaults with model overrides", () => {
  const thinkingSwitch = {
    on: { body: { thinking: { type: "enabled" } } },
    off: { body: { thinking: { type: "disabled" } } },
  };
  const provider: ProviderEntry = {
    id: "p",
    apiBase: "https://example.com/v1",
    apiKey: "secret",
    headers: { "X-Key": "v" },
    capabilities: ["languageModel", "image"],
    contextLength: 262144,
    outputLimit: 8192,
    reasoningEffort: "default",
    supportedReasoningEfforts: ["low", "high"],
    reasoningMode: "standard",
    supportedReasoningModes: ["standard", "pro"],
    supportsThinkingType: "only",
    supportsThinkingSwitch: true,
    thinkingSwitch,
    serviceTiers: ["default", "flex"],
    serviceTier: "flex",
    models: [
      { name: "bare" },
      {
        name: "tuned",
        contextLength: 1048576,
        serviceTiers: ["default", "priority"],
        serviceTier: "priority",
        supportsThinkingSwitch: false,
        thinkingEnabled: false,
      },
    ],
  };

  const bare = resolveModelEntry(provider, "bare")!;
  assert.deepEqual(bare, {
    name: "bare",
    capabilities: ["languageModel", "image"],
    contextLength: 262144,
    outputLimit: 8192,
    reasoningEffort: "default",
    supportedReasoningEfforts: ["low", "high"],
    reasoningMode: "standard",
    supportedReasoningModes: ["standard", "pro"],
    supportsThinkingType: "only",
    supportsThinkingSwitch: true,
    thinkingSwitch,
    serviceTiers: ["default", "flex"],
    serviceTier: "flex",
  });
  assert.equal("apiKey" in bare, false);
  assert.equal("headers" in bare, false);
  assert.equal("apiBase" in bare, false);

  const tuned = resolveModelEntry(provider, "tuned")!;
  assert.equal(tuned.contextLength, 1048576);
  assert.equal(tuned.outputLimit, 8192);
  assert.deepEqual(tuned.serviceTiers, ["default", "priority"]);
  assert.equal(tuned.serviceTier, "priority");
  assert.equal(tuned.supportsThinkingSwitch, false);
  assert.equal(tuned.thinkingEnabled, false);
  assert.deepEqual(tuned.thinkingSwitch, thinkingSwitch);
  // thinkingEnabled is model-level state and never inherits from the provider.
  assert.equal("thinkingEnabled" in bare, false);

  assert.equal(resolveModelEntry(provider, "missing"), undefined);

  const byRef = resolveModelByRef([provider], { providerId: "p", name: "tuned" });
  assert.equal(byRef?.model.contextLength, 1048576);
  assert.equal(resolveModelByRef([provider], { providerId: "p", name: "missing" }), undefined);
});

test("loadSpiritConfig and saveSpiritConfig round trip the new shape", async () => {
  const spiritDataDir = mkdtempSync(join(tmpdir(), "spirit-config-v1-"));
  const config: SpiritConfigFile = {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providers: [
      {
        id: "test-provider",
        apiBase: "https://example.com/v1",
        transportKind: "open-responses",
        sdk: "@ai-sdk/open-responses",
        apiKeyEnv: "TEST_PROVIDER_API_KEY",
        options: { storedState: true },
        supportedReasoningEfforts: ["low", "high"],
        models: [{ name: "test-model", contextLength: 128000 }],
      },
    ],
    activeModel: { providerId: "test-provider", name: "test-model" },
    permission: { shell: { "git *": "allow" } },
    agents: { providerTools: { enabled: false } },
  };
  await saveSpiritConfig(spiritDataDir, config);
  const loaded = loadSpiritConfig(spiritDataDir);
  assert.ok(loaded);
  assert.equal(loaded.schemaVersion, 1);
  assert.deepEqual(loaded.activeModel, { providerId: "test-provider", name: "test-model" });
  assert.equal(loaded.providers[0]?.sdk, "@ai-sdk/open-responses");
  assert.deepEqual(loaded.permission, { shell: { "git *": "allow" } });
  assert.deepEqual(loaded.agents, { providerTools: { enabled: false } });
});

test("loadSpiritConfig refuses missing, malformed, and wrong-version configs", async () => {
  const spiritDataDir = mkdtempSync(join(tmpdir(), "spirit-config-v1-empty-"));
  assert.equal(loadSpiritConfig(spiritDataDir), undefined);

  const config: SpiritConfigFile = {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providers: [],
    activeModel: emptyModelRef(),
  };
  await saveSpiritConfig(spiritDataDir, config);
  const loaded = loadSpiritConfig(spiritDataDir);
  assert.ok(loaded);
  assert.deepEqual(loaded.activeModel, { providerId: "", name: "" });
  assert.equal(isEmptyModelRef(loaded.activeModel), true);

  const legacyDir = mkdtempSync(join(tmpdir(), "spirit-config-v1-legacy-"));
  await saveSpiritConfig(legacyDir, config);
  const raw = JSON.parse(readFileSync(join(legacyDir, "config.json"), "utf8")) as Record<
    string,
    unknown
  >;
  raw["schemaVersion"] = 2;
  writeFileSync(join(legacyDir, "config.json"), JSON.stringify(raw));
  assert.equal(loadSpiritConfig(legacyDir), undefined);

  const brokenDir = mkdtempSync(join(tmpdir(), "spirit-config-v1-broken-"));
  writeFileSync(join(brokenDir, "config.json"), "{ not json");
  assert.equal(loadSpiritConfig(brokenDir), undefined);

  const invalidDir = mkdtempSync(join(tmpdir(), "spirit-config-v1-invalid-"));
  writeFileSync(
    join(invalidDir, "config.json"),
    JSON.stringify({ schemaVersion: 1, providers: [{ id: "x" }], activeModel: {} }),
  );
  assert.equal(loadSpiritConfig(invalidDir), undefined);
});
