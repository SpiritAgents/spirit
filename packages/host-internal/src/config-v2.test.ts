import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  assertSpiritConfigSchemaVersion,
  emptyModelRef,
  findModelByRef,
  isEmptyModelRef,
  modelExistsInGroup,
  modelRefKey,
  modelRefsEqual,
  parseModelRef,
  slugifyProviderGroupLabel,
  SpiritConfigSchemaError,
  SPIRIT_CONFIG_SCHEMA_VERSION,
} from "./config-v2.js";
import type { ProviderGroupV2 } from "./config-v2.js";
import { loadModelProfile, loadSpiritConfig, saveSpiritConfig } from "./credentials/index.js";
import type { SpiritConfigFile } from "./credentials/types.js";

test("assertSpiritConfigSchemaVersion rejects missing or wrong version", () => {
  assert.throws(() => assertSpiritConfigSchemaVersion({}), SpiritConfigSchemaError);
  assert.throws(
    () => assertSpiritConfigSchemaVersion({ schemaVersion: 1 }),
    SpiritConfigSchemaError,
  );
  assert.doesNotThrow(() =>
    assertSpiritConfigSchemaVersion({ schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION }),
  );
});

test("parseModelRef requires groupId and name", () => {
  assert.deepEqual(parseModelRef({ groupId: "openai", name: "gpt-4.1" }), {
    groupId: "openai",
    name: "gpt-4.1",
  });
  assert.equal(parseModelRef({ groupId: "openai", name: "" }), undefined);
});

test("modelExistsInGroup is scoped to group", () => {
  const groups: ProviderGroupV2[] = [
    {
      id: "vercel-ai-gateway",
      provider: "vercel-ai-gateway",
      apiBase: "https://example.com/v1",
      models: [{ name: "openai/gpt-4.1", reasoningEffort: "medium" }],
    },
    {
      id: "openrouter",
      provider: "openrouter",
      apiBase: "https://openrouter.ai/api/v1",
      models: [{ name: "openai/gpt-4.1", reasoningEffort: "medium" }],
    },
  ];
  assert.equal(modelExistsInGroup(groups, "vercel-ai-gateway", "openai/gpt-4.1"), true);
  assert.equal(modelExistsInGroup(groups, "openrouter", "openai/gpt-4.1"), true);
  assert.equal(modelExistsInGroup(groups, "vercel-ai-gateway", "missing"), false);
  assert.equal(
    findModelByRef(groups, { groupId: "openrouter", name: "openai/gpt-4.1" })?.model.name,
    "openai/gpt-4.1",
  );
});

test("slugifyProviderGroupLabel normalizes custom group names", () => {
  assert.equal(slugifyProviderGroupLabel("My Local Ollama"), "my-local-ollama");
  assert.equal(slugifyProviderGroupLabel("---"), "custom-group");
});

test("modelRef helpers", () => {
  const ref = { groupId: "openai", name: "gpt-4.1" };
  assert.equal(modelRefKey(ref), "openai::gpt-4.1");
  assert.equal(modelRefsEqual(ref, { ...ref }), true);
  assert.equal(isEmptyModelRef(emptyModelRef()), true);
});

test("config.json round trip preserves serviceTier and upstreamProvider without a schema bump", async () => {
  const spiritDataDir = mkdtempSync(join(tmpdir(), "spirit-config-v2-tier-"));
  const config: SpiritConfigFile = {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providerGroups: [
      {
        id: "openrouter",
        provider: "openrouter",
        apiBase: "https://openrouter.ai/api/v1",
        models: [
          {
            name: "openai/gpt-5.4",
            reasoningEffort: "medium",
            serviceTier: "flex",
            upstreamProvider: "openai",
          },
          { name: "x-ai/grok-4.3", reasoningEffort: "medium" },
        ],
      },
    ],
    activeModel: { groupId: "openrouter", name: "openai/gpt-5.4" },
  };

  await saveSpiritConfig(spiritDataDir, config);
  const loaded = loadSpiritConfig(spiritDataDir);
  assert.ok(loaded);
  assert.equal(loaded.schemaVersion, 2);

  const entry = findModelByRef(loaded.providerGroups, loaded.activeModel)?.model;
  assert.equal(entry?.serviceTier, "flex");
  assert.equal(entry?.upstreamProvider, "openai");

  // Entries without the fields stay bare: no defaults are injected on load/save.
  const bare = findModelByRef(loaded.providerGroups, {
    groupId: "openrouter",
    name: "x-ai/grok-4.3",
  })?.model;
  assert.ok(bare);
  assert.equal("serviceTier" in bare, false);
  assert.equal("upstreamProvider" in bare, false);

  // The fields flow from the stored entry into the resolved model profile.
  const profile = loadModelProfile(spiritDataDir, {
    groupId: "openrouter",
    name: "openai/gpt-5.4",
  });
  assert.equal(profile?.serviceTier, "flex");
  assert.equal(profile?.upstreamProvider, "openai");
});
