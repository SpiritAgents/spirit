import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { loadBaseConfig } from "../src/config.js";
import { providerInternalSlotAccount } from "@spiritagent/host-internal";
import { setKeyringStoreForTests } from "@spiritagent/host-internal";
import { resolveTransportConfig } from "@spiritagent/host-internal";
import { v1ConfigFixture } from "./fixtures/v1-config.js";

test("resolveTransportConfig builds bedrock transport from IAM credentials", () => {
  const modelName = "anthropic.claude-3-5-sonnet-20241022-v2:0";
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-bedrock-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify(
      v1ConfigFixture({
        providers: [
          {
            id: "amazon-bedrock",
            apiBase: "https://bedrock-runtime.us-east-1.amazonaws.com",
            transportKind: "bedrock",
            options: { awsRegion: "us-east-1" },
            models: [
              {
                name: modelName,
                capabilities: ["languageModel"],
              },
            ],
          },
        ],
        activeModel: { providerId: "amazon-bedrock", name: modelName },
      }),
    ),
    "utf8",
  );

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
  passwords.set(providerInternalSlotAccount("amazon-bedrock", "accessKeyId"), "AKIAEXAMPLE");
  passwords.set(providerInternalSlotAccount("amazon-bedrock", "secretAccessKey"), "secret-key");

  try {
    const config = loadBaseConfig();
    config.spiritDataDir = dir;
    const transport = resolveTransportConfig(config);
    assert.equal(transport.transportKind, "bedrock");
    if (transport.transportKind === "bedrock") {
      assert.equal(transport.region, "us-east-1");
      assert.equal(transport.accessKeyId, "AKIAEXAMPLE");
      assert.equal(transport.secretAccessKey, "secret-key");
    }
  } finally {
    setKeyringStoreForTests(undefined);
  }
});

test("resolveTransportConfig builds vertex transport from service account credentials", () => {
  const modelName = "gemini-2.0-flash";
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-vertex-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify(
      v1ConfigFixture({
        providers: [
          {
            id: "google-vertex-ai",
            apiBase: "https://us-central1-aiplatform.googleapis.com/v1",
            sdk: "@ai-sdk/google-vertex",
            options: { project: "my-project", location: "us-central1" },
            models: [
              {
                name: modelName,
                capabilities: ["languageModel"],
              },
            ],
          },
        ],
        activeModel: { providerId: "google-vertex-ai", name: modelName },
      }),
    ),
    "utf8",
  );

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
  passwords.set(
    providerInternalSlotAccount("google-vertex-ai", "clientEmail"),
    "sa@my-project.iam.gserviceaccount.com",
  );
  passwords.set(
    providerInternalSlotAccount("google-vertex-ai", "privateKey"),
    "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----",
  );

  try {
    const config = loadBaseConfig();
    config.spiritDataDir = dir;
    const transport = resolveTransportConfig(config);
    assert.equal(transport.transportKind, "openai-compatible");
    if (transport.transportKind === "openai-compatible") {
      assert.equal(transport.vertexProject, "my-project");
      assert.equal(transport.vertexLocation, "us-central1");
      assert.equal(transport.vertexClientEmail, "sa@my-project.iam.gserviceaccount.com");
      assert.ok(transport.vertexPrivateKey?.includes("BEGIN PRIVATE KEY"));
    }
  } finally {
    setKeyringStoreForTests(undefined);
  }
});

test("resolveTransportConfig resolves an anthropic-transport entry by declaration", () => {
  const modelName = "MiniMax-M3";
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-minimax-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify(
      v1ConfigFixture({
        providers: [
          {
            id: "minimax",
            apiBase: "https://api.minimax.cn/anthropic/v1",
            transportKind: "anthropic",
            models: [
              {
                name: modelName,
                capabilities: ["languageModel"],
              },
            ],
          },
        ],
        activeModel: { providerId: "minimax", name: modelName },
      }),
    ),
    "utf8",
  );

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
  passwords.set(providerInternalSlotAccount("minimax", "apiKey"), "stored-key");

  try {
    const config = loadBaseConfig();
    config.spiritDataDir = dir;
    const transport = resolveTransportConfig(config);
    assert.equal(transport.transportKind, "anthropic");
    if (transport.transportKind === "anthropic") {
      // No vendor identity fields exist on the resolved config anymore.
      assert.equal("llmVendor" in transport, false);
      assert.equal(transport.baseUrl, "https://api.minimax.cn/anthropic/v1");
      assert.equal(transport.apiKey, "stored-key");
    }
  } finally {
    setKeyringStoreForTests(undefined);
  }
});
