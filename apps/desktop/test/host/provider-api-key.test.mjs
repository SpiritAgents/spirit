import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyModelsRemovalToConfig,
  buildModelSecretKeyPresence,
  filterNewProviderModelIds,
  modelExistsInProviderScope,
  modelProviderKeyScope,
  providerKeyAccount,
  resolveActiveModelAfterRemoval,
} from "../../dist-electron/src/host/provider-api-key.js";

const openAiGroupId = "openai";
const anthropicGroupId = "anthropic";
const gatewayGroupId = "vercel-ai-gateway";

test("providerKeyAccount uses group namespace", () => {
  assert.equal(providerKeyAccount("vercel-ai-gateway"), "group::vercel-ai-gateway");
  assert.equal(providerKeyAccount("openrouter"), "group::openrouter");
  assert.equal(providerKeyAccount("custom"), "group::custom");
});

test("modelProviderKeyScope defaults missing provider to custom", () => {
  assert.equal(modelProviderKeyScope(undefined), "custom");
  assert.equal(modelProviderKeyScope("openai"), "openai");
});

test("buildModelSecretKeyPresence reads each provider once", () => {
  const groupReads = [];
  const modelReads = [];

  const presence = buildModelSecretKeyPresence(
    [
      { groupId: openAiGroupId, name: "a", provider: "openai" },
      { groupId: openAiGroupId, name: "b", provider: "openai" },
      { groupId: anthropicGroupId, name: "c", provider: "anthropic" },
      { groupId: "custom", name: "legacy-only" },
    ],
    (groupId, _profile) => {
      groupReads.push(groupId);
      return groupId === openAiGroupId;
    },
    (refKey) => {
      modelReads.push(refKey);
      return refKey === "custom::legacy-only";
    },
  );

  assert.deepEqual(groupReads, [openAiGroupId, anthropicGroupId, "custom"]);
  assert.deepEqual(modelReads, ["anthropic::c", "custom::legacy-only"]);
  assert.equal(presence["openai::a"], true);
  assert.equal(presence["openai::b"], true);
  assert.equal(presence["anthropic::c"], false);
  assert.equal(presence["custom::legacy-only"], true);
});

test("buildModelSecretKeyPresence prefers provider key over per-model key", () => {
  const presence = buildModelSecretKeyPresence(
    [{ groupId: openAiGroupId, name: "gpt-4", provider: "openai" }],
    () => true,
    () => false,
  );
  assert.equal(presence["openai::gpt-4"], true);
});

test("modelExistsInProviderScope only matches same provider scope", () => {
  const existing = [
    { groupId: openAiGroupId, name: "gpt-4", provider: "openai" },
    { groupId: gatewayGroupId, name: "gpt-4", provider: "vercel-ai-gateway" },
  ];
  assert.equal(modelExistsInProviderScope(existing, "gpt-4", "openai"), true);
  assert.equal(modelExistsInProviderScope(existing, "gpt-4", "anthropic"), false);
  assert.equal(modelExistsInProviderScope(existing, "gpt-4"), false);
});

test("resolveActiveModelAfterRemoval switches to another model or clears active", () => {
  const remaining = [
    { groupId: openAiGroupId, name: "b" },
    { groupId: openAiGroupId, name: "c" },
  ];
  assert.deepEqual(
    resolveActiveModelAfterRemoval({ groupId: openAiGroupId, name: "a" }, remaining, [
      { groupId: openAiGroupId, name: "a" },
    ]),
    { groupId: openAiGroupId, name: "b" },
  );
  assert.deepEqual(
    resolveActiveModelAfterRemoval(
      { groupId: openAiGroupId, name: "a" },
      [],
      [{ groupId: openAiGroupId, name: "a" }],
    ),
    { groupId: "", name: "" },
  );
  assert.deepEqual(
    resolveActiveModelAfterRemoval({ groupId: openAiGroupId, name: "b" }, remaining, [
      { groupId: openAiGroupId, name: "a" },
    ]),
    { groupId: openAiGroupId, name: "b" },
  );
});

test("applyModelsRemovalToConfig clears default slots when active model is removed", () => {
  const config = {
    providerGroups: [
      {
        id: openAiGroupId,
        provider: "openai",
        apiBase: "https://api.openai.com/v1",
        models: [
          { name: "a", reasoningEffort: "medium", capabilities: ["languageModel"] },
          { name: "b", reasoningEffort: "medium", capabilities: ["languageModel"] },
        ],
      },
    ],
    activeModel: { groupId: openAiGroupId, name: "a" },
    imageGenerationModel: { groupId: openAiGroupId, name: "a" },
    videoGenerationModel: { groupId: openAiGroupId, name: "b" },
    secondaryLanguageModel: { groupId: openAiGroupId, name: "a" },
  };

  assert.equal(
    applyModelsRemovalToConfig(config, [{ ref: { groupId: openAiGroupId, name: "a" } }]),
    1,
  );
  assert.deepEqual(
    config.providerGroups[0].models.map((model) => model.name),
    ["b"],
  );
  assert.deepEqual(config.activeModel, { groupId: openAiGroupId, name: "b" });
  assert.equal(config.imageGenerationModel, undefined);
  assert.deepEqual(config.videoGenerationModel, { groupId: openAiGroupId, name: "b" });
  assert.equal(config.secondaryLanguageModel, undefined);
});

test("applyModelsRemovalToConfig only removes models in the same provider scope", () => {
  const config = {
    providerGroups: [
      {
        id: openAiGroupId,
        provider: "openai",
        apiBase: "https://api.openai.com/v1",
        models: [{ name: "shared-id", reasoningEffort: "medium", capabilities: ["languageModel"] }],
      },
      {
        id: gatewayGroupId,
        provider: "vercel-ai-gateway",
        apiBase: "https://ai-gateway.vercel.sh/v1",
        transportKind: "open-responses",
        models: [{ name: "shared-id", reasoningEffort: "medium", capabilities: ["languageModel"] }],
      },
    ],
    activeModel: { groupId: openAiGroupId, name: "shared-id" },
    videoGenerationModel: { groupId: openAiGroupId, name: "shared-id" },
  };

  assert.equal(
    applyModelsRemovalToConfig(config, [{ ref: { groupId: openAiGroupId, name: "shared-id" } }]),
    1,
  );
  assert.deepEqual(
    config.providerGroups.flatMap((group) => group.models.map(() => group.provider)),
    ["vercel-ai-gateway"],
  );
  assert.deepEqual(config.activeModel, { groupId: gatewayGroupId, name: "shared-id" });
  assert.equal(config.videoGenerationModel, undefined);
});

test("filterNewProviderModelIds skips only duplicates within provider scope", () => {
  const existing = [{ groupId: openAiGroupId, name: "shared-id", provider: "openai" }];
  const filtered = filterNewProviderModelIds(existing, ["shared-id", "new-id"], gatewayGroupId);
  assert.deepEqual(filtered, ["shared-id", "new-id"]);
  assert.deepEqual(filterNewProviderModelIds(existing, ["shared-id", "new-id"], openAiGroupId), [
    "new-id",
  ]);
});
