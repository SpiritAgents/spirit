import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";

import { SPIRIT_CONFIG_SCHEMA_VERSION, type SpiritConfigFile } from "./config.js";
import {
  loadModelProfile,
  loadSpiritConfig,
  providerInternalKeyAccount,
  providerInternalSlotAccount,
  saveProviderSetup,
  saveSpiritConfig,
  setKeyringStoreForTests,
} from "./credentials/index.js";

let store: Map<string, string>;

function useMemoryKeyring(): void {
  store = new Map<string, string>();
  setKeyringStoreForTests({
    getPassword: (service, account) => store.get(`${service}/${account}`),
    setPassword: (service, account, password) => {
      store.set(`${service}/${account}`, password);
    },
    deletePassword: (service, account) => {
      store.delete(`${service}/${account}`);
    },
  });
}

afterEach(() => {
  setKeyringStoreForTests(undefined);
});

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), "spirit-provider-setup-test-"));
}

test("saveProviderSetup materializes a preset entry, writes the key, and activates the model", async () => {
  useMemoryKeyring();
  const spiritDataDir = tempDataDir();

  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "openai" },
    credentials: { apiKey: "sk-test" },
    models: [{ name: "gpt-5.4", reasoningEffort: "high" }],
  });

  const config = loadSpiritConfig(spiritDataDir);
  assert.ok(config);
  assert.equal(config.schemaVersion, SPIRIT_CONFIG_SCHEMA_VERSION);
  assert.equal(config.providers.length, 1);
  const entry = config.providers[0]!;
  assert.equal(entry.id, "openai");
  assert.equal(entry.label, "OpenAI");
  assert.equal(entry.apiBase, "https://api.openai.com/v1");
  assert.equal(entry.transportKind, "open-responses");
  assert.equal(entry.sdk, "@ai-sdk/openai");
  assert.ok(entry.providerTools && entry.providerTools.length > 0);
  assert.equal(entry.imageApi, "openai-images");
  assert.deepEqual(entry.models, [{ name: "gpt-5.4", reasoningEffort: "high" }]);
  assert.deepEqual(config.activeModel, { providerId: "openai", name: "gpt-5.4" });
  assert.equal(store.get(`Spirit/${providerInternalKeyAccount("openai")}`), "sk-test");
});

test("saveProviderSetup materializes a custom connection from label and endpoint", async () => {
  useMemoryKeyring();
  const spiritDataDir = tempDataDir();

  await saveProviderSetup(spiritDataDir, {
    materialize: {
      presetId: "custom",
      label: "My Lab LLM",
      apiBaseOverride: "http://192.168.1.10:8000/v1",
    },
    models: [{ name: "qwen3-local" }],
  });

  const config = loadSpiritConfig(spiritDataDir);
  assert.ok(config);
  const entry = config.providers[0]!;
  assert.equal(entry.id, "my-lab-llm");
  assert.equal(entry.label, "My Lab LLM");
  assert.equal(entry.apiBase, "http://192.168.1.10:8000/v1");
  assert.equal("transportKind" in entry, false);
  assert.equal("sdk" in entry, false);
  assert.deepEqual(config.activeModel, { providerId: "my-lab-llm", name: "qwen3-local" });
});

test("reconnect resets wizard-owned keys and keeps user-owned keys and models", async () => {
  useMemoryKeyring();
  const spiritDataDir = tempDataDir();

  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "openai" },
    credentials: { apiKey: "sk-old" },
    models: [{ name: "gpt-5.4", reasoningEffort: "high" }],
  });

  const connected = loadSpiritConfig(spiritDataDir);
  assert.ok(connected);
  const entry = connected.providers[0]!;
  // User edits: a label, an extra header, a user-added model, plus edits to wizard-owned keys.
  const edited: SpiritConfigFile = {
    ...connected,
    providers: [
      {
        ...entry,
        label: "My OpenAI",
        headers: { "X-Org": "robotics" },
        apiBase: "https://proxy.example.test/v1",
        providerTools: [],
        models: [...entry.models, { name: "my-fine-tune", contextLength: 8192 }],
      },
    ],
  };
  await saveSpiritConfig(spiritDataDir, edited);

  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "openai" },
    credentials: { apiKey: "sk-new" },
    models: [{ name: "gpt-5.4", reasoningEffort: "medium" }],
  });

  const config = loadSpiritConfig(spiritDataDir);
  assert.ok(config);
  const merged = config.providers[0]!;
  // Wizard-owned keys reset to the fresh materialization.
  assert.equal(merged.apiBase, "https://api.openai.com/v1");
  assert.ok(merged.providerTools && merged.providerTools.length > 0);
  assert.equal(merged.sdk, "@ai-sdk/openai");
  assert.equal(merged.transportKind, "open-responses");
  // User-owned keys survive.
  assert.equal(merged.label, "My OpenAI");
  assert.deepEqual(merged.headers, { "X-Org": "robotics" });
  // The catalog-known model is updated by name; the user-added model survives.
  assert.deepEqual(merged.models, [
    { name: "gpt-5.4", reasoningEffort: "medium" },
    { name: "my-fine-tune", contextLength: 8192 },
  ]);
  assert.equal(store.get(`Spirit/${providerInternalKeyAccount("openai")}`), "sk-new");
  assert.deepEqual(config.activeModel, { providerId: "openai", name: "gpt-5.4" });
});

test("saveProviderSetup writes transport options and IAM credential slots", async () => {
  useMemoryKeyring();
  const spiritDataDir = tempDataDir();

  await saveProviderSetup(spiritDataDir, {
    materialize: {
      presetId: "amazon-bedrock",
      templateValues: { awsRegion: "us-east-1" },
    },
    options: { awsRegion: "us-east-1" },
    credentials: { accessKeyId: "AKIAIOSFODNN7", secretAccessKey: "secret" },
    models: [{ name: "anthropic.claude-opus-5-5-v1" }],
  });

  const config = loadSpiritConfig(spiritDataDir);
  assert.ok(config);
  const entry = config.providers[0]!;
  assert.equal(entry.id, "amazon-bedrock");
  assert.equal(entry.transportKind, "bedrock");
  assert.equal(entry.apiBase, "https://bedrock.us-east-1.amazonaws.com");
  assert.deepEqual(entry.options, { awsRegion: "us-east-1" });
  assert.equal("sdk" in entry, false);
  assert.equal(
    store.get(`Spirit/${providerInternalSlotAccount("amazon-bedrock", "accessKeyId")}`),
    "AKIAIOSFODNN7",
  );
  assert.equal(
    store.get(`Spirit/${providerInternalSlotAccount("amazon-bedrock", "secretAccessKey")}`),
    "secret",
  );
});

test("saveProviderSetup rejects credential slots outside the mechanism keyset", async () => {
  useMemoryKeyring();
  const spiritDataDir = tempDataDir();

  await assert.rejects(
    saveProviderSetup(spiritDataDir, {
      materialize: { presetId: "openai" },
      credentials: { accessKeyId: "AKIAIOSFODNN7" },
      models: [{ name: "gpt-5.4" }],
    }),
    /unknown credentials slot "accessKeyId"/,
  );
});

test("saveProviderSetup rejects an unknown preset id", async () => {
  useMemoryKeyring();
  const spiritDataDir = tempDataDir();

  await assert.rejects(
    saveProviderSetup(spiritDataDir, {
      materialize: { presetId: "no-such-preset" },
      models: [{ name: "m" }],
    }),
    /Unknown provider preset "no-such-preset"/,
  );
});

test("saveProviderSetup writes preset mechanism options scoped to the materialized transport", async () => {
  useMemoryKeyring();
  const spiritDataDir = tempDataDir();

  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "deepseek" },
    credentials: { apiKey: "sk-test" },
    models: [{ name: "deepseek-v4-flash" }],
  });
  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "xiaomi" },
    credentials: { apiKey: "sk-test" },
    models: [{ name: "mimo-v2.5" }],
  });
  // Default transport is openai-compatible: the open-responses-scoped template key is dropped.
  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "volcengine" },
    credentials: { apiKey: "sk-test" },
    models: [{ name: "doubao-seed-2-0" }],
  });

  const connected = loadSpiritConfig(spiritDataDir);
  assert.ok(connected);
  const connectedById = new Map(connected.providers.map((provider) => [provider.id, provider]));
  assert.deepEqual(connectedById.get("deepseek")?.options, { echoServerToolCalls: true });
  assert.deepEqual(connectedById.get("xiaomi")?.options, { maxInlineMediaBytes: 52428800 });
  assert.equal(connectedById.get("volcengine")?.options, undefined);

  // Reconnecting over open-responses materializes the scoped template key.
  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "volcengine", transportKind: "open-responses" },
    credentials: { apiKey: "sk-test" },
    models: [{ name: "doubao-seed-2-0" }],
  });

  const config = loadSpiritConfig(spiritDataDir);
  assert.ok(config);
  const byId = new Map(config.providers.map((provider) => [provider.id, provider]));
  assert.deepEqual(byId.get("volcengine")?.options, { defaultInputItemStatus: "completed" });
});

test("saveProviderSetup writes preset body / thinkingSwitch templates and resets them on reconnect", async () => {
  useMemoryKeyring();
  const spiritDataDir = tempDataDir();

  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "kimi-code" },
    credentials: { apiKey: "sk-test" },
    models: [{ name: "k2.5" }],
  });
  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "meituan" },
    credentials: { apiKey: "sk-test" },
    models: [{ name: "longcat-2.5-preview" }],
  });

  const connected = loadSpiritConfig(spiritDataDir);
  assert.ok(connected);
  const connectedById = new Map(connected.providers.map((provider) => [provider.id, provider]));
  assert.deepEqual(connectedById.get("kimi-code")?.body, {
    stream_options: { include_usage: true },
  });
  assert.deepEqual(connectedById.get("meituan")?.thinkingSwitch, {
    on: { body: { thinking: { type: "enabled" } } },
    off: { body: { thinking: { type: "disabled" } } },
  });

  // User edits to the templated keys are reset on reconnect.
  const edited: SpiritConfigFile = {
    ...connected,
    providers: connected.providers.map((provider) =>
      provider.id === "kimi-code"
        ? { ...provider, body: { stream_options: { include_usage: false } } }
        : provider.id === "meituan"
          ? {
              ...provider,
              thinkingSwitch: { on: { body: { thinking: { type: "adaptive" } } } },
            }
          : provider,
    ),
  };
  await saveSpiritConfig(spiritDataDir, edited);

  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "kimi-code" },
    credentials: { apiKey: "sk-test" },
    models: [{ name: "k2.5" }],
  });
  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "meituan" },
    credentials: { apiKey: "sk-test" },
    models: [{ name: "longcat-2.5-preview" }],
  });

  const config = loadSpiritConfig(spiritDataDir);
  assert.ok(config);
  const byId = new Map(config.providers.map((provider) => [provider.id, provider]));
  assert.deepEqual(byId.get("kimi-code")?.body, {
    stream_options: { include_usage: true },
  });
  assert.deepEqual(byId.get("meituan")?.thinkingSwitch, {
    on: { body: { thinking: { type: "enabled" } } },
    off: { body: { thinking: { type: "disabled" } } },
  });
});

test("reconnect on a template-less preset keeps the user's hand-written body / thinkingSwitch", async () => {
  useMemoryKeyring();
  const spiritDataDir = tempDataDir();

  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "openai" },
    credentials: { apiKey: "sk-test" },
    models: [{ name: "gpt-5.4" }],
  });

  const connected = loadSpiritConfig(spiritDataDir);
  assert.ok(connected);
  const entry = connected.providers[0]!;
  assert.equal(entry.body, undefined);
  assert.equal(entry.thinkingSwitch, undefined);
  // The openai preset declares no body / thinkingSwitch template; the user's escape hatch is
  // not wizard-owned and must survive reconnect.
  const edited: SpiritConfigFile = {
    ...connected,
    providers: [
      {
        ...entry,
        body: { parallel_tool_calls: false },
        thinkingSwitch: { off: { body: { reasoning: { effort: "none" } } } },
      },
    ],
  };
  await saveSpiritConfig(spiritDataDir, edited);

  await saveProviderSetup(spiritDataDir, {
    materialize: { presetId: "openai" },
    credentials: { apiKey: "sk-test" },
    models: [{ name: "gpt-5.4" }],
  });

  const config = loadSpiritConfig(spiritDataDir);
  assert.ok(config);
  const merged = config.providers[0]!;
  assert.deepEqual(merged.body, { parallel_tool_calls: false });
  assert.deepEqual(merged.thinkingSwitch, { off: { body: { reasoning: { effort: "none" } } } });
});

test("loadModelProfile carries connection fields and evaluates inheritance", async () => {
  useMemoryKeyring();
  const spiritDataDir = tempDataDir();

  const config: SpiritConfigFile = {
    schemaVersion: SPIRIT_CONFIG_SCHEMA_VERSION,
    providers: [
      {
        id: "acme",
        label: "Acme",
        apiBase: "https://acme.test/v1",
        sdk: "@ai-sdk/openai-compatible",
        apiKeyEnv: "ACME_API_KEY",
        headers: { "X-Org": "robotics" },
        capabilities: ["languageModel", "image"],
        contextLength: 262144,
        supportedReasoningEfforts: ["low", "high"],
        reasoningEffort: "low",
        thinkingSwitch: {
          on: { body: { thinking: { type: "enabled" } } },
          off: { body: { thinking: { type: "disabled" } } },
        },
        models: [
          { name: "chat-1" },
          { name: "chat-2", contextLength: 1048576, reasoningEffort: "high" },
        ],
      },
    ],
    activeModel: { providerId: "acme", name: "chat-1" },
  };
  await saveSpiritConfig(spiritDataDir, config);

  const inherited = loadModelProfile(spiritDataDir, { providerId: "acme", name: "chat-1" });
  assert.ok(inherited);
  assert.equal(inherited.providerId, "acme");
  assert.deepEqual(inherited.ref, { providerId: "acme", name: "chat-1" });
  assert.equal(inherited.name, "chat-1");
  assert.equal(inherited.apiBase, "https://acme.test/v1");
  assert.equal(inherited.sdk, "@ai-sdk/openai-compatible");
  assert.equal(inherited.apiKeyEnv, "ACME_API_KEY");
  assert.deepEqual(inherited.headers, { "X-Org": "robotics" });
  // Effective (post-inheritance) model fields.
  assert.deepEqual(inherited.capabilities, ["languageModel", "image"]);
  assert.equal(inherited.contextLength, 262144);
  assert.deepEqual(inherited.supportedReasoningEfforts, ["low", "high"]);
  assert.equal(inherited.reasoningEffort, "low");
  assert.deepEqual(inherited.thinkingSwitch, {
    on: { body: { thinking: { type: "enabled" } } },
    off: { body: { thinking: { type: "disabled" } } },
  });

  const overridden = loadModelProfile(spiritDataDir, { providerId: "acme", name: "chat-2" });
  assert.ok(overridden);
  assert.equal(overridden.contextLength, 1048576);
  assert.equal(overridden.reasoningEffort, "high");
  assert.deepEqual(overridden.capabilities, ["languageModel", "image"]);

  assert.equal(loadModelProfile(spiritDataDir, { providerId: "acme", name: "nope" }), undefined);
  assert.equal(loadModelProfile(spiritDataDir, { providerId: "nope", name: "chat-1" }), undefined);
});
