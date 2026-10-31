import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyModelsRemovalToConfig,
  buildModelSecretKeyPresence,
  filterNewProviderModelIds,
  modelExistsInProviderScope,
  resolveActiveModelAfterRemoval,
} from "../../dist-electron/src/host/provider-api-key.js";

const openAiProviderId = "openai";
const anthropicProviderId = "anthropic";
const gatewayProviderId = "vercel-ai-gateway";

test("buildModelSecretKeyPresence reads each provider once", () => {
  const providerReads = [];

  const presence = buildModelSecretKeyPresence(
    [
      { providerId: openAiProviderId, name: "a" },
      { providerId: openAiProviderId, name: "b" },
      { providerId: anthropicProviderId, name: "c" },
      { providerId: "custom-local", name: "legacy-only" },
    ],
    (providerId) => {
      providerReads.push(providerId);
      return providerId === openAiProviderId;
    },
  );

  assert.deepEqual(providerReads, [openAiProviderId, anthropicProviderId, "custom-local"]);
  assert.equal(presence["openai::a"], true);
  assert.equal(presence["openai::b"], true);
  assert.equal(presence["anthropic::c"], false);
  assert.equal(presence["custom-local::legacy-only"], false);
});

test("modelExistsInProviderScope only matches same provider entry", () => {
  const existing = [
    { providerId: openAiProviderId, name: "gpt-4" },
    { providerId: gatewayProviderId, name: "gpt-4" },
  ];
  assert.equal(modelExistsInProviderScope(existing, openAiProviderId, "gpt-4"), true);
  assert.equal(modelExistsInProviderScope(existing, anthropicProviderId, "gpt-4"), false);
  assert.equal(modelExistsInProviderScope(existing, "custom", "gpt-4"), false);
});

test("resolveActiveModelAfterRemoval switches to another model or clears active", () => {
  const remaining = [
    { providerId: openAiProviderId, name: "b" },
    { providerId: openAiProviderId, name: "c" },
  ];
  assert.deepEqual(
    resolveActiveModelAfterRemoval({ providerId: openAiProviderId, name: "a" }, remaining, [
      { providerId: openAiProviderId, name: "a" },
    ]),
    { providerId: openAiProviderId, name: "b" },
  );
  assert.deepEqual(
    resolveActiveModelAfterRemoval(
      { providerId: openAiProviderId, name: "a" },
      [],
      [{ providerId: openAiProviderId, name: "a" }],
    ),
    { providerId: "", name: "" },
  );
  assert.deepEqual(
    resolveActiveModelAfterRemoval({ providerId: openAiProviderId, name: "b" }, remaining, [
      { providerId: openAiProviderId, name: "a" },
    ]),
    { providerId: openAiProviderId, name: "b" },
  );
});

test("applyModelsRemovalToConfig clears default slots when active model is removed", () => {
  const config = {
    providers: [
      {
        id: openAiProviderId,
        apiBase: "https://api.openai.com/v1",
        models: [
          { name: "a", capabilities: ["languageModel"] },
          { name: "b", capabilities: ["languageModel"] },
        ],
      },
    ],
    activeModel: { providerId: openAiProviderId, name: "a" },
    imageGenerationModel: { providerId: openAiProviderId, name: "a" },
    videoGenerationModel: { providerId: openAiProviderId, name: "b" },
    secondaryLanguageModel: { providerId: openAiProviderId, name: "a" },
  };

  assert.equal(
    applyModelsRemovalToConfig(config, [{ ref: { providerId: openAiProviderId, name: "a" } }]),
    1,
  );
  assert.deepEqual(
    config.providers[0].models.map((model) => model.name),
    ["b"],
  );
  assert.deepEqual(config.activeModel, { providerId: openAiProviderId, name: "b" });
  assert.equal(config.imageGenerationModel, undefined);
  assert.deepEqual(config.videoGenerationModel, { providerId: openAiProviderId, name: "b" });
  assert.equal(config.secondaryLanguageModel, undefined);
});

test("applyModelsRemovalToConfig only removes models in the same provider entry", () => {
  const config = {
    providers: [
      {
        id: openAiProviderId,
        apiBase: "https://api.openai.com/v1",
        models: [{ name: "shared-id", capabilities: ["languageModel"] }],
      },
      {
        id: gatewayProviderId,
        apiBase: "https://ai-gateway.vercel.sh/v1",
        transportKind: "open-responses",
        models: [{ name: "shared-id", capabilities: ["languageModel"] }],
      },
    ],
    activeModel: { providerId: openAiProviderId, name: "shared-id" },
    videoGenerationModel: { providerId: openAiProviderId, name: "shared-id" },
  };

  assert.equal(
    applyModelsRemovalToConfig(config, [
      { ref: { providerId: openAiProviderId, name: "shared-id" } },
    ]),
    1,
  );
  assert.deepEqual(
    config.providers.flatMap((provider) => provider.models.map(() => provider.id)),
    [gatewayProviderId],
  );
  assert.deepEqual(config.activeModel, { providerId: gatewayProviderId, name: "shared-id" });
  assert.equal(config.videoGenerationModel, undefined);
});

test("filterNewProviderModelIds skips only duplicates within the provider entry", () => {
  const existing = [{ providerId: openAiProviderId, name: "shared-id" }];
  const filtered = filterNewProviderModelIds(existing, ["shared-id", "new-id"], gatewayProviderId);
  assert.deepEqual(filtered, ["shared-id", "new-id"]);
  assert.deepEqual(filterNewProviderModelIds(existing, ["shared-id", "new-id"], openAiProviderId), [
    "new-id",
  ]);
});
