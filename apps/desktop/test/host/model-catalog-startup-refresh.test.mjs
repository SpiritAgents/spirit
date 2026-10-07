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

const gatewayGroupId = "vercel-ai-gateway";
const openAiGroupId = "openai";
const customGroupId = "custom-local";
const minimaxGroupId = "minimax";

const gatewayScopeProfile = {
  groupId: gatewayGroupId,
  name: "anthropic/claude-sonnet-4",
  apiBase: "https://ai-gateway.vercel.sh/v1",
  provider: "vercel-ai-gateway",
  transportKind: "open-responses",
  reasoningEffort: "default",
};

function gatewayGroup(models) {
  return {
    id: gatewayGroupId,
    provider: "vercel-ai-gateway",
    apiBase: "https://ai-gateway.vercel.sh/v1",
    transportKind: "open-responses",
    models,
  };
}

function openAiGroup(models) {
  return {
    id: openAiGroupId,
    provider: "openai",
    apiBase: "https://api.openai.com/v1",
    models,
  };
}

function customGroup(models) {
  return {
    id: customGroupId,
    provider: "custom",
    apiBase: "http://127.0.0.1:8080/v1",
    models,
  };
}

function minimaxGroup(models) {
  return {
    id: minimaxGroupId,
    provider: "minimax",
    apiBase: "https://api.minimax.cn/v1",
    models,
  };
}

test("providerSupportsModelCatalogListing includes OpenAI and excludes Azure", () => {
  assert.equal(
    providerSupportsModelCatalogListing({ provider: "openai", transportKind: "open-responses" }),
    true,
  );
  assert.equal(
    providerSupportsModelCatalogListing({ provider: "azure", transportKind: "open-responses" }),
    false,
  );
  assert.equal(
    providerSupportsModelCatalogListing({
      provider: "cloudflare-ai-gateway",
      transportKind: "openai-compatible",
    }),
    false,
  );
});

test("collectModelCatalogRefreshTargets skips Azure and includes OpenAI", () => {
  const targets = collectModelCatalogRefreshTargets([
    { name: "gpt-4.1", apiBase: "https://api.openai.com/v1", provider: "openai" },
    { name: "my-deploy", apiBase: "https://x.openai.azure.com/openai/v1", provider: "azure" },
    {
      name: "local",
      apiBase: "http://127.0.0.1:8080/v1",
      provider: "custom",
      transportKind: "bedrock",
    },
    {
      name: "anthropic/claude-sonnet-4",
      apiBase: "https://ai-gateway.vercel.sh/v1",
      provider: "vercel-ai-gateway",
      transportKind: "open-responses",
    },
  ]);

  assert.equal(targets.length, 2);
  assert.deepEqual(targets.map((target) => target.provider).sort(), [
    "openai",
    "vercel-ai-gateway",
  ]);
});

test("collectModelCatalogRefreshTargets dedupes by provider transport and api base", () => {
  const shared = {
    apiBase: "https://ai-gateway.vercel.sh/v1",
    provider: "vercel-ai-gateway",
    transportKind: "open-responses",
  };
  const targets = collectModelCatalogRefreshTargets([
    { name: "anthropic/claude-sonnet-4", ...shared },
    { name: "openai/gpt-4.1", ...shared },
  ]);

  assert.equal(targets.length, 1);
  assert.equal(targets[0]?.name, "anthropic/claude-sonnet-4");
});

test("modelCatalogScopeKey normalizes api base", () => {
  const key = modelCatalogScopeKey({
    provider: "vercel-ai-gateway",
    transportKind: "open-responses",
    apiBase: "https://ai-gateway.vercel.sh/v1/",
  });
  assert.equal(key, "vercel-ai-gateway::open-responses::https://ai-gateway.vercel.sh/v1");
});

test("mergeNewCatalogModelsIntoConfig appends only new provider-scoped models", () => {
  const config = {
    providerGroups: [
      gatewayGroup([
        {
          name: "zai/glm-5.1",
          reasoningEffort: "medium",
          capabilities: ["languageModel"],
        },
      ]),
    ],
    activeModel: { groupId: gatewayGroupId, name: "zai/glm-5.1" },
  };

  const merged = mergeNewCatalogModelsIntoConfig(
    config,
    { ...gatewayScopeProfile, name: "zai/glm-5.1" },
    {
      modelIds: ["zai/glm-5.1", "zai/glm-5.2"],
      fromCache: false,
      modelCatalog: [
        { id: "zai/glm-5.1", capabilities: ["languageModel"] },
        { id: "zai/glm-5.2", capabilities: ["languageModel"] },
      ],
    },
  );

  assert.equal(merged, 1);
  assert.deepEqual(
    config.providerGroups[0].models.map((model) => model.name),
    ["zai/glm-5.1", "zai/glm-5.2"],
  );
  assert.deepEqual(config.activeModel, { groupId: gatewayGroupId, name: "zai/glm-5.1" });
});

test("syncExistingModelsFromCatalog upgrades chat-only profiles from catalog", () => {
  const config = {
    providerGroups: [
      minimaxGroup([
        {
          name: "MiniMax-M3",
          reasoningEffort: "medium",
          capabilities: ["languageModel"],
        },
        {
          name: "MiniMax-M2.5",
          reasoningEffort: "medium",
          capabilities: ["languageModel"],
        },
      ]),
    ],
    activeModel: { groupId: minimaxGroupId, name: "MiniMax-M3" },
  };

  const synced = syncExistingModelsFromCatalog(
    config,
    {
      groupId: minimaxGroupId,
      name: "MiniMax-M3",
      apiBase: "https://api.minimax.cn/v1",
      provider: "minimax",
      capabilities: ["languageModel"],
      reasoningEffort: "medium",
    },
    {
      modelIds: ["MiniMax-M3", "MiniMax-M2.5"],
      fromCache: false,
      modelCatalog: [
        { id: "MiniMax-M3", capabilities: ["languageModel", "image", "video"] },
        { id: "MiniMax-M2.5", capabilities: ["languageModel"] },
      ],
    },
  );

  assert.equal(synced, 1);
  assert.deepEqual(config.providerGroups[0].models[0].capabilities, [
    "languageModel",
    "image",
    "video",
  ]);
  assert.deepEqual(config.providerGroups[0].models[1].capabilities, ["languageModel"]);
});

test("syncExistingModelsFromCatalog writes videoGeneration when capabilities are missing", () => {
  const config = {
    providerGroups: [
      gatewayGroup([
        {
          name: "alibaba/wan-v2.6-t2v",
          reasoningEffort: "medium",
        },
      ]),
    ],
  };

  const synced = syncExistingModelsFromCatalog(config, gatewayScopeProfile, {
    modelIds: ["alibaba/wan-v2.6-t2v"],
    fromCache: false,
    modelCatalog: [{ id: "alibaba/wan-v2.6-t2v", capabilities: ["videoGeneration"] }],
  });

  assert.equal(synced, 1);
  assert.deepEqual(config.providerGroups[0].models[0].capabilities, ["videoGeneration"]);
});

test("syncExistingModelsFromCatalog corrects stale video input to videoGeneration", () => {
  const config = {
    providerGroups: [
      gatewayGroup([
        {
          name: "alibaba/wan-v2.6-t2v",
          reasoningEffort: "medium",
          capabilities: ["languageModel", "video"],
        },
      ]),
    ],
  };

  const synced = syncExistingModelsFromCatalog(config, gatewayScopeProfile, {
    modelIds: ["alibaba/wan-v2.6-t2v"],
    fromCache: false,
    modelCatalog: [{ id: "alibaba/wan-v2.6-t2v", capabilities: ["videoGeneration"] }],
  });

  assert.equal(synced, 1);
  assert.deepEqual(config.providerGroups[0].models[0].capabilities, ["videoGeneration"]);
});

test("syncExistingModelsFromCatalog syncs supportedReasoningEfforts from catalog", () => {
  const config = {
    providerGroups: [
      gatewayGroup([
        {
          name: "anthropic/claude-sonnet-4",
          reasoningEffort: "medium",
          capabilities: ["languageModel"],
        },
      ]),
    ],
  };

  const synced = syncExistingModelsFromCatalog(config, gatewayScopeProfile, {
    modelIds: ["anthropic/claude-sonnet-4"],
    fromCache: false,
    modelCatalog: [
      {
        id: "anthropic/claude-sonnet-4",
        capabilities: ["languageModel"],
        supportedReasoningEfforts: ["low", "high"],
      },
    ],
  });

  assert.equal(synced, 1);
  assert.deepEqual(config.providerGroups[0].models[0].supportedReasoningEfforts, ["low", "high"]);
});

test("syncExistingModelsFromCatalog returns zero when catalog matches stored profile", () => {
  const config = {
    providerGroups: [
      gatewayGroup([
        {
          name: "openai/gpt-4.1",
          reasoningEffort: "medium",
          capabilities: ["languageModel"],
          supportedReasoningEfforts: ["low", "high"],
          contextLength: 128000,
        },
      ]),
    ],
  };

  const synced = syncExistingModelsFromCatalog(config, gatewayScopeProfile, {
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
  assert.equal(config.providerGroups[0].models[0].contextLength, 128000);
});

test("applyCatalogEntryToStoredModel backfills contextLength only when unset", () => {
  const model = {
    name: "openai/gpt-4.1",
    apiBase: "https://ai-gateway.vercel.sh/v1",
    reasoningEffort: "default",
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

test("applyCatalogEntryToStoredModel syncs supportsThinkingType", () => {
  const model = {
    name: "kimi-for-coding",
    apiBase: "https://api.kimi.com/coding/v1",
    reasoningEffort: "default",
    provider: "kimi-code",
  };

  assert.equal(
    applyCatalogEntryToStoredModel(model, {
      id: "kimi-for-coding",
      supportsThinkingType: "only",
    }),
    true,
  );
  assert.equal(model.supportsThinkingType, "only");
});

test("applyCatalogEntryToStoredModel syncs supportsThinkingSwitch", () => {
  const model = {
    name: "LongCat-2.0",
    apiBase: "https://api.longcat.chat/openai/v1",
    reasoningEffort: "default",
    provider: "meituan",
  };

  assert.equal(
    applyCatalogEntryToStoredModel(model, {
      id: "LongCat-2.0",
      supportsThinkingSwitch: true,
    }),
    true,
  );
  assert.equal(model.supportsThinkingSwitch, true);
});

test("removeDelistedModelsFromCatalog drops scope models missing from upstream ids", () => {
  const config = {
    providerGroups: [
      gatewayGroup([
        {
          name: "alibaba/wan-v2.6-t2v",
          reasoningEffort: "medium",
          capabilities: ["videoGeneration"],
        },
        {
          name: "openai/gpt-4.1",
          reasoningEffort: "medium",
          capabilities: ["languageModel"],
        },
      ]),
      customGroup([
        {
          name: "legacy-local",
          reasoningEffort: "medium",
        },
      ]),
    ],
    activeModel: { groupId: gatewayGroupId, name: "alibaba/wan-v2.6-t2v" },
    videoGenerationModel: { groupId: gatewayGroupId, name: "alibaba/wan-v2.6-t2v" },
  };

  const pruned = removeDelistedModelsFromCatalog(config, gatewayScopeProfile, {
    modelIds: ["openai/gpt-4.1"],
    fromCache: false,
    modelCatalog: [{ id: "openai/gpt-4.1", capabilities: ["languageModel"] }],
  });

  assert.deepEqual(pruned, ["alibaba/wan-v2.6-t2v"]);
  assert.deepEqual(
    config.providerGroups[0].models.map((model) => model.name),
    ["openai/gpt-4.1"],
  );
  assert.deepEqual(
    config.providerGroups[1].models.map((model) => model.name),
    ["legacy-local"],
  );
  assert.deepEqual(config.activeModel, { groupId: gatewayGroupId, name: "openai/gpt-4.1" });
  assert.equal(config.videoGenerationModel, undefined);
});

test("removeDelistedModelsFromCatalog clears activeModel when last scope model is removed", () => {
  const config = {
    providerGroups: [
      gatewayGroup([
        {
          name: "alibaba/wan-v2.6-t2v",
          reasoningEffort: "medium",
        },
      ]),
    ],
    activeModel: { groupId: gatewayGroupId, name: "alibaba/wan-v2.6-t2v" },
  };

  const pruned = removeDelistedModelsFromCatalog(config, gatewayScopeProfile, {
    modelIds: [],
    fromCache: false,
    modelCatalog: [],
  });

  assert.deepEqual(pruned, []);
  assert.deepEqual(
    config.providerGroups[0].models.map((model) => model.name),
    ["alibaba/wan-v2.6-t2v"],
  );
  assert.deepEqual(config.activeModel, { groupId: gatewayGroupId, name: "alibaba/wan-v2.6-t2v" });
});

test("removeDelistedModelsFromCatalog keeps same-named models in other provider scopes", () => {
  const config = {
    providerGroups: [
      gatewayGroup([
        {
          name: "shared-id",
          reasoningEffort: "medium",
        },
      ]),
      openAiGroup([
        {
          name: "shared-id",
          reasoningEffort: "medium",
        },
      ]),
    ],
    activeModel: { groupId: gatewayGroupId, name: "shared-id" },
  };

  const pruned = removeDelistedModelsFromCatalog(config, gatewayScopeProfile, {
    modelIds: [],
    fromCache: false,
    modelCatalog: [],
  });

  assert.deepEqual(pruned, []);
  assert.deepEqual(
    config.providerGroups.map((group) => group.provider),
    ["vercel-ai-gateway", "openai"],
  );
});

test("removeDelistedModelsFromCatalog prunes delisted gateway model but keeps openai same name", () => {
  const config = {
    providerGroups: [
      gatewayGroup([
        {
          name: "shared-id",
          reasoningEffort: "medium",
        },
      ]),
      openAiGroup([
        {
          name: "shared-id",
          reasoningEffort: "medium",
        },
      ]),
    ],
    activeModel: { groupId: gatewayGroupId, name: "shared-id" },
  };

  const pruned = removeDelistedModelsFromCatalog(config, gatewayScopeProfile, {
    modelIds: ["openai/gpt-4.1"],
    fromCache: false,
    modelCatalog: [{ id: "openai/gpt-4.1", capabilities: ["languageModel"] }],
  });

  assert.deepEqual(pruned, ["shared-id"]);
  assert.deepEqual(
    config.providerGroups.flatMap((group) => group.models.map(() => group.provider)),
    ["openai"],
  );
  assert.deepEqual(config.activeModel, { groupId: openAiGroupId, name: "shared-id" });
});
