import assert from "node:assert/strict";

import { test } from "vitest";

import {
  ALIBABA_TOKEN_PLAN_COMPATIBLE_API_BASE,
  ALIBABA_TOKEN_PLAN_DOC_URL,
  DEFAULT_CUSTOM_API_BASE,
  MODEL_PROVIDER_PICKER_ORDER,
  PRESET_MODEL_PROVIDER_PICKER_ORDER,
  PROVIDER_PICKER_ROWS,
  PROVIDER_PRESET_API_BASE,
  STEPFUN_STEP_PLAN_COMPATIBLE_API_BASE,
  STEPFUN_STEP_PLAN_DOC_URL,
  Z_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE,
  Z_AI_GLM_CODING_PLAN_DOC_URL,
  ZHIPU_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE,
  ZHIPU_AI_GLM_CODING_PLAN_DOC_URL,
  defaultProviderConnectSite,
  isModelProviderId,
  isPresetModelProviderId,
  isProviderConnectSiteId,
  listProviderConnectSiteOptions,
  parseModelProviderId,
  parsePresetModelProviderId,
  partitionModelsByProvider,
  providerConnectSiteRequiresWorkspaceId,
  providerSupportsSiteSelection,
  resolveAlibabaTokenPlanConnectApiBase,
  resolveConnectApiBase,
  resolveProviderConnectApiBase,
  resolveProviderConnectSiteApiBase,
  resolveStepfunStepPlanConnectApiBase,
  resolveZAiGlmCodingPlanConnectApiBase,
  resolveZhipuAiGlmCodingPlanConnectApiBase,
} from "./model-provider-presets.js";

// This file is a smoke test for the compatibility shim; the manifest data and the resolver parity
// coverage live in `@spiritagent/agent-core/provider-presets` tests.

test("picker order comes from the manifest array with custom last", () => {
  assert.equal(MODEL_PROVIDER_PICKER_ORDER.length, 33);
  assert.equal(MODEL_PROVIDER_PICKER_ORDER[0], "openai");
  assert.equal(MODEL_PROVIDER_PICKER_ORDER.at(-1), "custom");
  assert.equal(PRESET_MODEL_PROVIDER_PICKER_ORDER.length, 32);
  assert.ok(!(PRESET_MODEL_PROVIDER_PICKER_ORDER as readonly string[]).includes("custom"));
});

test("provider id guards accept canonical ids and reject others", () => {
  assert.equal(parseModelProviderId("alibaba"), "alibaba");
  assert.equal(parseModelProviderId("custom"), "custom");
  assert.equal(parseModelProviderId("nope"), undefined);
  assert.equal(parsePresetModelProviderId("xai"), "xai");
  assert.equal(parsePresetModelProviderId("custom"), undefined);
  assert.ok(isModelProviderId("google"));
  assert.ok(!isModelProviderId(""));
  assert.ok(isPresetModelProviderId("mistral"));
  assert.ok(!isPresetModelProviderId("custom"));
});

test("picker rows pair derived label keys with manifest labels", () => {
  assert.equal(PROVIDER_PICKER_ROWS.length, 33);
  assert.deepEqual(
    PROVIDER_PICKER_ROWS.find((row) => row.id === "kimi-code"),
    {
      id: "kimi-code",
      labelKey: "providers.kimiCode",
      fallbackLabel: "Kimi Code",
    },
  );
  assert.equal(
    PROVIDER_PICKER_ROWS.find((row) => row.id === "deepinfra")?.labelKey,
    "providers.deepInfra",
  );
  assert.deepEqual(PROVIDER_PICKER_ROWS.at(-1), {
    id: "custom",
    labelKey: "providers.custom",
    fallbackLabel: "Custom",
  });
});

test("flat preset bases resolve through the manifest default transport slot", () => {
  // deepseek's default transport is open-responses, so the flat base is the Responses endpoint.
  assert.equal(PROVIDER_PRESET_API_BASE.deepseek, "https://api.deepseek.com");
  assert.equal(PROVIDER_PRESET_API_BASE.minimax, "https://api.minimax.io/anthropic/v1");
  assert.equal(PROVIDER_PRESET_API_BASE.openai, "https://api.openai.com/v1");
  assert.equal(DEFAULT_CUSTOM_API_BASE, "https://api.openai.com/v1");
  assert.equal(
    resolveConnectApiBase("google", ""),
    "https://generativelanguage.googleapis.com/v1beta",
  );
  assert.equal(
    resolveConnectApiBase("custom", "  https://custom.example/v1 "),
    "https://custom.example/v1",
  );
});

test("resolveProviderConnectApiBase resolves transport slots, sites, and billing plans", () => {
  assert.equal(
    resolveProviderConnectApiBase("deepseek", "anthropic"),
    "https://api.deepseek.com/anthropic",
  );
  assert.equal(resolveProviderConnectApiBase("xai", "openai-compatible"), "https://api.x.ai/v1");
  assert.equal(
    resolveProviderConnectApiBase("kimi-code", "anthropic", { site: "cn" }),
    "https://api.kimi.com/coding",
  );
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "openai-compatible", {
      site: "cn-beijing",
      workspaceId: "ws-cn",
    }),
    "https://ws-cn.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.throws(
    () => resolveProviderConnectApiBase("alibaba", "openai-compatible", { site: "cn-beijing" }),
    /requires a workspace ID/,
  );
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "anthropic", { billingMode: "token-plan" }),
    "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "anthropic", { stepfunBillingMode: "step-plan" }),
    "https://api.stepfun.com/step_plan",
  );
  assert.equal(
    resolveProviderConnectApiBase("z-ai", "openai-compatible", {
      zAiBillingMode: "glm-coding-plan",
    }),
    "https://api.z.ai/api/coding/paas/v4",
  );
  assert.equal(
    resolveProviderConnectApiBase("custom", "openai-compatible", "https://custom.example/v1"),
    "https://custom.example/v1",
  );
});

test("site helpers read the manifest sites", () => {
  assert.equal(providerSupportsSiteSelection("kimi-code"), true);
  assert.equal(providerSupportsSiteSelection("xiaomi"), false);
  assert.equal(providerSupportsSiteSelection("custom"), false);
  assert.equal(defaultProviderConnectSite("kimi-code"), "intl");
  assert.deepEqual(listProviderConnectSiteOptions("kimi-code"), [
    { id: "cn", labelKey: "providers.kimiCodeSite.cn", fallbackLabel: "China" },
    { id: "intl", labelKey: "providers.kimiCodeSite.intl", fallbackLabel: "International" },
  ]);
  assert.equal(providerConnectSiteRequiresWorkspaceId("alibaba", "cn-beijing"), true);
  assert.equal(providerConnectSiteRequiresWorkspaceId("alibaba", "us-virginia"), false);
  assert.equal(providerConnectSiteRequiresWorkspaceId("custom", "cn"), false);
  assert.equal(isProviderConnectSiteId("siliconflow", "cn"), true);
  assert.equal(isProviderConnectSiteId("siliconflow", "moon"), false);
  assert.equal(
    resolveProviderConnectSiteApiBase("alibaba", "cn-beijing", "ws-1"),
    "https://ws-1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(resolveProviderConnectSiteApiBase("xiaomi", "cn"), undefined);
});

test("billing plan resolvers and constants read the manifest billing plans", () => {
  assert.equal(
    resolveStepfunStepPlanConnectApiBase("openai-compatible"),
    "https://api.stepfun.com/step_plan/v1",
  );
  assert.equal(
    resolveAlibabaTokenPlanConnectApiBase("open-responses"),
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(resolveZAiGlmCodingPlanConnectApiBase(), "https://api.z.ai/api/coding/paas/v4");
  assert.equal(
    resolveZhipuAiGlmCodingPlanConnectApiBase(),
    "https://open.bigmodel.cn/api/coding/paas/v4",
  );
  assert.equal(
    ALIBABA_TOKEN_PLAN_COMPATIBLE_API_BASE,
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.ok(ALIBABA_TOKEN_PLAN_DOC_URL.length > 0);
  assert.equal(STEPFUN_STEP_PLAN_COMPATIBLE_API_BASE, "https://api.stepfun.com/step_plan/v1");
  assert.ok(STEPFUN_STEP_PLAN_DOC_URL.length > 0);
  assert.equal(Z_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE, "https://api.z.ai/api/coding/paas/v4");
  assert.ok(Z_AI_GLM_CODING_PLAN_DOC_URL.length > 0);
  assert.equal(
    ZHIPU_AI_GLM_CODING_PLAN_COMPATIBLE_API_BASE,
    "https://open.bigmodel.cn/api/coding/paas/v4",
  );
  assert.ok(ZHIPU_AI_GLM_CODING_PLAN_DOC_URL.length > 0);
});

test("partitionModelsByProvider preserves ordering and separates unmatched entries", () => {
  const models = [
    { name: "qwen3.6-plus", provider: "alibaba" as const },
    { name: "deepseek-v4-pro", provider: "deepseek" as const },
    { name: "custom-model", provider: "custom" as const },
    { name: "legacy-openai" },
  ];

  assert.deepEqual(partitionModelsByProvider(models, "alibaba"), {
    matched: [models[0]],
    unmatched: [models[1], models[2], models[3]],
  });
});
