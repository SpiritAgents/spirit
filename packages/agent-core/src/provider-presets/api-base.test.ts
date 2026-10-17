import assert from "node:assert/strict";

import { test } from "vitest";

import {
  applyApiBaseTemplateValues,
  listUnresolvedApiBaseTemplateKeys,
  ProviderPresetApiBaseError,
  resolvePresetApiBase,
} from "./api-base.js";
import { findProviderPreset } from "./loader.js";
import type { ProviderPreset } from "./types.js";

function preset(id: string): ProviderPreset {
  const found = findProviderPreset(id);
  assert.ok(found, `preset ${id}`);
  return found;
}

test("kimi-code: default site + default transport is the intl openai-compatible base", () => {
  assert.equal(resolvePresetApiBase(preset("kimi-code")), "https://api.kimi.ai/coding/v1");
});

test("kimi-code: per-site per-transport bases are baked literals", () => {
  assert.equal(
    resolvePresetApiBase(preset("kimi-code"), { siteId: "cn" }),
    "https://api.kimi.com/coding/v1",
  );
  assert.equal(
    resolvePresetApiBase(preset("kimi-code"), { siteId: "cn", transportKind: "anthropic" }),
    "https://api.kimi.com/coding",
  );
  assert.equal(
    resolvePresetApiBase(preset("kimi-code"), { siteId: "intl", transportKind: "anthropic" }),
    "https://api.kimi.ai/coding",
  );
});

test("minimax: default transport is anthropic; undeclared transports fall back to its slot", () => {
  assert.equal(resolvePresetApiBase(preset("minimax")), "https://api.minimax.io/anthropic/v1");
  assert.equal(
    resolvePresetApiBase(preset("minimax"), { transportKind: "openai-compatible" }),
    "https://api.minimax.io/v1",
  );
  // The old resolver fell back to the flat (anthropic) base for undeclared transports.
  assert.equal(
    resolvePresetApiBase(preset("minimax"), { transportKind: "open-responses" }),
    "https://api.minimax.io/anthropic/v1",
  );
  assert.equal(
    resolvePresetApiBase(preset("minimax"), { siteId: "cn", transportKind: "anthropic" }),
    "https://api.minimax.cn/anthropic/v1",
  );
});

test("alibaba: no site keeps the flat dashscope base (workspace id missing in the wizard)", () => {
  assert.equal(
    resolvePresetApiBase(preset("alibaba")),
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  );
});

test("alibaba: workspace sites substitute {workspaceId} per transport", () => {
  assert.equal(
    resolvePresetApiBase(preset("alibaba"), {
      siteId: "cn-beijing",
      templateValues: { workspaceId: "ws-1" },
    }),
    "https://ws-1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(
    resolvePresetApiBase(preset("alibaba"), {
      siteId: "cn-beijing",
      transportKind: "anthropic",
      templateValues: { workspaceId: "ws-1" },
    }),
    "https://ws-1.cn-beijing.maas.aliyuncs.com/apps/anthropic",
  );
  // Without the template value the placeholder stays literal (wizard display path).
  const unresolved = resolvePresetApiBase(preset("alibaba"), { siteId: "eu-central-1" });
  assert.equal(
    unresolved,
    "https://{workspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.deepEqual(listUnresolvedApiBaseTemplateKeys(unresolved), ["workspaceId"]);
});

test("alibaba: the us-virginia site needs no workspace id", () => {
  assert.equal(
    resolvePresetApiBase(preset("alibaba"), { siteId: "us-virginia" }),
    "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(
    resolvePresetApiBase(preset("alibaba"), {
      siteId: "us-virginia",
      transportKind: "anthropic",
    }),
    "https://dashscope-us.aliyuncs.com/apps/anthropic",
  );
});

test("alibaba: token plan overrides the site with its own per-transport bases", () => {
  assert.equal(
    resolvePresetApiBase(preset("alibaba"), { billingPlanId: "token-plan" }),
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(
    resolvePresetApiBase(preset("alibaba"), {
      billingPlanId: "token-plan",
      transportKind: "anthropic",
      siteId: "us-virginia",
    }),
    "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
  );
});

test("z-ai / zhipu-ai: GLM coding plan is a fixed base for every transport", () => {
  assert.equal(
    resolvePresetApiBase(preset("z-ai"), { billingPlanId: "glm-coding-plan" }),
    "https://api.z.ai/api/coding/paas/v4",
  );
  assert.equal(
    resolvePresetApiBase(preset("zhipu-ai"), {
      billingPlanId: "glm-coding-plan",
      transportKind: "anthropic",
    }),
    "https://open.bigmodel.cn/api/coding/paas/v4",
  );
});

test("stepfun: step plan is per-transport on the China host; sites keep per-transport bases", () => {
  assert.equal(
    resolvePresetApiBase(preset("stepfun"), { billingPlanId: "step-plan" }),
    "https://api.stepfun.com/step_plan/v1",
  );
  assert.equal(
    resolvePresetApiBase(preset("stepfun"), {
      billingPlanId: "step-plan",
      transportKind: "anthropic",
    }),
    "https://api.stepfun.com/step_plan",
  );
  assert.equal(
    resolvePresetApiBase(preset("stepfun"), { siteId: "intl" }),
    "https://api.stepfun.ai/v1",
  );
  assert.equal(
    resolvePresetApiBase(preset("stepfun"), { siteId: "intl", transportKind: "anthropic" }),
    "https://api.stepfun.ai",
  );
});

test("tencent-tokenhub: default site is the cn (Guangzhou) host when a site is selected", () => {
  const tokenhub = preset("tencent-tokenhub");
  const defaultSite = tokenhub.sites?.default;
  assert.ok(defaultSite);
  assert.equal(
    resolvePresetApiBase(tokenhub, { siteId: defaultSite }),
    "https://tokenhub.tencentmaas.com/v1",
  );
  assert.equal(
    resolvePresetApiBase(preset("tencent-tokenhub"), { siteId: "intl" }),
    "https://tokenhub-intl.tencentmaas.com/v1",
  );
});

test("template substitution: vertex project/location and bedrock region", () => {
  assert.equal(
    resolvePresetApiBase(preset("google-vertex-ai"), {
      templateValues: { project: "my-project", location: "europe-west4" },
    }),
    "https://europe-west4-aiplatform.googleapis.com/v1/projects/my-project/locations/europe-west4",
  );
  assert.equal(
    resolvePresetApiBase(preset("amazon-bedrock"), { templateValues: { awsRegion: "eu-west-1" } }),
    "https://bedrock.eu-west-1.amazonaws.com",
  );
  assert.equal(
    resolvePresetApiBase(preset("azure"), { templateValues: { resourceName: "my-resource" } }),
    "https://my-resource.openai.azure.com/openai/v1",
  );
});

test("unknown sites and billing plans throw", () => {
  assert.throws(
    () => resolvePresetApiBase(preset("kimi-code"), { siteId: "moon" }),
    ProviderPresetApiBaseError,
  );
  assert.throws(() => resolvePresetApiBase(preset("openai"), { siteId: "cn" }), /has no site/);
  assert.throws(
    () => resolvePresetApiBase(preset("z-ai"), { billingPlanId: "nope" }),
    /has no billing plan/,
  );
  assert.throws(
    () => resolvePresetApiBase(preset("openai"), { billingPlanId: "plan" }),
    ProviderPresetApiBaseError,
  );
});

test("applyApiBaseTemplateValues leaves unknown placeholders literal and trims values", () => {
  assert.equal(
    applyApiBaseTemplateValues("https://{a}.example.com/{b}", { a: " x " }),
    "https://x.example.com/{b}",
  );
  assert.equal(applyApiBaseTemplateValues("https://{a}.example.com"), "https://{a}.example.com");
});
