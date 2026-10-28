import assert from "node:assert/strict";
import { test } from "vitest";

import { providerSupportsModelCatalogListing } from "../../dist-electron/src/host/model-catalog-metadata.js";
import {
  applyCatalogEntryToStoredModel,
  collectModelCatalogRefreshTargets,
  mergeNewCatalogModelsIntoConfig,
  modelCatalogScopeKey,
  removeDelistedModelsFromCatalog,
  syncExistingModelsFromCatalog,
} from "../../dist-electron/src/host/model-catalog-startup-refresh.js";

const gatewayProviderId = "vercel-ai-gateway";
const openAiProviderId = "openai";
const customProviderId = "custom-local";
const minimaxProviderId = "minimax";

function gatewayProvider(models) {
  return {
    id: gatewayProviderId,
    apiBase: "https://ai-gateway.vercel.sh/v1",
    transportKind: "open-responses",
    models,
  };
}

function openAiProvider(models) {
  return {
    id: openAiProviderId,
    apiBase: "https://api.openai.com/v1",
    models,
  };
}

function customProvider(models) {
  return {
    id: customProviderId,
    apiBase: "http://127.0.0.1:8080/v1",
    models,
  };
}

function minimaxProvider(models) {
  return {
    id: minimaxProviderId,
    apiBase: "https://api.minimax.cn/v1",
    models,
  };
}

test("providerSupportsModelCatalogListing follows the preset catalog descriptor", () => {
  assert.equal(
    providerSupportsModelCatalogListing({ providerId: "openai", transportKind: "open-responses" }),
    true,
  );
  // Azure and Cloudflare AI Gateway presets declare no catalog descriptor.
  assert.equal(
    providerSupportsModelCatalogListing({ providerId: "azure", transportKind: "open-responses" }),
    false,
  );
  assert.equal(
    providerSupportsModelCatalogListing({
      providerId: "cloudflare-ai-gateway",
      transportKind: "openai-compatible",
    }),
    false,
  );
  // Custom entries list via the generic transport shape; bedrock has no generic HTTP listing.
  assert.equal(providerSupportsModelCatalogListing({ providerId: "my-lab" }), true);
  assert.equal(
    providerSupportsModelCatalogListing({ providerId: "my-lab", transportKind: "bedrock" }),
    false,
  );
});

test("collectModelCatalogRefreshTargets keeps one entry per provider with a catalog", () => {
  const targets = collectModelCatalogRefreshTargets([
    openAiProvider([{ name: "gpt-4.1" }]),
    {
      id: "azure",
      apiBase: "https://x.openai.azure.com/openai/v1",
      models: [{ name: "my-deploy" }],
    },
    {
      id: "local-bedrock",
      apiBase: "http://127.0.0.1:8080/v1",
      transportKind: "bedrock",
      models: [{ name: "local" }],
    },
    gatewayProvider([{ name: "anthropic/claude-sonnet-4" }, { name: "openai/gpt-4.1" }]),
  ]);

  assert.deepEqual(targets.map((target) => target.id).sort(), ["openai", "vercel-ai-gateway"]);
});

test("modelCatalogScopeKey identifies an entry at its materialized api base", () => {
  const key = modelCatalogScopeKey({
    id: "vercel-ai-gateway",
    apiBase: "https://ai-gateway.vercel.sh/v1",
  });
  assert.equal(key, "vercel-ai-gateway::https://ai-gateway.vercel.sh/v1");
});

test("mergeNewCatalogModelsIntoConfig appends only new provider-scoped models", () => {
  const provider = gatewayProvider([
    {
      name: "zai/glm-5.1",
      capabilities: ["languageModel"],
    },
  ]);
  const config = {
    providers: [provider],
    activeModel: { providerId: gatewayProviderId, name: "zai/glm-5.1" },
  };

  const merged = mergeNewCatalogModelsIntoConfig(config, provider, {
    modelIds: ["zai/glm-5.1", "zai/glm-5.2"],
    fromCache: false,
    modelCatalog: [
      { id: "zai/glm-5.1", capabilities: ["languageModel"] },
      { id: "zai/glm-5.2", capabilities: ["languageModel"] },
    ],
  });

  assert.equal(merged, 1);
  assert.deepEqual(
    provider.models.map((model) => model.name),
    ["zai/glm-5.1", "zai/glm-5.2"],
  );
  // GLM-5.x carries a model-knowledge thinking-switch declaration, folded at catalog write time.
  assert.equal(provider.models[1].supportsThinkingSwitch, true);
  assert.deepEqual(config.activeModel, { providerId: gatewayProviderId, name: "zai/glm-5.1" });
});

test("syncExistingModelsFromCatalog upgrades chat-only profiles from catalog", () => {
  const provider = minimaxProvider([
    {
      name: "MiniMax-M3",
      capabilities: ["languageModel"],
    },
    {
      name: "MiniMax-M2.5",
      capabilities: ["languageModel"],
    },
  ]);
  const config = {
    providers: [provider],
    activeModel: { providerId: minimaxProviderId, name: "MiniMax-M3" },
  };

  const synced = syncExistingModelsFromCatalog(config, provider, {
    modelIds: ["MiniMax-M3", "MiniMax-M2.5"],
    fromCache: false,
    modelCatalog: [
      { id: "MiniMax-M3", capabilities: ["languageModel", "image", "video"] },
      { id: "MiniMax-M2.5", capabilities: ["languageModel"] },
    ],
  });

  // MiniMax-M2.5 also changes: the minimax-m2.5 knowledge record folds in `supportsThinkingType`.
  assert.equal(synced, 2);
  assert.deepEqual(provider.models[0].capabilities, ["languageModel", "image", "video"]);
  assert.deepEqual(provider.models[1].capabilities, ["languageModel"]);
  assert.equal(provider.models[1].supportsThinkingType, "only");
});

test("syncExistingModelsFromCatalog writes videoGeneration when capabilities are missing", () => {
  const provider = gatewayProvider([
    {
      name: "alibaba/wan-v2.6-t2v",
    },
  ]);
  const config = { providers: [provider] };

  const synced = syncExistingModelsFromCatalog(config, provider, {
    modelIds: ["alibaba/wan-v2.6-t2v"],
    fromCache: false,
    modelCatalog: [{ id: "alibaba/wan-v2.6-t2v", capabilities: ["videoGeneration"] }],
  });

  assert.equal(synced, 1);
  assert.deepEqual(provider.models[0].capabilities, ["videoGeneration"]);
});

test("syncExistingModelsFromCatalog corrects stale video input to videoGeneration", () => {
  const provider = gatewayProvider([
    {
      name: "alibaba/wan-v2.6-t2v",
      capabilities: ["languageModel", "video"],
    },
  ]);
  const config = { providers: [provider] };

  const synced = syncExistingModelsFromCatalog(config, provider, {
    modelIds: ["alibaba/wan-v2.6-t2v"],
    fromCache: false,
    modelCatalog: [{ id: "alibaba/wan-v2.6-t2v", capabilities: ["videoGeneration"] }],
  });

  assert.equal(synced, 1);
  assert.deepEqual(provider.models[0].capabilities, ["videoGeneration"]);
});

test("syncExistingModelsFromCatalog syncs supportedEfforts from catalog", () => {
  const provider = {
    id: "anthropic",
    apiBase: "https://api.anthropic.com/v1",
    transportKind: "anthropic",
    models: [
      {
        name: "claude-sonnet-4",
        capabilities: ["languageModel"],
      },
    ],
  };
  const config = { providers: [provider] };

  const synced = syncExistingModelsFromCatalog(config, provider, {
    modelIds: ["claude-sonnet-4"],
    fromCache: false,
    modelCatalog: [
      {
        id: "claude-sonnet-4",
        capabilities: ["languageModel"],
        supportedEfforts: ["low", "high"],
      },
    ],
  });

  assert.equal(synced, 1);
  assert.deepEqual(provider.models[0].supportedEfforts, ["low", "high"]);
  // The claude-sonnet-4 knowledge record folds in the thinking-switch declaration.
  assert.equal(provider.models[0].supportsThinkingSwitch, true);
});

test("syncExistingModelsFromCatalog returns zero when catalog matches stored profile", () => {
  const provider = gatewayProvider([
    {
      name: "openai/gpt-4.1",
      capabilities: ["languageModel"],
      supportedReasoningEfforts: ["low", "high"],
      serviceTiers: ["auto", "default", "fast"],
      contextLength: 128000,
    },
  ]);
  const config = { providers: [provider] };

  const synced = syncExistingModelsFromCatalog(config, provider, {
    modelIds: ["openai/gpt-4.1"],
    fromCache: false,
    modelCatalog: [
      {
        id: "openai/gpt-4.1",
        capabilities: ["languageModel"],
        supportedReasoningEfforts: ["low", "high"],
        contextLength: 256000,
      },
    ],
  });

  assert.equal(synced, 0);
  assert.equal(provider.models[0].contextLength, 128000);
});

test("syncExistingModelsFromCatalog adds legacy OpenAI declarations and preserves valid selections", () => {
  const provider = openAiProvider([
    { name: "gpt-5.4", reasoningEffort: "high", serviceTier: "flex" },
    { name: "gpt-4.1", serviceTier: "fast" },
  ]);
  const config = { providers: [provider] };

  const synced = syncExistingModelsFromCatalog(config, provider, {
    modelIds: ["gpt-5.4", "gpt-4.1"],
    fromCache: false,
    modelCatalog: [{ id: "gpt-5.4" }, { id: "gpt-4.1" }],
  });

  assert.equal(synced, 2);
  assert.deepEqual(provider.models[0].supportedReasoningEfforts, [
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  assert.deepEqual(provider.models[0].serviceTiers, {
    auto: { body: { service_tier: "auto" } },
    default: { body: { service_tier: "default" } },
    flex: { body: { service_tier: "flex" } },
    fast: { body: { service_tier: "fast" }, maxInputTokens: 278528 },
  });
  assert.equal(provider.models[0].reasoningEffort, "high");
  assert.equal(provider.models[0].serviceTier, "flex");
  assert.deepEqual(provider.models[1].serviceTiers, ["auto", "default", "fast"]);
  assert.equal(provider.models[1].serviceTier, "fast");
  assert.equal("supportedReasoningEfforts" in provider.models[1], false);
});

test("catalog upstreamProvider is display metadata only, never written onto config models", () => {
  const provider = gatewayProvider([]);
  const config = {
    providers: [provider],
    activeModel: { providerId: "", name: "" },
  };

  const merged = mergeNewCatalogModelsIntoConfig(config, provider, {
    modelIds: ["openai/gpt-5.4"],
    fromCache: false,
    modelCatalog: [
      { id: "openai/gpt-5.4", capabilities: ["languageModel"], upstreamProvider: "OpenAI" },
    ],
  });

  assert.equal(merged, 1);
  assert.equal("upstreamProvider" in provider.models[0], false);
});

test("applyCatalogEntryToStoredModel backfills contextLength only when unset", () => {
  const model = {
    name: "openai/gpt-4.1",
  };

  assert.equal(
    applyCatalogEntryToStoredModel(model, {
      id: "openai/gpt-4.1",
      contextLength: 128000,
    }),
    true,
  );
  assert.equal(model.contextLength, 128000);

  assert.equal(
    applyCatalogEntryToStoredModel(model, {
      id: "openai/gpt-4.1",
      contextLength: 256000,
    }),
    false,
  );
  assert.equal(model.contextLength, 128000);
});

test("applyCatalogEntryToStoredModel backfills outputLimit only when unset", () => {
  const model = { name: "gpt-5.4" };
  assert.equal(applyCatalogEntryToStoredModel(model, { id: "gpt-5.4", outputLimit: 32000 }), true);
  assert.equal(model.outputLimit, 32000);
  assert.equal(applyCatalogEntryToStoredModel(model, { id: "gpt-5.4", outputLimit: 64000 }), false);
  assert.equal(model.outputLimit, 32000);
});

test("applyCatalogEntryToStoredModel syncs thinking declarations and resets stale selections", () => {
  const thinkingModel = { name: "kimi-for-coding" };
  assert.equal(
    applyCatalogEntryToStoredModel(thinkingModel, {
      id: "kimi-for-coding",
      supportsThinkingType: "only",
    }),
    true,
  );
  assert.equal(thinkingModel.supportsThinkingType, "only");

  const switchModel = { name: "LongCat-2.0" };
  assert.equal(
    applyCatalogEntryToStoredModel(switchModel, {
      id: "LongCat-2.0",
      supportsThinkingSwitch: true,
    }),
    true,
  );
  assert.equal(switchModel.supportsThinkingSwitch, true);

  // The thinkingSwitch wire encoding is catalog-owned: written when declared, cleared when dropped.
  const encodingModel = { name: "kimi-k2.6" };
  const thinkingSwitch = {
    on: { body: { thinking: { type: "enabled" } } },
    off: { body: { thinking: { type: "disabled" } } },
  };
  assert.equal(
    applyCatalogEntryToStoredModel(encodingModel, {
      id: "kimi-k2.6",
      supportsThinkingSwitch: true,
      thinkingSwitch,
    }),
    true,
  );
  assert.deepEqual(encodingModel.thinkingSwitch, thinkingSwitch);

  assert.equal(
    applyCatalogEntryToStoredModel(encodingModel, {
      id: "kimi-k2.6",
      supportsThinkingSwitch: true,
      thinkingSwitch,
    }),
    false,
  );

  assert.equal(
    applyCatalogEntryToStoredModel(encodingModel, {
      id: "kimi-k2.6",
      supportsThinkingSwitch: true,
    }),
    true,
  );
  assert.equal("thinkingSwitch" in encodingModel, false);

  // A reasoning selection outside the fresh declaration resets to "send nothing".
  const effortModel = {
    name: "m",
    reasoningEffort: "max",
  };
  assert.equal(
    applyCatalogEntryToStoredModel(effortModel, {
      id: "m",
      supportedReasoningEfforts: ["low", "high"],
    }),
    true,
  );
  assert.deepEqual(effortModel.supportedReasoningEfforts, ["low", "high"]);
  assert.equal("reasoningEffort" in effortModel, false);
});

test("applyCatalogEntryToStoredModel syncs literal serviceTiers and resets stale tier selections", () => {
  const literalTiers = {
    default: {},
    flex: { providerOptions: { gateway: { serviceTier: "flex" } } },
    fast: { providerOptions: { gateway: { serviceTier: "fast" } } },
  };

  const model = { name: "openai/gpt-5.6" };
  assert.equal(
    applyCatalogEntryToStoredModel(model, {
      id: "openai/gpt-5.6",
      serviceTiers: literalTiers,
    }),
    true,
  );
  assert.deepEqual(model.serviceTiers, literalTiers);

  // An unchanged declaration is a no-op.
  assert.equal(
    applyCatalogEntryToStoredModel(model, {
      id: "openai/gpt-5.6",
      serviceTiers: literalTiers,
    }),
    false,
  );

  // A tier selection outside the fresh declaration resets to "send nothing".
  const selectedModel = {
    name: "openai/gpt-5.6",
    serviceTiers: literalTiers,
    serviceTier: "priority",
  };
  assert.equal(
    applyCatalogEntryToStoredModel(selectedModel, {
      id: "openai/gpt-5.6",
      serviceTiers: literalTiers,
    }),
    true,
  );
  assert.equal("serviceTier" in selectedModel, false);
  assert.deepEqual(selectedModel.serviceTiers, literalTiers);
});

test("removeDelistedModelsFromCatalog drops entry models missing from upstream ids", () => {
  const gateway = gatewayProvider([
    {
      name: "alibaba/wan-v2.6-t2v",
      capabilities: ["videoGeneration"],
    },
    {
      name: "openai/gpt-4.1",
      capabilities: ["languageModel"],
    },
  ]);
  const custom = customProvider([
    {
      name: "legacy-local",
    },
  ]);
  const config = {
    providers: [gateway, custom],
    activeModel: { providerId: gatewayProviderId, name: "alibaba/wan-v2.6-t2v" },
    videoGenerationModel: { providerId: gatewayProviderId, name: "alibaba/wan-v2.6-t2v" },
  };

  const pruned = removeDelistedModelsFromCatalog(config, gateway, {
    modelIds: ["openai/gpt-4.1"],
    fromCache: false,
    modelCatalog: [{ id: "openai/gpt-4.1", capabilities: ["languageModel"] }],
  });

  assert.deepEqual(pruned, ["alibaba/wan-v2.6-t2v"]);
  assert.deepEqual(
    gateway.models.map((model) => model.name),
    ["openai/gpt-4.1"],
  );
  assert.deepEqual(
    custom.models.map((model) => model.name),
    ["legacy-local"],
  );
  assert.deepEqual(config.activeModel, { providerId: gatewayProviderId, name: "openai/gpt-4.1" });
  assert.equal(config.videoGenerationModel, undefined);
});

test("removeDelistedModelsFromCatalog keeps models when the upstream listing is empty", () => {
  const gateway = gatewayProvider([
    {
      name: "alibaba/wan-v2.6-t2v",
    },
  ]);
  const config = {
    providers: [gateway],
    activeModel: { providerId: gatewayProviderId, name: "alibaba/wan-v2.6-t2v" },
  };

  const pruned = removeDelistedModelsFromCatalog(config, gateway, {
    modelIds: [],
    fromCache: false,
    modelCatalog: [],
  });

  assert.deepEqual(pruned, []);
  assert.deepEqual(
    gateway.models.map((model) => model.name),
    ["alibaba/wan-v2.6-t2v"],
  );
  assert.deepEqual(config.activeModel, {
    providerId: gatewayProviderId,
    name: "alibaba/wan-v2.6-t2v",
  });
});

test("removeDelistedModelsFromCatalog keeps same-named models in other provider entries", () => {
  const gateway = gatewayProvider([
    {
      name: "shared-id",
    },
  ]);
  const openai = openAiProvider([
    {
      name: "shared-id",
    },
  ]);
  const config = {
    providers: [gateway, openai],
    activeModel: { providerId: gatewayProviderId, name: "shared-id" },
  };

  const pruned = removeDelistedModelsFromCatalog(config, gateway, {
    modelIds: [],
    fromCache: false,
    modelCatalog: [],
  });

  assert.deepEqual(pruned, []);
  assert.deepEqual(
    config.providers.map((provider) => provider.id),
    ["vercel-ai-gateway", "openai"],
  );
});

test("removeDelistedModelsFromCatalog prunes the delisted entry model but keeps the openai same name", () => {
  const gateway = gatewayProvider([
    {
      name: "shared-id",
    },
  ]);
  const openai = openAiProvider([
    {
      name: "shared-id",
    },
  ]);
  const config = {
    providers: [gateway, openai],
    activeModel: { providerId: gatewayProviderId, name: "shared-id" },
  };

  const pruned = removeDelistedModelsFromCatalog(config, gateway, {
    modelIds: ["openai/gpt-4.1"],
    fromCache: false,
    modelCatalog: [{ id: "openai/gpt-4.1", capabilities: ["languageModel"] }],
  });

  assert.deepEqual(pruned, ["shared-id"]);
  assert.deepEqual(
    config.providers.flatMap((provider) => provider.models.map(() => provider.id)),
    ["openai"],
  );
  assert.deepEqual(config.activeModel, { providerId: openAiProviderId, name: "shared-id" });
});

test("applyCatalogEntryToStoredModel clears revoked effort and thinking state", () => {
  const model = {
    name: "claude-opus-5",
    effortSemantics: "output",
    effort: "high",
    supportedEfforts: ["low", "high"],
    defaultEffort: "high",
    supportsThinkingSwitch: true,
    thinkingEnabled: false,
    thinkingCapabilities: { supported: true },
    thinkingSwitch: {
      on: { body: { thinking: { type: "adaptive" } } },
      off: { body: { thinking: { type: "disabled" } } },
    },
  };

  const changed = applyCatalogEntryToStoredModel(model, {
    id: model.name,
    effortSemantics: "output",
    supportedEfforts: [],
    thinkingCapabilities: { supported: false },
    supportsThinkingSwitch: false,
  });

  assert.equal(changed, true);
  assert.equal(model.effortSemantics, "output");
  assert.deepEqual(model.supportedEfforts, []);
  assert.equal(model.effort, undefined);
  assert.equal(model.defaultEffort, undefined);
  assert.equal(model.supportsThinkingSwitch, false);
  assert.equal(model.thinkingEnabled, undefined);
  assert.equal(model.thinkingSwitch, undefined);
  assert.deepEqual(model.thinkingCapabilities, { supported: false });
});
