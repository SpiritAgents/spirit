import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";

import {
  providerInternalKeyAccount,
  providerInternalSlotAccount,
  setKeyringStoreForTests,
} from "./credentials/index.js";
import {
  NO_ACTIVE_MODEL_ERROR,
  resolveTransportConfig,
  tryResolveTransportConfig,
} from "./resolve-transport.js";

let store: Map<string, string>;

function useMemoryKeyring(initial: Record<string, string> = {}): void {
  store = new Map<string, string>(Object.entries(initial));
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

function internalKeyEntry(providerId: string): Record<string, string> {
  return { [`Spirit/${providerInternalKeyAccount(providerId)}`]: "test-key" };
}

function writeConfig(dir: string, config: Record<string, unknown>): void {
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      providers: [],
      activeModel: { providerId: "", name: "" },
      ...config,
    }),
  );
}

function configDir(config: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "spirit-resolve-transport-"));
  writeConfig(dir, config);
  return dir;
}

function providerWithActiveModel(
  provider: Record<string, unknown>,
  modelName: string,
): Record<string, unknown> {
  return {
    providers: [provider],
    activeModel: { providerId: provider["id"], name: modelName },
  };
}

test("tryResolveTransportConfig returns a setup error when no active model exists", () => {
  useMemoryKeyring();
  const spiritDataDir = configDir({});
  const result = tryResolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, NO_ACTIVE_MODEL_ERROR);
  }
});

test("tryResolveTransportConfig treats an empty modelRef as no selector", () => {
  useMemoryKeyring();
  const spiritDataDir = configDir({});
  const result = tryResolveTransportConfig({
    workspaceRoot: tmpdir(),
    spiritDataDir,
    modelRef: { providerId: "", name: "" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, NO_ACTIVE_MODEL_ERROR);
  }
});

test("resolveTransportConfig still throws when no active model exists", () => {
  useMemoryKeyring();
  const spiritDataDir = configDir({});
  assert.throws(
    () => resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir }),
    (error: unknown) => error instanceof Error && error.message === NO_ACTIVE_MODEL_ERROR,
  );
});

test("openai-compatible transport passes apiBase and declarations through verbatim", () => {
  useMemoryKeyring(internalKeyEntry("acme"));
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "acme",
        apiBase: "https://acme.test/v1",
        sdk: "@ai-sdk/openai-compatible",
        headers: { "X-Org-Id": "robotics" },
        body: { stream_options: { include_usage: true } },
        providerTools: [{ label: "Web Search", body: { enable_search: true } }],
        fileUpload: { path: "/files", refTemplate: "ms://{id}" },
        models: [
          {
            name: "chat-1",
            capabilities: ["languageModel", "image", "audio", "video"],
            reasoningEffort: "high",
            supportedReasoningEfforts: ["low", "high"],
            reasoningMode: "pro",
            supportedReasoningModes: ["standard", "pro"],
            contextLength: 128000,
            outputLimit: 8192,
            thinkingSwitch: {
              on: { body: { thinking: { type: "enabled" } } },
              off: { body: { thinking: { type: "disabled" } } },
            },
            serviceTiers: ["default", "flex"],
            serviceTier: "flex",
          },
        ],
      },
      "chat-1",
    ),
  );

  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  assert.equal(config.transportKind, "openai-compatible");
  assert.equal(config.apiKey, "test-key");
  assert.equal(config.baseUrl, "https://acme.test/v1");
  assert.equal(config.model, "chat-1");
  if (config.transportKind !== "openai-compatible") {
    assert.fail(`expected openai-compatible transport, got ${config.transportKind}`);
  }
  assert.equal(config.sdk, "@ai-sdk/openai-compatible");
  assert.deepEqual(config.headers, { "X-Org-Id": "robotics" });
  assert.deepEqual(config.body, { stream_options: { include_usage: true } });
  assert.deepEqual(config.providerTools, [{ label: "Web Search", body: { enable_search: true } }]);
  assert.deepEqual(config.fileUpload, { path: "/files", refTemplate: "ms://{id}" });
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.reasoningMode, "pro");
  assert.deepEqual(config.supportedReasoningModes, ["standard", "pro"]);
  assert.equal(config.outputLimit, 8192);
  assert.deepEqual(config.thinkingSwitch, {
    on: { body: { thinking: { type: "enabled" } } },
    off: { body: { thinking: { type: "disabled" } } },
  });
  assert.equal(config.serviceTier, "flex");
  assert.deepEqual(config.modelCapabilities, {
    languageModel: true,
    imageInput: true,
    audioInput: true,
    videoInput: true,
  });
  // Legacy vendor-keyed fields are no longer written.
  assert.equal("llmVendor" in config, false);
  assert.equal("responsesProvider" in config, false);
  assert.equal("cloudflareGatewayId" in config, false);
  assert.equal("upstreamProvider" in config, false);
  assert.equal("vertexProject" in config, false);
});

test("reasoningEffort default is not sent on the wire", () => {
  useMemoryKeyring(internalKeyEntry("acme"));
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "acme",
        apiBase: "https://acme.test/v1",
        models: [{ name: "chat-1", reasoningEffort: "default" }],
      },
      "chat-1",
    ),
  );
  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  assert.equal("reasoningEffort" in config, false);
});

test("flat apiKey wins over apiKeyEnv and the internal keyring", () => {
  useMemoryKeyring(internalKeyEntry("acme"));
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "acme",
        apiBase: "https://acme.test/v1",
        apiKey: "literal-key",
        apiKeyEnv: "SPIRIT_TEST_RESOLVE_TRANSPORT_KEY",
        models: [{ name: "chat-1" }],
      },
      "chat-1",
    ),
  );
  process.env["SPIRIT_TEST_RESOLVE_TRANSPORT_KEY"] = "env-key";
  try {
    const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
    assert.equal(config.apiKey, "literal-key");
  } finally {
    delete process.env["SPIRIT_TEST_RESOLVE_TRANSPORT_KEY"];
  }
});

test("apiKeyEnv resolves from the process environment", () => {
  useMemoryKeyring();
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "acme",
        apiBase: "https://acme.test/v1",
        apiKeyEnv: "SPIRIT_TEST_RESOLVE_TRANSPORT_KEY",
        models: [{ name: "chat-1" }],
      },
      "chat-1",
    ),
  );
  process.env["SPIRIT_TEST_RESOLVE_TRANSPORT_KEY"] = "env-key";
  try {
    const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
    assert.equal(config.apiKey, "env-key");
  } finally {
    delete process.env["SPIRIT_TEST_RESOLVE_TRANSPORT_KEY"];
  }
});

test("a declared but unresolvable key channel is a setup error", () => {
  useMemoryKeyring();
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "acme",
        apiBase: "https://acme.test/v1",
        apiKeyEnv: "SPIRIT_TEST_DEFINITELY_MISSING_KEY",
        models: [{ name: "chat-1" }],
      },
      "chat-1",
    ),
  );
  const result = tryResolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, `No API key found for model "chat-1". Run setup again.`);
  }
});

test("an entry with no key channel at all resolves unauthenticated", () => {
  useMemoryKeyring();
  const spiritDataDir = configDir(
    providerWithActiveModel(
      { id: "my-lab-llm", apiBase: "http://192.168.1.10:8000/v1", models: [{ name: "local-1" }] },
      "local-1",
    ),
  );
  const result = tryResolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.apiKey, "");
  }
});

test("open-responses transport stamps options and agent mode", () => {
  useMemoryKeyring(internalKeyEntry("responses-upstream"));
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "responses-upstream",
        apiBase: "https://responses.test/v1",
        transportKind: "open-responses",
        sdk: "@ai-sdk/open-responses",
        options: { storedState: true, applyPatch: true },
        models: [{ name: "frontier-1", reasoningEffort: "max" }],
      },
      "frontier-1",
    ),
  );
  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  if (config.transportKind !== "open-responses") {
    assert.fail(`expected open-responses transport, got ${config.transportKind}`);
  }
  assert.equal(config.agentMode, "agent");
  assert.deepEqual(config.options, { storedState: true, applyPatch: true });
  assert.equal(config.sdk, "@ai-sdk/open-responses");
  assert.equal(config.reasoningEffort, "max");
  assert.equal("responsesProvider" in config, false);
  assert.equal("llmVendor" in config, false);
});

test("anthropic transport maps effort onto the protocol enum", () => {
  useMemoryKeyring(internalKeyEntry("acme-anthropic"));
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "acme-anthropic",
        apiBase: "https://acme.test/anthropic",
        transportKind: "anthropic",
        sdk: "@ai-sdk/anthropic",
        models: [
          {
            name: "claude-ish",
            reasoningEffort: "xhigh",
            supportedReasoningEfforts: ["none", "low", "medium", "xhigh", "default"],
          },
        ],
      },
      "claude-ish",
    ),
  );
  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  if (config.transportKind !== "anthropic") {
    assert.fail(`expected anthropic transport, got ${config.transportKind}`);
  }
  assert.equal(config.effort, "xhigh");
  assert.deepEqual(config.supportedEfforts, ["low", "medium", "xhigh"]);
});

test("anthropic transport sends no effort for none/minimal/default declarations", () => {
  useMemoryKeyring(internalKeyEntry("acme-anthropic"));
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "acme-anthropic",
        apiBase: "https://acme.test/anthropic",
        transportKind: "anthropic",
        models: [{ name: "claude-ish", reasoningEffort: "minimal" }],
      },
      "claude-ish",
    ),
  );
  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  if (config.transportKind !== "anthropic") {
    assert.fail(`expected anthropic transport, got ${config.transportKind}`);
  }
  assert.equal("effort" in config, false);
});

test("bedrock transport maps options.awsRegion and IAM credential slots", () => {
  useMemoryKeyring({
    [`Spirit/${providerInternalSlotAccount("bedrock-upstream", "accessKeyId")}`]: "AKIAIOSFODNN7",
    [`Spirit/${providerInternalSlotAccount("bedrock-upstream", "secretAccessKey")}`]: "secret",
  });
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "bedrock-upstream",
        apiBase: "https://bedrock.us-east-1.amazonaws.com",
        transportKind: "bedrock",
        options: { awsRegion: "us-east-1" },
        models: [{ name: "anthropic.claude-opus-5-5-v1" }],
      },
      "anthropic.claude-opus-5-5-v1",
    ),
  );
  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  if (config.transportKind !== "bedrock") {
    assert.fail(`expected bedrock transport, got ${config.transportKind}`);
  }
  assert.equal(config.region, "us-east-1");
  assert.equal(config.accessKeyId, "AKIAIOSFODNN7");
  assert.equal(config.secretAccessKey, "secret");
  assert.equal("apiKey" in config, false);
  assert.equal("sdk" in config, false);
});

test("bedrock transport accepts a Bearer api key instead of IAM slots", () => {
  useMemoryKeyring(internalKeyEntry("bedrock-upstream"));
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "bedrock-upstream",
        apiBase: "https://bedrock.us-east-1.amazonaws.com",
        transportKind: "bedrock",
        options: { awsRegion: "us-east-1" },
        models: [{ name: "anthropic.claude-opus-5-5-v1" }],
      },
      "anthropic.claude-opus-5-5-v1",
    ),
  );
  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  if (config.transportKind !== "bedrock") {
    assert.fail(`expected bedrock transport, got ${config.transportKind}`);
  }
  assert.equal(config.apiKey, "test-key");
  assert.equal("accessKeyId" in config, false);
});

test("bedrock transport without options.awsRegion throws the region error", () => {
  useMemoryKeyring(internalKeyEntry("bedrock-upstream"));
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "bedrock-upstream",
        apiBase: "https://bedrock.us-east-1.amazonaws.com",
        transportKind: "bedrock",
        models: [{ name: "anthropic.claude-opus-5-5-v1" }],
      },
      "anthropic.claude-opus-5-5-v1",
    ),
  );
  assert.throws(
    () => resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir }),
    /Amazon Bedrock model is missing AWS region configuration\./,
  );
});

test("sigv4 open-responses (Bedrock Mantle) maps IAM slots onto bedrockMantleIam", () => {
  useMemoryKeyring({
    [`Spirit/${providerInternalSlotAccount("mantle", "accessKeyId")}`]: "AKIAIOSFODNN7",
    [`Spirit/${providerInternalSlotAccount("mantle", "secretAccessKey")}`]: "secret",
  });
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "mantle",
        apiBase: "https://bedrock-mantle.us-west-2.api.aws/openai/v1",
        transportKind: "open-responses",
        options: { auth: "aws-sigv4" },
        models: [{ name: "openai.gpt-5.5" }],
      },
      "openai.gpt-5.5",
    ),
  );
  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  if (config.transportKind !== "open-responses") {
    assert.fail(`expected open-responses transport, got ${config.transportKind}`);
  }
  assert.deepEqual(config.bedrockMantleIam, {
    region: "us-west-2",
    accessKeyId: "AKIAIOSFODNN7",
    secretAccessKey: "secret",
  });
  assert.equal(config.apiKey, "");
  assert.deepEqual(config.options, { auth: "aws-sigv4" });
});

test("sigv4 open-responses prefers a static Bearer key over IAM signing", () => {
  useMemoryKeyring({
    ...internalKeyEntry("mantle"),
    [`Spirit/${providerInternalSlotAccount("mantle", "accessKeyId")}`]: "AKIAIOSFODNN7",
    [`Spirit/${providerInternalSlotAccount("mantle", "secretAccessKey")}`]: "secret",
  });
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "mantle",
        apiBase: "https://bedrock-mantle.us-west-2.api.aws/openai/v1",
        transportKind: "open-responses",
        options: { auth: "aws-sigv4" },
        models: [{ name: "openai.gpt-5.5" }],
      },
      "openai.gpt-5.5",
    ),
  );
  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  if (config.transportKind !== "open-responses") {
    assert.fail(`expected open-responses transport, got ${config.transportKind}`);
  }
  assert.equal(config.apiKey, "test-key");
  assert.equal("bedrockMantleIam" in config, false);
});

test("sigv4 open-responses without any credentials throws the mantle error", () => {
  useMemoryKeyring();
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "mantle",
        apiBase: "https://bedrock-mantle.us-west-2.api.aws/openai/v1",
        transportKind: "open-responses",
        options: { auth: "aws-sigv4" },
        credentials: { accessKeyId: { env: "SPIRIT_TEST_MANTLE_MISSING" } },
        models: [{ name: "openai.gpt-5.5" }],
      },
      "openai.gpt-5.5",
    ),
  );
  assert.throws(
    () => resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir }),
    /Amazon Bedrock Mantle requires a Bearer API key or IAM credentials\./,
  );
});

test("vertex sdk maps options and credential slots onto the vertex fields", () => {
  useMemoryKeyring({
    [`Spirit/${providerInternalSlotAccount("vertex-upstream", "clientEmail")}`]:
      "sa@project.iam.gserviceaccount.com",
    [`Spirit/${providerInternalSlotAccount("vertex-upstream", "privateKey")}`]: "pem-body",
  });
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "vertex-upstream",
        apiBase: "https://us-central1-aiplatform.googleapis.com",
        sdk: "@ai-sdk/google-vertex",
        options: { project: "my-gcp-project", location: "us-central1" },
        models: [{ name: "publishers/google/models/gemini-3.5-flash" }],
      },
      "publishers/google/models/gemini-3.5-flash",
    ),
  );
  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  if (config.transportKind !== "openai-compatible") {
    assert.fail(`expected openai-compatible transport, got ${config.transportKind}`);
  }
  assert.equal(config.sdk, "@ai-sdk/google-vertex");
  assert.equal(config.vertexProject, "my-gcp-project");
  assert.equal(config.vertexLocation, "us-central1");
  assert.equal(config.vertexClientEmail, "sa@project.iam.gserviceaccount.com");
  assert.equal(config.vertexPrivateKey, "pem-body");
});

test("vertex sdk without any credentials is a setup error", () => {
  useMemoryKeyring();
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "vertex-upstream",
        apiBase: "https://us-central1-aiplatform.googleapis.com",
        sdk: "@ai-sdk/google-vertex",
        options: { project: "my-gcp-project", location: "us-central1" },
        models: [{ name: "gemini-3.5-flash" }],
      },
      "gemini-3.5-flash",
    ),
  );
  const result = tryResolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.error,
      `No Vertex credentials found for model "gemini-3.5-flash". Run setup again.`,
    );
  }
});

test("providerTools and webFetch opt-outs are stamped onto the transport config", () => {
  useMemoryKeyring(internalKeyEntry("acme"));
  const spiritDataDir = configDir({
    ...providerWithActiveModel(
      { id: "acme", apiBase: "https://acme.test/v1", models: [{ name: "chat-1" }] },
      "chat-1",
    ),
    agents: { providerTools: { enabled: false }, webFetch: { enabled: false } },
  });
  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  assert.equal(config.providerToolsEnabled, false);
  assert.equal(config.webFetchEnabled, false);
});

test("exposure flags are absent by default", () => {
  useMemoryKeyring(internalKeyEntry("acme"));
  const spiritDataDir = configDir(
    providerWithActiveModel(
      { id: "acme", apiBase: "https://acme.test/v1", models: [{ name: "chat-1" }] },
      "chat-1",
    ),
  );
  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  assert.equal("providerToolsEnabled" in config, false);
  assert.equal("webFetchEnabled" in config, false);
});

test("modelRef selects a non-active model", () => {
  useMemoryKeyring(internalKeyEntry("acme"));
  const spiritDataDir = configDir({
    providers: [
      {
        id: "acme",
        apiBase: "https://acme.test/v1",
        models: [{ name: "chat-1" }, { name: "chat-2", outputLimit: 4096 }],
      },
    ],
    activeModel: { providerId: "acme", name: "chat-1" },
  });
  const config = resolveTransportConfig({
    workspaceRoot: tmpdir(),
    spiritDataDir,
    modelRef: { providerId: "acme", name: "chat-2" },
  });
  assert.equal(config.model, "chat-2");
  if (config.transportKind === "openai-compatible") {
    assert.equal(config.outputLimit, 4096);
  }
});

test("provider-level flat declarations are inherited by the resolved profile", () => {
  useMemoryKeyring(internalKeyEntry("acme"));
  const spiritDataDir = configDir(
    providerWithActiveModel(
      {
        id: "acme",
        apiBase: "https://acme.test/v1",
        capabilities: ["languageModel"],
        contextLength: 262144,
        supportedReasoningModes: ["standard", "pro"],
        reasoningMode: "pro",
        models: [{ name: "chat-1" }, { name: "chat-2", contextLength: 1048576 }],
      },
      "chat-1",
    ),
  );
  const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
  assert.deepEqual(config.modelCapabilities, { languageModel: true });
  if (config.transportKind === "openai-compatible") {
    assert.equal(config.reasoningMode, "pro");
    assert.deepEqual(config.supportedReasoningModes, ["standard", "pro"]);
  }
});
