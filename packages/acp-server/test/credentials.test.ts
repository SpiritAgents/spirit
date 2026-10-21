import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  loadSpiritConfig,
  providerInternalSlotAccount,
  saveProviderSetup,
  setKeyringStoreForTests,
} from "@spiritagent/host-internal";
import { buildProviderSetupResult } from "../src/setup/provider-wizard.js";

function openAiSetup(overrides: Record<string, unknown> = {}) {
  return {
    ...buildProviderSetupResult({
      provider: "openai",
      modelName: "gpt-4o-mini",
    }),
    credentials: { apiKey: "secret-key" },
    ...overrides,
  };
}

test("loadSpiritConfig returns undefined for invalid JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-config-"));
  writeFileSync(join(dir, "config.json"), "{not json", "utf8");
  assert.equal(loadSpiritConfig(dir), undefined);
});

test("loadSpiritConfig rejects legacy schemaVersion 2 config", () => {
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-config-v2-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      schemaVersion: 2,
      providerGroups: [
        {
          id: "openai",
          provider: "openai",
          apiBase: "https://api.openai.com/v1",
          models: [{ name: "gpt-4o-mini" }],
        },
      ],
      activeModel: { groupId: "openai", name: "gpt-4o-mini" },
    }),
    "utf8",
  );
  assert.equal(loadSpiritConfig(dir), undefined);
});

test("saveProviderSetup writes keyring before config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-save-"));
  const setup = openAiSetup();

  setKeyringStoreForTests({
    getPassword: () => undefined,
    setPassword: () => {
      throw new Error("keyring unavailable");
    },
    deletePassword: () => {},
  });

  try {
    await assert.rejects(() => saveProviderSetup(dir, setup), /keyring unavailable/);
    assert.equal(existsSync(join(dir, "config.json")), false);
  } finally {
    setKeyringStoreForTests(undefined);
  }
});

test("saveProviderSetup persists keyring and config together", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-save-"));
  const passwords = new Map<string, string>();
  setKeyringStoreForTests({
    getPassword: (_service, account) => passwords.get(account),
    setPassword: (_service, account, password) => {
      passwords.set(account, password);
    },
    deletePassword: (_service, account) => {
      passwords.delete(account);
    },
  });

  const setup = openAiSetup();

  try {
    await saveProviderSetup(dir, setup);
    assert.equal(passwords.get(providerInternalSlotAccount("openai", "apiKey")), "secret-key");
    const config = loadSpiritConfig(dir);
    assert.equal(config?.schemaVersion, 1);
    assert.deepEqual(config?.activeModel, { providerId: "openai", name: "gpt-4o-mini" });
    assert.equal(config?.providers.length, 1);
    assert.equal(config?.providers[0]?.models.length, 1);
    assert.equal(config?.providers[0]?.models[0]?.name, "gpt-4o-mini");
    // The materialized preset entry carries the resolved apiBase and sdk declaration.
    assert.equal(config?.providers[0]?.apiBase, "https://api.openai.com/v1");
    assert.equal(config?.providers[0]?.sdk, "@ai-sdk/openai");
  } finally {
    setKeyringStoreForTests(undefined);
  }
});

test("saveProviderSetup persists bedrock IAM credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-save-bedrock-"));
  const passwords = new Map<string, string>();
  setKeyringStoreForTests({
    getPassword: (_service, account) => passwords.get(account),
    setPassword: (_service, account, password) => {
      passwords.set(account, password);
    },
    deletePassword: (_service, account) => {
      passwords.delete(account);
    },
  });

  const setup = {
    ...buildProviderSetupResult({
      provider: "amazon-bedrock",
      modelName: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      awsRegion: "us-east-1",
    }),
    credentials: {
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret-key",
    },
  };

  try {
    await saveProviderSetup(dir, setup);
    assert.equal(
      passwords.get(providerInternalSlotAccount("amazon-bedrock", "accessKeyId")),
      "AKIAEXAMPLE",
    );
    assert.equal(
      passwords.get(providerInternalSlotAccount("amazon-bedrock", "secretAccessKey")),
      "secret-key",
    );
    const config = loadSpiritConfig(dir);
    assert.deepEqual(config?.activeModel, {
      providerId: "amazon-bedrock",
      name: setup.models?.[0]?.name,
    });
    assert.equal(config?.providers[0]?.transportKind, "bedrock");
    assert.deepEqual(config?.providers[0]?.options, { awsRegion: "us-east-1" });
  } finally {
    setKeyringStoreForTests(undefined);
  }
});
