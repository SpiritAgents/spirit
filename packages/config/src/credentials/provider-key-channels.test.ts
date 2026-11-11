import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import type { ProviderEntry } from "../config.js";

import { setKeyringStoreForTests } from "./keyring-store.js";
import {
  providerInternalKeyAccount,
  providerInternalSlotAccount,
  resolveProviderApiKey,
  resolveProviderApiKeyResolution,
  resolveProviderCredentialSlot,
  resolveProviderCredentialSlotResolution,
} from "./provider-key-channels.js";

const stores: Array<Map<string, string>> = [];

function useMemoryKeyring(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial));
  stores.push(store);
  setKeyringStoreForTests({
    getPassword: (service, account) => store.get(`${service}/${account}`),
    setPassword: (service, account, password) => {
      store.set(`${service}/${account}`, password);
    },
    deletePassword: (service, account) => {
      store.delete(`${service}/${account}`);
    },
  });
  return store;
}

afterEach(() => {
  setKeyringStoreForTests(undefined);
  stores.length = 0;
});

function provider(overrides: Partial<ProviderEntry> = {}): ProviderEntry {
  return {
    id: "test-provider",
    apiBase: "https://example.com/v1",
    models: [{ name: "test-model" }],
    ...overrides,
  };
}

test("internal keyring account scheme is provider::{id} with slot suffixes", () => {
  assert.equal(providerInternalKeyAccount("kimi-code"), "provider::kimi-code");
  assert.equal(providerInternalSlotAccount("kimi-code", "apiKey"), "provider::kimi-code");
  assert.equal(
    providerInternalSlotAccount("amazon-bedrock", "accessKeyId"),
    "provider::amazon-bedrock::accessKeyId",
  );
  assert.equal(
    providerInternalSlotAccount("google-vertex-ai", "privateKey"),
    "provider::google-vertex-ai::privateKey",
  );
});

test("flat literal apiKey wins over every other channel", () => {
  useMemoryKeyring({ "Spirit/provider::test-provider": "internal-key" });
  const entry = provider({
    apiKey: "literal-key",
    apiKeyEnv: "TEST_PROVIDER_KEY",
    apiKeyKeyring: { service: "Vault", account: "test" },
  });
  const store = stores[0]!;
  store.set("Vault/test", "external-key");
  const resolution = resolveProviderApiKeyResolution(entry, {
    env: { TEST_PROVIDER_KEY: "env-key" },
  });
  assert.equal(resolution.value, "literal-key");
  assert.equal(resolution.source, "value");
  assert.deepEqual(resolution.misses, []);
});

test("blank literal falls through to the env channel", () => {
  useMemoryKeyring();
  const resolution = resolveProviderApiKeyResolution(
    provider({ apiKey: "   ", apiKeyEnv: "TEST_PROVIDER_KEY" }),
    { env: { TEST_PROVIDER_KEY: "env-key" } },
  );
  assert.equal(resolution.value, "env-key");
  assert.equal(resolution.source, "env");
  assert.deepEqual(resolution.misses, [{ source: "value" }]);
});

test("missing or blank env falls through to the external keyring channel", () => {
  const store = useMemoryKeyring({ "Vault/test": "external-key" });
  const entry = provider({
    apiKeyEnv: "TEST_PROVIDER_KEY",
    apiKeyKeyring: { service: "Vault", account: "test" },
  });
  const resolution = resolveProviderApiKeyResolution(entry, { env: {} });
  assert.equal(resolution.value, "external-key");
  assert.equal(resolution.source, "keyring");
  assert.deepEqual(resolution.misses, [{ source: "env", env: "TEST_PROVIDER_KEY" }]);

  const blankEnv = resolveProviderApiKeyResolution(entry, {
    env: { TEST_PROVIDER_KEY: "  " },
  });
  assert.equal(blankEnv.value, "external-key");

  store.set("Vault/test", "");
  const empty = resolveProviderApiKeyResolution(entry, { env: {} });
  assert.equal(empty.value, undefined);
  assert.deepEqual(empty.misses, [
    { source: "env", env: "TEST_PROVIDER_KEY" },
    { source: "keyring", keyring: { service: "Vault", account: "test" } },
    { source: "internalKeyring", account: "provider::test-provider" },
  ]);
});

test("internal keyring provider::{id} is the implicit final fallback", () => {
  useMemoryKeyring({ "Spirit/provider::test-provider": "internal-key" });
  const resolution = resolveProviderApiKeyResolution(provider(), { env: {} });
  assert.equal(resolution.value, "internal-key");
  assert.equal(resolution.source, "internalKeyring");
  assert.deepEqual(resolution.misses, []);
});

test("nothing resolving yields undefined with every declared miss recorded", () => {
  useMemoryKeyring();
  const entry = provider({ apiKeyEnv: "MISSING_KEY" });
  assert.equal(resolveProviderApiKey(entry, { env: {} }), undefined);
  const resolution = resolveProviderApiKeyResolution(entry, { env: {} });
  assert.equal(resolution.source, undefined);
  assert.deepEqual(resolution.misses, [
    { source: "env", env: "MISSING_KEY" },
    { source: "internalKeyring", account: "provider::test-provider" },
  ]);
});

test("credentials.apiKey slot resolves value → env → keyring → provider::{id}", () => {
  const store = useMemoryKeyring();
  const entry = provider({
    credentials: {
      apiKey: { value: "", env: "SLOT_ENV", keyring: { service: "Vault", account: "slot" } },
    },
  });
  assert.equal(resolveProviderApiKey(entry, { env: { SLOT_ENV: "slot-env-key" } }), "slot-env-key");

  store.set("Vault/slot", "slot-keyring-key");
  const resolution = resolveProviderApiKeyResolution(entry, { env: {} });
  assert.equal(resolution.value, "slot-keyring-key");
  assert.equal(resolution.source, "keyring");
  assert.deepEqual(resolution.misses, [{ source: "value" }, { source: "env", env: "SLOT_ENV" }]);

  store.delete("Vault/slot");
  store.set("Spirit/provider::test-provider", "internal-key");
  const internal = resolveProviderApiKeyResolution(entry, { env: {} });
  assert.equal(internal.value, "internal-key");
  assert.equal(internal.source, "internalKeyring");
});

test("flat channels take precedence over a credentials.apiKey slot", () => {
  useMemoryKeyring();
  const entry = provider({
    apiKeyEnv: "FLAT_ENV",
    credentials: { apiKey: { value: "slot-value" } },
  });
  const resolution = resolveProviderApiKeyResolution(entry, { env: { FLAT_ENV: "flat-env-key" } });
  assert.equal(resolution.value, "flat-env-key");
  assert.equal(resolution.source, "env");
});

test("credentials slots resolve bedrock and vertex shapes", () => {
  const store = useMemoryKeyring({
    "Spirit/provider::amazon-bedrock::secretAccessKey": "internal-secret",
  });
  const bedrock = provider({
    id: "amazon-bedrock",
    transportKind: "bedrock",
    credentials: {
      accessKeyId: { env: "AWS_ACCESS_KEY_ID" },
      secretAccessKey: {},
    },
  });
  assert.equal(
    resolveProviderCredentialSlot(bedrock, "accessKeyId", {
      env: { AWS_ACCESS_KEY_ID: "AKIA…" },
    }),
    "AKIA…",
  );
  const secret = resolveProviderCredentialSlotResolution(bedrock, "secretAccessKey", { env: {} });
  assert.equal(secret.value, "internal-secret");
  assert.equal(secret.source, "internalKeyring");

  const vertex = provider({
    id: "google-vertex-ai",
    sdk: "@ai-sdk/google-vertex",
    credentials: {
      clientEmail: { value: "sa@project.iam.gserviceaccount.com" },
      privateKey: { keyring: { service: "Vault", account: "vertex-sa" } },
    },
  });
  assert.equal(
    resolveProviderCredentialSlot(vertex, "clientEmail"),
    "sa@project.iam.gserviceaccount.com",
  );
  store.set("Vault/vertex-sa", "pem-body");
  assert.equal(resolveProviderCredentialSlot(vertex, "privateKey"), "pem-body");

  const undeclared = resolveProviderCredentialSlotResolution(provider(), "accessKeyId", {
    env: {},
  });
  assert.equal(undeclared.value, undefined);
  assert.deepEqual(undeclared.misses, [
    { source: "internalKeyring", account: "provider::test-provider::accessKeyId" },
  ]);
});
