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

test("assertSpiritConfigSchemaVersion rejects the legacy schemaVersion 2", () => {
  assert.throws(() => assertSpiritConfigSchemaVersion({ schemaVersion: 2 }), ConfigSchemaError);
});

test("assertSpiritConfigSchemaVersion accepts schemaVersion 1", () => {
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
      `${JSON.stringify(
        {
          schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
          providers: [],
          activeModel: { providerId: "", name: "" },
          ...rawConfig,
        },
        null,
        2,
      )}\n`,
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

const openAiProviderWithModels = (models) => ({
  id: "openai",
  apiBase: "https://api.openai.com/v1",
  transportKind: "open-responses",
  models,
});

test("loadConfig preserves declared serviceTier on model entries", async () => {
  await withConfigFile(
    {
      providers: [
        openAiProviderWithModels([
          {
            name: "gpt-6-astra",
            reasoningEffort: "medium",
            serviceTiers: ["auto", "default", "flex", "fast", "ultrafast"],
            serviceTier: "ultrafast",
          },
          { name: "gpt-5.4", reasoningEffort: "medium" },
        ]),
      ],
      activeModel: { providerId: "openai", name: "gpt-6-astra" },
    },
    (config) => {
      const [astra, plain] = config.providers[0].models;
      assert.equal(astra.serviceTier, "ultrafast");
      assert.equal("serviceTier" in plain, false);
    },
  );
});

test("loadConfig fails fast on undeclared or malformed model fields", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-config-schema-"));
  setSpiritDataDirOverride(dir);
  try {
    await writeFile(
      path.join(dir, "config.json"),
      `${JSON.stringify(
        {
          schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
          providers: [
            openAiProviderWithModels([
              {
                name: "gpt-5.4",
                serviceTier: 7,
              },
            ]),
          ],
          activeModel: { providerId: "openai", name: "gpt-5.4" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    // Invalid field values must surface as a schema error, never a silent rewrite.
    await assert.rejects(loadConfig(), ConfigSchemaError);
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test("saveConfig after loadConfig keeps serviceTier on disk", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spirit-config-schema-"));
  setSpiritDataDirOverride(dir);
  try {
    await writeFile(
      path.join(dir, "config.json"),
      `${JSON.stringify(
        {
          schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
          providers: [
            openAiProviderWithModels([
              {
                name: "gpt-6-astra",
                serviceTiers: ["default", "flex"],
                serviceTier: "flex",
              },
            ]),
          ],
          activeModel: { providerId: "openai", name: "gpt-6-astra" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const config = await loadConfig();
    await saveConfig(config);
    const written = JSON.parse(await readFile(path.join(dir, "config.json"), "utf8"));
    const [model] = written.providers[0].models;
    assert.equal(model.serviceTier, "flex");
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
