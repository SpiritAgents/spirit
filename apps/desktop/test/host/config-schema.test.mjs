import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  assertSpiritConfigSchemaVersion,
  SPIRIT_CONFIG_SCHEMA_VERSION,
} from "@spiritagent/host-internal";
import {
  ConfigSchemaError,
  loadConfig,
  saveConfig,
  setSpiritDataDirOverride,
} from "../../dist-electron/src/host/storage.js";

test("assertSpiritConfigSchemaVersion rejects legacy schemaVersion 1", () => {
  assert.throws(() => assertSpiritConfigSchemaVersion({ schemaVersion: 1 }), ConfigSchemaError);
});

test("assertSpiritConfigSchemaVersion accepts schemaVersion 2", () => {
  assert.doesNotThrow(() =>
    assertSpiritConfigSchemaVersion({ schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION }),
  );
});

async function withConfigFile(rawConfig, run) {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-config-schema-"));
  setSpiritDataDirOverride(dir);
  try {
    await writeFile(
      path.join(dir, "config.json"),
      `${JSON.stringify({ schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION, ...rawConfig }, null, 2)}\n`,
      "utf8",
    );
    await run(await loadConfig());
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadConfig round-trips the permission allowlist block", async () => {
  const permission = {
    shell: { "git status": "allow" },
    read_file: { "/etc/hosts": "ask" },
  };
  await withConfigFile({ permission }, (config) => {
    assert.deepEqual(config.permission, permission);
  });
});

test("loadConfig drops a non-object permission value", async () => {
  await withConfigFile({ permission: "allow-everything" }, (config) => {
    assert.equal(config.permission, undefined);
  });
});

const openAiGroupWithModels = (models) => ({
  id: "openai",
  provider: "openai",
  apiBase: "https://api.openai.com/v1",
  transportKind: "open-responses",
  models,
});

test("loadConfig preserves serviceTier and upstreamProvider on model entries", async () => {
  await withConfigFile(
    {
      providerGroups: [
        openAiGroupWithModels([
          {
            name: "gpt-6-astra",
            reasoningEffort: "medium",
            serviceTier: "ultrafast",
            upstreamProvider: "OpenAI",
          },
          { name: "gpt-5.4", reasoningEffort: "medium" },
        ]),
      ],
      activeModel: { groupId: "openai", name: "gpt-6-astra" },
    },
    (config) => {
      const [astra, plain] = config.providerGroups[0].models;
      assert.equal(astra.serviceTier, "ultrafast");
      assert.equal(astra.upstreamProvider, "OpenAI");
      assert.equal("serviceTier" in plain, false);
      assert.equal("upstreamProvider" in plain, false);
    },
  );
});

test("loadConfig drops non-string serviceTier and upstreamProvider values", async () => {
  await withConfigFile(
    {
      providerGroups: [
        openAiGroupWithModels([
          {
            name: "gpt-5.4",
            reasoningEffort: "medium",
            serviceTier: 7,
            upstreamProvider: { name: "openai" },
          },
        ]),
      ],
      activeModel: { groupId: "openai", name: "gpt-5.4" },
    },
    (config) => {
      const [model] = config.providerGroups[0].models;
      assert.equal("serviceTier" in model, false);
      assert.equal("upstreamProvider" in model, false);
    },
  );
});

test("saveConfig after loadConfig keeps serviceTier and upstreamProvider on disk", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-config-schema-"));
  setSpiritDataDirOverride(dir);
  try {
    await writeFile(
      path.join(dir, "config.json"),
      `${JSON.stringify(
        {
          schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
          providerGroups: [
            openAiGroupWithModels([
              {
                name: "gpt-6-astra",
                reasoningEffort: "medium",
                serviceTier: "flex",
                upstreamProvider: "OpenAI",
              },
            ]),
          ],
          activeModel: { groupId: "openai", name: "gpt-6-astra" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const config = await loadConfig();
    await saveConfig(config);
    const written = JSON.parse(await readFile(path.join(dir, "config.json"), "utf8"));
    const [model] = written.providerGroups[0].models;
    assert.equal(model.serviceTier, "flex");
    assert.equal(model.upstreamProvider, "OpenAI");
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
