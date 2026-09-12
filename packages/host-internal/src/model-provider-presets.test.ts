import { test } from "vitest";
import assert from "node:assert/strict";

import {
  defaultProviderConnectSite,
  listProviderConnectSiteOptions,
  parseModelProviderId,
  parsePresetModelProviderId,
  parseProviderSiteSelection,
  partitionModelsByProvider,
  providerSupportsSiteSelection,
  resolveProviderConnectApiBase,
  resolveProviderConnectSiteApiBase,
  resolveConnectApiBase,
} from "./model-provider-presets.js";
import { cloudflareAiGatewayApiBaseFromAccountId } from "./cloudflare-ai-gateway-resource.js";

test("parse model provider helpers accept canonical ids and reject invalid values", () => {
  assert.equal(parseModelProviderId("alibaba"), "alibaba");
  assert.equal(parseModelProviderId("vercel-ai-gateway"), "vercel-ai-gateway");
  assert.equal(parseModelProviderId("cloudflare-ai-gateway"), "cloudflare-ai-gateway");
  assert.equal(parseModelProviderId("openrouter"), "openrouter");
  assert.equal(parseModelProviderId("openai"), "openai");
  assert.equal(parseModelProviderId("google"), "google");
  assert.equal(parseModelProviderId("xai"), "xai");
  assert.equal(parseModelProviderId("custom"), "custom");
  assert.equal(parseModelProviderId("moonshot-ai"), "moonshot-ai");
  assert.equal(parseModelProviderId("kimi-code"), "kimi-code");
  assert.equal(parseModelProviderId("z-ai"), "z-ai");
  assert.equal(parseModelProviderId("zhipu-ai"), "zhipu-ai");
  assert.equal(parseModelProviderId("xiaomi"), "xiaomi");
  assert.equal(parseModelProviderId("meituan"), "meituan");
  assert.equal(parseModelProviderId("mistral"), "mistral");
  assert.equal(parseModelProviderId("siliconflow"), "siliconflow");
  assert.equal(parseModelProviderId("fireworks-ai"), "fireworks-ai");
  assert.equal(parseModelProviderId("together-ai"), "together-ai");
  assert.equal(parseModelProviderId("groq"), "groq");
  assert.equal(parseModelProviderId("deepinfra"), "deepinfra");
  assert.equal(parseModelProviderId("hugging-face"), "hugging-face");
  assert.equal(parseModelProviderId("baseten"), "baseten");
  assert.equal(parseModelProviderId("cohere"), "cohere");
  assert.equal(parseModelProviderId("azure"), "azure");
  assert.equal(parseModelProviderId("kimi"), undefined);
  assert.equal(parseModelProviderId("unknown"), undefined);
  assert.equal(parseModelProviderId(""), undefined);

  assert.equal(parsePresetModelProviderId("alibaba"), "alibaba");
  assert.equal(parsePresetModelProviderId("xai"), "xai");
  assert.equal(parsePresetModelProviderId("custom"), undefined);
  assert.equal(parsePresetModelProviderId("unknown"), undefined);
});

test("partition models by provider preserves ordering and separates unmatched entries", () => {
  const models = [
    { name: "qwen3.6-plus", provider: "alibaba" as const },
    { name: "deepseek-v4-pro", provider: "deepseek" as const },
    { name: "qwen3.6-max-preview", provider: "alibaba" as const },
    { name: "custom-model", provider: "custom" as const },
    { name: "legacy-openai" },
  ];

  assert.deepEqual(partitionModelsByProvider(models, "alibaba"), {
    matched: [models[0], models[2]],
    unmatched: [models[1], models[3], models[4]],
  });
});

test("resolveProviderConnectApiBase uses transport-specific preset bases", () => {
  assert.equal(resolveProviderConnectApiBase("xai", "openai-compatible"), "https://api.x.ai/v1");
  assert.equal(resolveProviderConnectApiBase("xai", "open-responses"), "https://api.x.ai/v1");
  assert.equal(
    resolveProviderConnectApiBase("minimax", "anthropic"),
    "https://api.minimax.io/anthropic/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("deepseek", "anthropic"),
    "https://api.deepseek.com/anthropic",
  );
  assert.equal(
    resolveProviderConnectApiBase("meituan", "openai-compatible"),
    "https://api.longcat.chat/openai/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("meituan", "anthropic"),
    "https://api.longcat.chat/anthropic/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("deepseek", "open-responses"),
    "https://api.deepseek.com",
  );
  assert.equal(
    resolveProviderConnectApiBase("mistral", "openai-compatible"),
    "https://api.mistral.ai/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("xiaomi", "openai-compatible"),
    "https://api.xiaomimimo.com/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("xiaomi", "anthropic"),
    "https://api.xiaomimimo.com/anthropic",
  );
  assert.equal(
    resolveProviderConnectApiBase("xiaomi", "open-responses"),
    "https://api.xiaomimimo.com/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "openai-compatible"),
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "open-responses"),
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "anthropic"),
    "https://dashscope.aliyuncs.com/apps/anthropic",
  );
  assert.equal(
    resolveProviderConnectApiBase("openai", "open-responses"),
    "https://api.openai.com/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("google", "openai-compatible"),
    "https://generativelanguage.googleapis.com/v1beta",
  );
  assert.equal(
    resolveProviderConnectApiBase("azure", "open-responses"),
    "https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1",
  );
});

test("resolveProviderConnectApiBase returns Baseten preset base", () => {
  assert.equal(
    resolveProviderConnectApiBase("baseten", "openai-compatible"),
    "https://inference.baseten.co/v1",
  );
});

test("resolveProviderConnectApiBase returns Groq preset base", () => {
  assert.equal(
    resolveProviderConnectApiBase("groq", "openai-compatible"),
    "https://api.groq.com/openai/v1",
  );
});

test("resolveProviderConnectApiBase returns DeepInfra preset base", () => {
  assert.equal(
    resolveProviderConnectApiBase("deepinfra", "openai-compatible"),
    "https://api.deepinfra.com/v1/openai",
  );
});

test("resolveProviderConnectApiBase returns OpenRouter preset base", () => {
  assert.equal(
    resolveProviderConnectApiBase("openrouter", "openai-compatible"),
    "https://openrouter.ai/api/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("openrouter", "open-responses"),
    "https://openrouter.ai/api/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("openrouter", "anthropic"),
    "https://openrouter.ai/api/v1",
  );
});

test("resolveProviderConnectApiBase returns Cloudflare AI Gateway preset base for all transports", () => {
  assert.equal(
    resolveProviderConnectApiBase("cloudflare-ai-gateway", "openai-compatible"),
    "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("cloudflare-ai-gateway", "open-responses"),
    "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("cloudflare-ai-gateway", "anthropic"),
    "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
  );
  assert.equal(
    cloudflareAiGatewayApiBaseFromAccountId("0123456789abcdef0123456789abcdef"),
    "https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1",
  );
});

test("resolveProviderConnectApiBase returns Fireworks transport-specific preset bases", () => {
  assert.equal(
    resolveProviderConnectApiBase("fireworks-ai", "openai-compatible"),
    "https://api.fireworks.ai/inference/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("fireworks-ai", "open-responses"),
    "https://api.fireworks.ai/inference/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("fireworks-ai", "anthropic"),
    "https://api.fireworks.ai/inference",
  );
});

test("resolveProviderConnectApiBase returns Together AI preset base", () => {
  assert.equal(
    resolveProviderConnectApiBase("together-ai", "openai-compatible"),
    "https://api.together.ai/v1",
  );
});

test("resolveProviderConnectApiBase returns Hugging Face preset base", () => {
  assert.equal(
    resolveProviderConnectApiBase("hugging-face", "open-responses"),
    "https://router.huggingface.co/v1",
  );
});

test("resolveProviderConnectApiBase returns Cohere preset base", () => {
  assert.equal(
    resolveProviderConnectApiBase("cohere", "openai-compatible"),
    "https://api.cohere.com/v2",
  );
});

test("resolveProviderConnectApiBase returns Z.ai preset base", () => {
  assert.equal(
    resolveProviderConnectApiBase("z-ai", "openai-compatible"),
    "https://api.z.ai/api/paas/v4",
  );
  assert.equal(
    resolveProviderConnectApiBase("z-ai", "openai-compatible", {
      zAiBillingMode: "glm-coding-plan",
    }),
    "https://api.z.ai/api/coding/paas/v4",
  );
});

test("resolveProviderConnectApiBase returns Zhipu AI preset base", () => {
  assert.equal(
    resolveProviderConnectApiBase("zhipu-ai", "openai-compatible"),
    "https://open.bigmodel.cn/api/paas/v4",
  );
  assert.equal(
    resolveProviderConnectApiBase("zhipu-ai", "openai-compatible", {
      zhipuBillingMode: "glm-coding-plan",
    }),
    "https://open.bigmodel.cn/api/coding/paas/v4",
  );
});

test("resolveProviderConnectApiBase ignores endpoint override for preset providers", () => {
  assert.equal(
    resolveProviderConnectApiBase("deepseek", "anthropic", "https://custom.example/v1"),
    "https://api.deepseek.com/anthropic",
  );
  assert.equal(
    resolveProviderConnectApiBase("google", "openai-compatible", "https://api.openai.com/v1"),
    "https://generativelanguage.googleapis.com/v1beta",
  );
});

test("resolveProviderConnectApiBase accepts override only for custom provider", () => {
  assert.equal(
    resolveProviderConnectApiBase("custom", "openai-compatible", "https://custom.example/v1"),
    "https://custom.example/v1",
  );
});

test("parseProviderSiteSelection validates site definitions", () => {
  const parsed = parseProviderSiteSelection({
    xiaomi: {
      defaultSite: "cn",
      sites: {
        cn: {
          labelKey: "providers.test.site.cn",
          fallbackLabel: "China",
          apiBase: "https://api.example.cn/v1",
        },
        intl: {
          labelKey: "providers.test.site.intl",
          fallbackLabel: "International",
          apiBase: "https://api.example.com/v1",
        },
      },
    },
  });

  assert.equal(parsed.xiaomi?.defaultSite, "cn");
  assert.equal(parsed.xiaomi?.sites.cn?.apiBase, "https://api.example.cn/v1");
  assert.deepEqual(parseProviderSiteSelection({}), {});
});

test("parseProviderSiteSelection rejects invalid defaultSite", () => {
  assert.throws(
    () =>
      parseProviderSiteSelection({
        xiaomi: {
          defaultSite: "missing",
          sites: {
            cn: {
              labelKey: "providers.test.site.cn",
              fallbackLabel: "China",
              apiBase: "https://api.example.cn/v1",
            },
          },
        },
      }),
    /defaultSite must exist in sites/,
  );
});

test("provider site helpers are inactive until providerSiteSelection is configured", () => {
  assert.equal(providerSupportsSiteSelection("xiaomi"), false);
  assert.equal(defaultProviderConnectSite("xiaomi"), undefined);
  assert.deepEqual(listProviderConnectSiteOptions("xiaomi"), []);
  assert.equal(resolveProviderConnectSiteApiBase("xiaomi", "cn"), undefined);
});

test("resolveProviderConnectApiBase prefers site apiBase for siliconflow", () => {
  assert.equal(providerSupportsSiteSelection("siliconflow"), true);
  assert.equal(defaultProviderConnectSite("siliconflow"), "intl");
  assert.equal(
    resolveProviderConnectApiBase("siliconflow", "openai-compatible", { site: "cn" }),
    "https://api.siliconflow.cn/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("siliconflow", "anthropic", { site: "intl" }),
    "https://api.siliconflow.com/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("siliconflow", "openai-compatible"),
    "https://api.siliconflow.com/v1",
  );
});

test("resolveProviderConnectApiBase prefers site apiBase for moonshot-ai", () => {
  assert.equal(providerSupportsSiteSelection("moonshot-ai"), true);
  assert.equal(defaultProviderConnectSite("moonshot-ai"), "intl");
  assert.equal(
    resolveProviderConnectApiBase("moonshot-ai", "openai-compatible", { site: "cn" }),
    "https://api.moonshot.cn/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("moonshot-ai", "openai-compatible", { site: "intl" }),
    "https://api.moonshot.ai/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("moonshot-ai", "openai-compatible"),
    "https://api.moonshot.ai/v1",
  );
});

test("resolveProviderConnectApiBase prefers site apiBase for kimi-code", () => {
  assert.equal(providerSupportsSiteSelection("kimi-code"), true);
  assert.equal(defaultProviderConnectSite("kimi-code"), "intl");
  assert.equal(
    resolveProviderConnectApiBase("kimi-code", "openai-compatible"),
    "https://api.kimi.ai/coding/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("kimi-code", "anthropic"),
    "https://api.kimi.ai/coding",
  );
  assert.equal(
    resolveProviderConnectApiBase("kimi-code", "openai-compatible", { site: "cn" }),
    "https://api.kimi.com/coding/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("kimi-code", "anthropic", { site: "cn" }),
    "https://api.kimi.com/coding",
  );
  assert.equal(
    resolveProviderConnectApiBase("kimi-code", "openai-compatible", { site: "intl" }),
    "https://api.kimi.ai/coding/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("kimi-code", "anthropic", { site: "intl" }),
    "https://api.kimi.ai/coding",
  );
});

test("resolveProviderConnectApiBase prefers site apiBase for minimax", () => {
  assert.equal(providerSupportsSiteSelection("minimax"), true);
  assert.equal(defaultProviderConnectSite("minimax"), "intl");
  assert.equal(
    resolveProviderConnectApiBase("minimax", "openai-compatible", { site: "cn" }),
    "https://api.minimaxi.com/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("minimax", "anthropic", { site: "cn" }),
    "https://api.minimaxi.com/anthropic/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("minimax", "anthropic", { site: "intl" }),
    "https://api.minimax.io/anthropic/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("minimax", "openai-compatible"),
    "https://api.minimax.io/v1",
  );
  assert.equal(resolveConnectApiBase("minimax", ""), "https://api.minimax.io/anthropic/v1");
});

test("resolveProviderConnectApiBase prefers site apiBase for tencent-tokenhub", () => {
  assert.equal(providerSupportsSiteSelection("tencent-tokenhub"), true);
  assert.equal(defaultProviderConnectSite("tencent-tokenhub"), "cn");
  assert.equal(
    resolveProviderConnectApiBase("tencent-tokenhub", "openai-compatible", { site: "cn" }),
    "https://tokenhub.tencentmaas.com/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("tencent-tokenhub", "openai-compatible", { site: "intl" }),
    "https://tokenhub-intl.tencentmaas.com/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("tencent-tokenhub", "openai-compatible"),
    "https://tokenhub.tencentmaas.com/v1",
  );
});

test("resolveProviderConnectApiBase prefers site apiBase for alibaba", () => {
  assert.equal(providerSupportsSiteSelection("alibaba"), true);
  assert.equal(defaultProviderConnectSite("alibaba"), "cn-beijing");
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "openai-compatible", {
      site: "cn-beijing",
      workspaceId: "ws-cn",
    }),
    "https://ws-cn.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "anthropic", {
      site: "cn-beijing",
      workspaceId: "ws-cn",
    }),
    "https://ws-cn.cn-beijing.maas.aliyuncs.com/apps/anthropic",
  );
  assert.throws(
    () => resolveProviderConnectApiBase("alibaba", "openai-compatible", { site: "cn-beijing" }),
    /requires a workspace ID/,
  );
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "open-responses", { site: "us-virginia" }),
    "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "openai-compatible", {
      site: "ap-southeast-1",
      workspaceId: "ws-123",
    }),
    "https://ws-123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "anthropic", {
      site: "eu-central-1",
      workspaceId: "ws-eu",
    }),
    "https://ws-eu.eu-central-1.maas.aliyuncs.com/apps/anthropic",
  );
  assert.throws(
    () => resolveProviderConnectApiBase("alibaba", "openai-compatible", { site: "ap-southeast-1" }),
    /requires a workspace ID/,
  );
});

test("resolveProviderConnectApiBase resolves alibaba token plan without site or workspace", () => {
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "openai-compatible", { billingMode: "token-plan" }),
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "anthropic", { billingMode: "token-plan" }),
    "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
  );
  assert.equal(
    resolveProviderConnectApiBase("alibaba", "open-responses", { billingMode: "token-plan" }),
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
});

test("resolveProviderConnectApiBase resolves stepfun standard and step plan endpoints", () => {
  assert.equal(providerSupportsSiteSelection("stepfun"), true);
  assert.equal(defaultProviderConnectSite("stepfun"), "intl");
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "openai-compatible"),
    "https://api.stepfun.com/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "open-responses"),
    "https://api.stepfun.com/v1",
  );
  assert.equal(resolveProviderConnectApiBase("stepfun", "anthropic"), "https://api.stepfun.com");
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "openai-compatible", {
      stepfunBillingMode: "step-plan",
    }),
    "https://api.stepfun.com/step_plan/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "open-responses", { stepfunBillingMode: "step-plan" }),
    "https://api.stepfun.com/step_plan/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "anthropic", { stepfunBillingMode: "step-plan" }),
    "https://api.stepfun.com/step_plan",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "openai-compatible", { site: "cn" }),
    "https://api.stepfun.com/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "anthropic", { site: "cn" }),
    "https://api.stepfun.com",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "openai-compatible", { site: "intl" }),
    "https://api.stepfun.ai/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "open-responses", { site: "intl" }),
    "https://api.stepfun.ai/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "anthropic", { site: "intl" }),
    "https://api.stepfun.ai",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "openai-compatible", {
      site: "intl",
      stepfunBillingMode: "step-plan",
    }),
    "https://api.stepfun.ai/step_plan/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "open-responses", {
      site: "intl",
      stepfunBillingMode: "step-plan",
    }),
    "https://api.stepfun.ai/step_plan/v1",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "anthropic", {
      site: "intl",
      stepfunBillingMode: "step-plan",
    }),
    "https://api.stepfun.ai/step_plan",
  );
  assert.equal(
    resolveProviderConnectApiBase("stepfun", "openai-compatible", {
      site: "cn",
      stepfunBillingMode: "step-plan",
    }),
    "https://api.stepfun.com/step_plan/v1",
  );
});
