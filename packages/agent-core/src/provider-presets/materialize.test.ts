import assert from "node:assert/strict";

import { test } from "vitest";

import { ProviderPresetApiBaseError } from "./api-base.js";
import { PROVIDER_PRESET_MANIFEST } from "./loader.js";
import {
  fallbackSdkPackageName,
  materializeProviderPreset,
  ProviderPresetMaterializeError,
  slugifyCustomProviderLabel,
} from "./materialize.js";

test("minimax materializes the anthropic default with the server-tool and upload templates", () => {
  const entry = materializeProviderPreset({ presetId: "minimax" });
  assert.deepEqual(entry, {
    id: "minimax",
    label: "MiniMax",
    apiBase: "https://api.minimax.io/anthropic/v1",
    transportKind: "anthropic",
    sdk: "@ai-sdk/minimax",
    providerTools: [
      {
        label: "Web Search",
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      },
    ],
    fileUpload: {
      url: "https://api.minimax.io/v1/files/upload",
      purpose: { video: "video_understanding" },
      idPath: "file.file_id",
      refTemplate: "mm_file://{id}",
    },
    models: [],
  });
});

test("minimax cn site overrides the upload channel with the region-pinned host", () => {
  const entry = materializeProviderPreset({ presetId: "minimax", siteId: "cn" });
  assert.equal(entry.apiBase, "https://api.minimax.cn/anthropic/v1");
  assert.equal(entry.fileUpload?.url, "https://api.minimax.cn/v1/files/upload");
  // The default (intl) site keeps the provider-level channel.
  const intl = materializeProviderPreset({ presetId: "minimax", siteId: "intl" });
  assert.equal(intl.fileUpload?.url, "https://api.minimax.io/v1/files/upload");
});

test("kimi-code materializes the spec's variant A shape (transportKind omitted, host-executed search)", () => {
  const entry = materializeProviderPreset({ presetId: "kimi-code", siteId: "cn" });
  assert.equal(entry.apiBase, "https://api.kimi.com/coding/v1");
  assert.equal(entry.transportKind, undefined);
  assert.equal(entry.sdk, "@ai-sdk/openai-compatible");
  assert.deepEqual(entry.fileUpload, {
    path: "/files",
    purpose: { video: "video" },
    refTemplate: "ms://{id}",
  });
  const tool = entry.providerTools?.[0];
  assert.equal(tool?.label, "Web Search");
  assert.deepEqual(tool?.execute, {
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
  });
  const toolEntry = tool?.tools?.[0];
  assert.ok(toolEntry);
  const schema = (
    toolEntry as { function: { parameters: { properties: Record<string, unknown> } } }
  ).function.parameters;
  assert.equal("max_results" in schema.properties, false);
});

test("non-default transports bake host-executed execute endpoints as absolute URLs on the openai-compatible root", () => {
  // kimi-code on the anthropic transport: /search must still hit the coding/v1 root.
  const entry = materializeProviderPreset({
    presetId: "kimi-code",
    transportKind: "anthropic",
    siteId: "cn",
  });
  assert.equal(entry.apiBase, "https://api.kimi.com/coding");
  assert.deepEqual(entry.providerTools?.[0]?.execute?.url, "https://api.kimi.com/coding/v1/search");
  assert.equal(entry.providerTools?.[0]?.execute?.path, undefined);

  const stepfun = materializeProviderPreset({
    presetId: "stepfun",
    transportKind: "anthropic",
    siteId: "intl",
  });
  assert.deepEqual(stepfun.providerTools?.[0]?.execute?.url, "https://api.stepfun.ai/v1/search");

  // The default transport keeps the relative path (joined against the chat base at runtime).
  const kimiDefault = materializeProviderPreset({ presetId: "kimi-code", siteId: "cn" });
  assert.equal(kimiDefault.providerTools?.[0]?.execute?.path, "/search");
  assert.equal(kimiDefault.providerTools?.[0]?.execute?.url, undefined);
});

test("non-default transports bake fileUpload.path as an absolute URL on the openai-compatible root", () => {
  // kimi-code on the anthropic transport: /files must still hit the coding/v1 root.
  const entry = materializeProviderPreset({
    presetId: "kimi-code",
    transportKind: "anthropic",
    siteId: "cn",
  });
  assert.equal(entry.apiBase, "https://api.kimi.com/coding");
  assert.deepEqual(entry.fileUpload, {
    url: "https://api.kimi.com/coding/v1/files",
    purpose: { video: "video" },
    refTemplate: "ms://{id}",
  });

  const stepfun = materializeProviderPreset({
    presetId: "stepfun",
    transportKind: "anthropic",
    siteId: "intl",
  });
  assert.equal(stepfun.fileUpload?.url, "https://api.stepfun.ai/v1/files");
  assert.equal(stepfun.fileUpload?.path, undefined);

  // The default transport keeps the relative path (joined against the chat base at runtime).
  const kimiDefault = materializeProviderPreset({ presetId: "kimi-code", siteId: "cn" });
  assert.equal(kimiDefault.fileUpload?.path, "/files");
  assert.equal(kimiDefault.fileUpload?.url, undefined);
});

test("moonshot-ai materializes the formula entry with ciphertext UI lockdown", () => {
  const entry = materializeProviderPreset({ presetId: "moonshot-ai" });
  const tool = entry.providerTools?.[0];
  assert.deepEqual(tool?.tools, [
    {
      type: "moonshot_formula",
      formula_uri: "moonshot/web-search:latest",
      function_name: "web_search",
    },
  ]);
  assert.deepEqual(tool?.toolsFrom, { path: "/formulas/moonshot/web-search:latest/tools" });
  assert.deepEqual(tool?.execute, {
    path: "/formulas/moonshot/web-search:latest/fibers",
    body: { name: "{toolName}", arguments: "{argumentsJson}" },
    statusPath: "status",
    okValue: "succeeded",
    errorPath: ["error", "context.error", "context.output"],
    resultPath: ["context.encrypted_output", "context.output"],
  });
  assert.deepEqual(tool?.ui, { expand: false });
  assert.equal(entry.sdk, "@ai-sdk/moonshotai");
});

test("z-ai and zhipu-ai bake their static search bodies into the execute declaration", () => {
  const zai = materializeProviderPreset({ presetId: "z-ai" });
  assert.deepEqual(zai.providerTools?.[0]?.execute?.body, {
    search_engine: "search-prime",
    search_query: "{arg.query}",
    count: "{arg.max_results}",
  });
  const zhipu = materializeProviderPreset({ presetId: "zhipu-ai" });
  assert.deepEqual(zhipu.providerTools?.[0]?.execute?.body, {
    search_engine: "search_std",
    search_intent: false,
    search_query: "{arg.query}",
    count: "{arg.max_results}",
  });
  assert.equal(zai.providerTools?.[0]?.execute?.path, "/web_search");
});

test("openai, xai, deepseek and the gateway carry their literal server-side search entries", () => {
  const openai = materializeProviderPreset({ presetId: "openai" });
  assert.deepEqual(openai.providerTools, [
    { label: "Web Search", tools: [{ type: "web_search" }] },
  ]);
  assert.equal(openai.transportKind, "open-responses");
  assert.equal(openai.sdk, "@ai-sdk/openai");
  assert.equal(openai.imageApi, "openai-images");

  const xai = materializeProviderPreset({ presetId: "xai" });
  assert.equal(xai.transportKind, "open-responses");
  assert.equal(xai.sdk, "@ai-sdk/xai");
  assert.deepEqual(xai.providerTools, [{ label: "Web Search", tools: [{ type: "web_search" }] }]);

  const deepseek = materializeProviderPreset({ presetId: "deepseek" });
  assert.equal(deepseek.transportKind, "open-responses");
  assert.equal(deepseek.sdk, "@ai-sdk/open-responses");
  assert.deepEqual(deepseek.providerTools, [
    { label: "Web Search", tools: [{ type: "web_search" }] },
  ]);

  const gateway = materializeProviderPreset({ presetId: "vercel-ai-gateway" });
  assert.equal(gateway.sdk, "@ai-sdk/gateway");
  assert.deepEqual(gateway.providerTools, [
    {
      label: "Perplexity Search",
      tools: [{ type: "provider", id: "gateway.perplexity_search", name: "web_search", args: {} }],
    },
  ]);
  assert.equal(gateway.videoApi, "vercel-gateway-videos");
});

test("alibaba materializes body-only tool entries and the token plan override", () => {
  const standard = materializeProviderPreset({ presetId: "alibaba" });
  assert.deepEqual(standard.providerTools, [
    {
      label: "Web Search",
      body: { enable_search: true, search_options: { search_strategy: "agent_max" } },
    },
    { label: "Code Interpreter", body: { enable_code_interpreter: true } },
  ]);
  assert.equal(standard.sdk, "@ai-sdk/alibaba");

  const plan = materializeProviderPreset({ presetId: "alibaba", billingPlanId: "token-plan" });
  assert.equal(plan.apiBase, "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");

  const site = materializeProviderPreset({
    presetId: "alibaba",
    siteId: "cn-beijing",
    workspaceId: "ws-9",
  });
  assert.equal(site.apiBase, "https://ws-9.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
});

test("stepfun materializes the step plan base per transport", () => {
  const entry = materializeProviderPreset({
    presetId: "stepfun",
    billingPlanId: "step-plan",
    transportKind: "anthropic",
  });
  assert.equal(entry.apiBase, "https://api.stepfun.com/step_plan");
  assert.equal(entry.transportKind, "anthropic");
  // Anthropic is not stepfun's default transport: the sdk falls back to the transport adapter.
  assert.equal(entry.sdk, "@ai-sdk/anthropic");
});

test("a non-default transport falls back to the transport-generic sdk", () => {
  const siliconflow = materializeProviderPreset({
    presetId: "siliconflow",
    transportKind: "anthropic",
    siteId: "cn",
  });
  assert.equal(siliconflow.apiBase, "https://api.siliconflow.cn/v1");
  assert.equal(siliconflow.sdk, "@ai-sdk/anthropic");
  assert.equal(siliconflow.transportKind, "anthropic");

  const openrouter = materializeProviderPreset({
    presetId: "openrouter",
    transportKind: "open-responses",
  });
  assert.equal(openrouter.sdk, "@ai-sdk/open-responses");
});

test("amazon-bedrock omits the sdk (self-held transport) and substitutes the region", () => {
  const entry = materializeProviderPreset({
    presetId: "amazon-bedrock",
    templateValues: { awsRegion: "us-east-1" },
  });
  assert.equal(entry.apiBase, "https://bedrock.us-east-1.amazonaws.com");
  assert.equal(entry.transportKind, "bedrock");
  assert.equal("sdk" in entry, false);
  assert.equal(entry.providerTools, undefined);
});

test("google-vertex-ai requires project/location template values", () => {
  assert.throws(
    () => materializeProviderPreset({ presetId: "google-vertex-ai" }),
    (error) => {
      assert.ok(error instanceof ProviderPresetApiBaseError);
      assert.match(error.message, /unresolved placeholders/);
      return true;
    },
  );
  const entry = materializeProviderPreset({
    presetId: "google-vertex-ai",
    templateValues: { project: "p", location: "us-central1" },
  });
  assert.equal(
    entry.apiBase,
    "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1",
  );
  assert.equal(entry.sdk, "@ai-sdk/google-vertex");
});

test("google-vertex-ai with the apiKey credential form materializes the Express base", () => {
  const entry = materializeProviderPreset({
    presetId: "google-vertex-ai",
    credentialKind: "apiKey",
  });
  assert.equal(entry.apiBase, "https://aiplatform.googleapis.com/v1/publishers/google");
  assert.equal(entry.sdk, "@ai-sdk/google-vertex");
  assert.equal(entry.options, undefined);
});

test("amazon-bedrock with the apiKey credential form keeps the regional base (no express path)", () => {
  const entry = materializeProviderPreset({
    presetId: "amazon-bedrock",
    credentialKind: "apiKey",
    templateValues: { awsRegion: "us-west-2" },
  });
  assert.equal(entry.apiBase, "https://bedrock.us-west-2.amazonaws.com");
});

test("kimi-code carries the stream_options include_usage body template", () => {
  const entry = materializeProviderPreset({ presetId: "kimi-code" });
  assert.deepEqual(entry.body, { stream_options: { include_usage: true } });
  (entry.body as { stream_options?: unknown }).stream_options = { include_usage: false };
  const manifestEntry = PROVIDER_PRESET_MANIFEST.providers.find(
    (preset) => preset.id === "kimi-code",
  );
  assert.deepEqual(manifestEntry?.body, { stream_options: { include_usage: true } });
});

test("ark presets carry the stream_options include_usage body template", () => {
  // Ark streaming Chat Completions only returns usage in the final chunk when the request body
  // carries stream_options; dev sent it for the ark vendors unconditionally.
  for (const presetId of ["volcengine", "byteplus"] as const) {
    const entry = materializeProviderPreset({ presetId });
    assert.deepEqual(entry.body, { stream_options: { include_usage: true } }, presetId);
  }
});

test("meituan carries the thinking.type switch encoding template", () => {
  const entry = materializeProviderPreset({ presetId: "meituan" });
  assert.deepEqual(entry.thinkingSwitch, {
    on: { body: { thinking: { type: "enabled" } } },
    off: { body: { thinking: { type: "disabled" } } },
  });
});

test("mechanism options templates materialize scoped to the selected transport", () => {
  const cloudflare = materializeProviderPreset({
    presetId: "cloudflare-ai-gateway",
    templateValues: { accountId: "acc-1" },
  });
  assert.deepEqual(cloudflare.options, { toolsRejectReasoningEffort: true });

  const deepseek = materializeProviderPreset({ presetId: "deepseek" });
  assert.equal(deepseek.transportKind, "open-responses");
  assert.deepEqual(deepseek.options, { echoServerToolCalls: true });
  // The echo convention is open-responses-scoped: the chat-completions transport drops the key.
  const deepseekChat = materializeProviderPreset({
    presetId: "deepseek",
    transportKind: "openai-compatible",
  });
  assert.equal(deepseekChat.options, undefined);

  const volcengineResponses = materializeProviderPreset({
    presetId: "volcengine",
    transportKind: "open-responses",
  });
  assert.deepEqual(volcengineResponses.options, { defaultInputItemStatus: "completed" });
  const byteplusResponses = materializeProviderPreset({
    presetId: "byteplus",
    transportKind: "open-responses",
  });
  assert.deepEqual(byteplusResponses.options, { defaultInputItemStatus: "completed" });
  // Ark's default transport is openai-compatible: the input-item status patch does not apply there.
  const volcengineChat = materializeProviderPreset({ presetId: "volcengine" });
  assert.equal(volcengineChat.transportKind, undefined);
  assert.equal(volcengineChat.options, undefined);

  const xiaomi = materializeProviderPreset({ presetId: "xiaomi" });
  assert.deepEqual(xiaomi.options, { maxInlineMediaBytes: 52428800 });

  // apply_patch declarations: openai / vercel-ai-gateway are pinned to open-responses and always
  // carry the key; openrouter / cloudflare-ai-gateway only over the open-responses transport.
  assert.deepEqual(materializeProviderPreset({ presetId: "openai" }).options, {
    applyPatch: true,
    reasoningSummary: true,
  });
  assert.deepEqual(materializeProviderPreset({ presetId: "vercel-ai-gateway" }).options, {
    applyPatch: true,
    reasoningSummary: true,
  });
  assert.equal(materializeProviderPreset({ presetId: "openrouter" }).options, undefined);
  assert.deepEqual(
    materializeProviderPreset({ presetId: "openrouter", transportKind: "open-responses" }).options,
    { applyPatch: true, reasoningSummary: true },
  );
  assert.deepEqual(
    materializeProviderPreset({
      presetId: "cloudflare-ai-gateway",
      transportKind: "open-responses",
      templateValues: { accountId: "acc-1" },
    }).options,
    { applyPatch: true, reasoningSummary: true },
  );

  // reasoning.summary declarations: the Responses surfaces that honor OpenAI-style
  // reasoning.summary opt in; deepseek / ark / stepfun reject the field and never declare it.
  assert.deepEqual(materializeProviderPreset({ presetId: "xai" }).options, {
    reasoningSummary: true,
  });
  assert.deepEqual(
    materializeProviderPreset({ presetId: "azure", templateValues: { resourceName: "res" } })
      .options,
    { reasoningSummary: true },
  );
  assert.deepEqual(materializeProviderPreset({ presetId: "hugging-face" }).options, {
    reasoningSummary: true,
  });
  assert.deepEqual(
    materializeProviderPreset({ presetId: "fireworks-ai", transportKind: "open-responses" })
      .options,
    { reasoningSummary: true },
  );
  assert.deepEqual(
    materializeProviderPreset({ presetId: "alibaba", transportKind: "open-responses" }).options,
    { reasoningSummary: true },
  );
  assert.deepEqual(
    materializeProviderPreset({ presetId: "xiaomi", transportKind: "open-responses" }).options,
    { reasoningSummary: true },
  );
  assert.deepEqual(deepseek.options, { echoServerToolCalls: true });
  assert.deepEqual(volcengineResponses.options, { defaultInputItemStatus: "completed" });
  assert.equal(
    materializeProviderPreset({ presetId: "stepfun", transportKind: "open-responses" }).options,
    undefined,
  );

  // The materialized options are a deep copy that never aliases the manifest.
  xiaomi.options!["maxInlineMediaBytes"] = 1;
  const manifestEntry = PROVIDER_PRESET_MANIFEST.providers.find((preset) => preset.id === "xiaomi");
  assert.equal(manifestEntry?.options?.["maxInlineMediaBytes"], 52428800);
});

test("anthropic has no provider tools today (server-side search was never integrated)", () => {
  const entry = materializeProviderPreset({ presetId: "anthropic" });
  assert.equal(entry.transportKind, "anthropic");
  assert.equal(entry.sdk, "@ai-sdk/anthropic");
  assert.equal(entry.providerTools, undefined);
});

test("custom materializes the default base, a label-derived slug id, and no sdk", () => {
  const plain = materializeProviderPreset({ presetId: "custom" });
  assert.deepEqual(plain, {
    id: "custom",
    apiBase: "https://api.openai.com/v1",
    models: [],
  });

  const labeled = materializeProviderPreset({
    presetId: "custom",
    label: "My Lab LLM",
    apiBaseOverride: "http://192.168.1.10:8000/v1",
    transportKind: "anthropic",
  });
  assert.deepEqual(labeled, {
    id: "my-lab-llm",
    label: "My Lab LLM",
    apiBase: "http://192.168.1.10:8000/v1",
    transportKind: "anthropic",
    models: [],
  });
});

test("slugifyCustomProviderLabel mirrors the legacy group-label slug behavior", () => {
  assert.equal(slugifyCustomProviderLabel("My Lab LLM"), "my-lab-llm");
  assert.equal(slugifyCustomProviderLabel("  Spaces  And  Case  "), "spaces-and-case");
  assert.equal(slugifyCustomProviderLabel("!!!"), "custom-group");
  assert.equal(slugifyCustomProviderLabel("x".repeat(80)), "x".repeat(64));
});

test("label overrides the preset fallback label; unknown presets throw", () => {
  const entry = materializeProviderPreset({ presetId: "openai", label: "Company OpenAI" });
  assert.equal(entry.label, "Company OpenAI");
  assert.throws(
    () => materializeProviderPreset({ presetId: "nope" }),
    ProviderPresetMaterializeError,
  );
});

test("azure requires the resource name template value", () => {
  assert.throws(() => materializeProviderPreset({ presetId: "azure" }), /unresolved placeholders/);
  const entry = materializeProviderPreset({
    presetId: "azure",
    templateValues: { resourceName: "my-resource" },
  });
  assert.equal(entry.apiBase, "https://my-resource.openai.azure.com/openai/v1");
  assert.equal(entry.sdk, "@ai-sdk/azure");
});

test("materialized templates are deep copies that never alias the manifest", () => {
  const entry = materializeProviderPreset({ presetId: "kimi-code" });
  assert.ok(entry.providerTools);
  entry.providerTools[0]!.label = "Mutated";
  const manifestEntry = PROVIDER_PRESET_MANIFEST.providers.find(
    (preset) => preset.id === "kimi-code",
  );
  assert.equal(manifestEntry?.providerTools?.[0]?.label, "Web Search");
});

test("fallbackSdkPackageName maps transports to their generic adapters", () => {
  assert.equal(fallbackSdkPackageName("openai-compatible"), "@ai-sdk/openai-compatible");
  assert.equal(fallbackSdkPackageName("open-responses"), "@ai-sdk/open-responses");
  assert.equal(fallbackSdkPackageName("anthropic"), "@ai-sdk/anthropic");
  assert.equal(fallbackSdkPackageName("bedrock"), undefined);
});
