import assert from "node:assert/strict";

import { test } from "vitest";

import {
  CUSTOM_PROVIDER_PRESET,
  findProviderPreset,
  listProviderPresets,
  loadProviderPresetManifest,
  PROVIDER_PRESET_MANIFEST,
  ProviderPresetLoadError,
} from "./loader.js";

function minimalPreset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-provider",
    label: "Test Provider",
    defaultTransport: "openai-compatible",
    sdk: "@ai-sdk/openai-compatible",
    transports: { "openai-compatible": "https://api.example.com/v1" },
    credentials: { kind: "apiKey" },
    ...overrides,
  };
}

function manifestOf(
  providers: unknown[],
  custom: unknown = { defaultApiBase: "https://x.test/v1" },
) {
  return { custom, providers };
}

function assertLoadThrows(data: unknown, match: RegExp): void {
  assert.throws(
    () => loadProviderPresetManifest(data),
    (error: unknown) => {
      assert.ok(error instanceof ProviderPresetLoadError);
      assert.match(error.message, match);
      return true;
    },
  );
}

test("the bundled manifest loads with the 32 presets in picker order", () => {
  assert.deepEqual(
    listProviderPresets().map((preset) => preset.id),
    [
      "openai",
      "anthropic",
      "google",
      "xai",
      "vercel-ai-gateway",
      "cloudflare-ai-gateway",
      "deepseek",
      "openrouter",
      "fireworks-ai",
      "together-ai",
      "groq",
      "deepinfra",
      "baseten",
      "hugging-face",
      "moonshot-ai",
      "kimi-code",
      "z-ai",
      "zhipu-ai",
      "alibaba",
      "minimax",
      "xiaomi",
      "siliconflow",
      "stepfun",
      "volcengine",
      "byteplus",
      "meituan",
      "tencent-tokenhub",
      "mistral",
      "cohere",
      "azure",
      "amazon-bedrock",
      "google-vertex-ai",
    ],
  );
  assert.equal(CUSTOM_PROVIDER_PRESET.defaultApiBase, "https://api.openai.com/v1");
});

test("manifest invariants: credentials on every preset, sdk everywhere except bedrock", () => {
  for (const preset of PROVIDER_PRESET_MANIFEST.providers) {
    assert.ok(preset.credentials.kind, `${preset.id} credentials.kind`);
    if (preset.defaultTransport === "bedrock") {
      assert.equal(preset.sdk, undefined, `${preset.id} must not declare an sdk`);
    } else {
      assert.ok(preset.sdk && preset.sdk.startsWith("@ai-sdk/"), `${preset.id} sdk`);
    }
    assert.ok(preset.transports[preset.defaultTransport], `${preset.id} default transport slot`);
  }
});

test("manifest catalog parser names are the coordinated shape-name set", () => {
  const parsers = [
    ...new Set(
      PROVIDER_PRESET_MANIFEST.providers.flatMap((preset) =>
        preset.catalog ? [preset.catalog.parser] : [],
      ),
    ),
  ].sort();
  assert.deepEqual(parsers, [
    "anthropic-models",
    "ark-models",
    "baseten-models",
    "bedrock-models",
    "cohere-models",
    "deepinfra-models",
    "fireworks-gateway-models",
    "google-gemini-models",
    "google-vertex-models",
    "groq-models",
    "huggingface-models",
    "kimi-code-models",
    "meituan-models",
    "minimax-models",
    "mistral-models",
    "moonshot-models",
    "openai-models",
    "openrouter-models",
    "siliconflow-models",
    "stepfun-models",
    "tencent-tokenhub-models",
    "together-models",
    "vercel-gateway-models",
    "xiaomi-models",
  ]);
  // No model listing API today: entries are entered manually in the wizard.
  assert.equal(findProviderPreset("cloudflare-ai-gateway")?.catalog, undefined);
  assert.equal(findProviderPreset("azure")?.catalog, undefined);
});

test("loader rejects a non-object root and a missing providers array", () => {
  assertLoadThrows(null, /root must be an object/);
  assertLoadThrows({}, /"custom" must be an object/);
  assertLoadThrows(manifestOf(undefined as never), /"providers" must be an array/);
});

test("loader rejects duplicate provider ids", () => {
  assertLoadThrows(manifestOf([minimalPreset(), minimalPreset()]), /duplicate provider id/);
});

test("loader rejects entries without a label or with an empty sdk", () => {
  assertLoadThrows(manifestOf([{ ...minimalPreset(), label: "" }]), /non-empty "label"/);
  assertLoadThrows(manifestOf([{ ...minimalPreset(), sdk: "  " }]), /"sdk" must be a non-empty/);
});

test("loader rejects an unknown defaultTransport", () => {
  assertLoadThrows(
    manifestOf([minimalPreset({ defaultTransport: "grpc" })]),
    /defaultTransport.*one of/,
  );
});

test("loader rejects empty transports, unknown transport keys, and a missing default slot", () => {
  assertLoadThrows(manifestOf([minimalPreset({ transports: {} })]), /non-empty object/);
  assertLoadThrows(
    manifestOf([
      minimalPreset({ transports: { "openai-compatible": "https://a", grpc: "https://b" } }),
    ]),
    /unknown transport kind/,
  );
  assertLoadThrows(
    manifestOf([
      minimalPreset({
        defaultTransport: "anthropic",
        transports: { "openai-compatible": "https://a" },
      }),
    ]),
    /must contain the default transport/,
  );
});

test("loader rejects malformed sites: bad default, duplicate ids, missing base", () => {
  assertLoadThrows(
    manifestOf([
      minimalPreset({
        sites: { default: "nope", items: [{ id: "a", label: "A", apiBase: "https://a" }] },
      }),
    ]),
    /sites\.default.*must exist in items/,
  );
  assertLoadThrows(
    manifestOf([
      minimalPreset({
        sites: {
          default: "a",
          items: [
            { id: "a", label: "A", apiBase: "https://a" },
            { id: "a", label: "A2", apiBase: "https://a2" },
          ],
        },
      }),
    ]),
    /duplicate site id/,
  );
  assertLoadThrows(
    manifestOf([
      minimalPreset({
        sites: { default: "a", items: [{ id: "a", label: "A" }] },
      }),
    ]),
    /requires "apiBase" or "transports"/,
  );
  assertLoadThrows(
    manifestOf([
      minimalPreset({
        sites: {
          default: "a",
          items: [{ id: "a", label: "A", apiBase: "https://a", requiresWorkspaceId: false }],
        },
      }),
    ]),
    /requiresWorkspaceId.*must be true/,
  );
});

test("loader rejects malformed billing plans", () => {
  assertLoadThrows(
    manifestOf([
      minimalPreset({
        billingPlans: [
          { id: "plan", apiBase: "https://a" },
          { id: "plan", apiBase: "https://b" },
        ],
      }),
    ]),
    /duplicate billing plan id/,
  );
  assertLoadThrows(
    manifestOf([minimalPreset({ billingPlans: [{ id: "plan" }] })]),
    /requires "apiBase" or "transports"/,
  );
});

test("loader rejects missing or unknown credentials kinds", () => {
  assertLoadThrows(manifestOf([{ ...minimalPreset(), credentials: undefined }]), /credentials/);
  assertLoadThrows(
    manifestOf([minimalPreset({ credentials: { kind: "oauth" } })]),
    /credentials\.kind must be one of/,
  );
});

test("loader rejects invalid providerTools entries via the providerTools contract", () => {
  assertLoadThrows(manifestOf([minimalPreset({ providerTools: [{}] })]), /at least one of/);
  assertLoadThrows(
    manifestOf([minimalPreset({ providerTools: [{ execute: { path: "/x" } }] })]),
    /"execute" requires "tools" or "toolsFrom"/,
  );
  assertLoadThrows(
    manifestOf([
      minimalPreset({
        providerTools: [
          {
            tools: [{ type: "function", function: { name: "web_search" } }],
            execute: { path: "/x", resultsPath: "results" },
          },
        ],
      }),
    ]),
    /"resultsPath" and "fields" must be declared together/,
  );
});

test("loader rejects invalid fileUpload via the fileUpload contract", () => {
  assertLoadThrows(
    manifestOf([minimalPreset({ fileUpload: { path: "/files" } })]),
    /fileUpload.*refTemplate/,
  );
  assertLoadThrows(
    manifestOf([minimalPreset({ fileUpload: { path: "/files", refTemplate: "noid" } })]),
    /\{id\}/,
  );
});

test("loader rejects a catalog without a parser", () => {
  assertLoadThrows(manifestOf([minimalPreset({ catalog: { endpoint: "/models" } })]), /parser/);
});

test("loader accepts an options template object and rejects non-objects", () => {
  const manifest = loadProviderPresetManifest(
    manifestOf([minimalPreset({ options: { echoServerToolCalls: true } })]),
  );
  assert.deepEqual(manifest.providers[0]?.options, { echoServerToolCalls: true });

  assertLoadThrows(
    manifestOf([minimalPreset({ options: "echoServerToolCalls" })]),
    /options must be an object/,
  );
  assertLoadThrows(manifestOf([minimalPreset({ options: [] })]), /options must be an object/);
});

test("findProviderPreset matches exactly and ignores surrounding whitespace", () => {
  assert.equal(findProviderPreset("kimi-code")?.label, "Kimi Code");
  assert.equal(findProviderPreset(" kimi-code ")?.id, "kimi-code");
  assert.equal(findProviderPreset("nope"), undefined);
});
