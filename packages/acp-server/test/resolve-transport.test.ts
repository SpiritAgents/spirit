import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { loadBaseConfig } from "../src/config.js";
import {
  providerAccessKeyIdAccount,
  providerKeyAccount,
  providerSecretAccessKeyAccount,
  providerVertexClientEmailAccount,
  providerVertexPrivateKeyAccount,
} from "@spiritagent/host-internal";
import { setKeyringStoreForTests } from "@spiritagent/host-internal";
import { resolveTransportConfig } from "@spiritagent/host-internal";
import { v2ConfigFixture } from "./fixtures/v2-config.js";

test("resolveTransportConfig builds bedrock transport from IAM credentials", () => {
  const modelName = "anthropic.claude-3-5-sonnet-20241022-v2:0";
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-bedrock-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify(
      v2ConfigFixture({
        groups: [
          {
            id: "amazon-bedrock",
            provider: "amazon-bedrock",
            apiBase: "https://bedrock-runtime.us-east-1.amazonaws.com",
            transportKind: "bedrock",
            awsRegion: "us-east-1",
            models: [
              {
                name: modelName,
                reasoningEffort: "medium",
                capabilities: ["languageModel"],
              },
            ],
          },
        ],
        activeModel: { groupId: "amazon-bedrock", name: modelName },
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
  passwords.set(providerAccessKeyIdAccount("amazon-bedrock"), "AKIAEXAMPLE");
  passwords.set(providerSecretAccessKeyAccount("amazon-bedrock"), "secret-key");

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
      v2ConfigFixture({
        groups: [
          {
            id: "google-vertex-ai",
            provider: "google-vertex-ai",
            apiBase: "https://us-central1-aiplatform.googleapis.com/v1",
            vertexProject: "my-project",
            vertexLocation: "us-central1",
            models: [
              {
                name: modelName,
                reasoningEffort: "medium",
                capabilities: ["languageModel"],
              },
            ],
          },
        ],
        activeModel: { groupId: "google-vertex-ai", name: modelName },
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
    providerVertexClientEmailAccount("google-vertex-ai"),
    "sa@my-project.iam.gserviceaccount.com",
  );
  passwords.set(
    providerVertexPrivateKeyAccount("google-vertex-ai"),
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

test("resolveTransportConfig defaults minimax to anthropic transport with llmVendor", () => {
  const modelName = "MiniMax-M3";
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-minimax-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify(
      v2ConfigFixture({
        groups: [
          {
            id: "minimax",
            provider: "minimax",
            apiBase: "https://api.minimax.cn/anthropic/v1",
            providerSite: "cn",
            models: [
              {
                name: modelName,
                reasoningEffort: "medium",
                capabilities: ["languageModel"],
              },
            ],
          },
        ],
        activeModel: { groupId: "minimax", name: modelName },
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
  passwords.set(providerKeyAccount("minimax"), "stored-key");

  try {
    const config = loadBaseConfig();
    config.spiritDataDir = dir;
    const transport = resolveTransportConfig(config);
    assert.equal(transport.transportKind, "anthropic");
    if (transport.transportKind === "anthropic") {
      assert.equal(transport.llmVendor, "minimax");
      assert.equal(transport.baseUrl, "https://api.minimax.cn/anthropic/v1");
      assert.equal(transport.apiKey, "stored-key");
    }
  } finally {
    setKeyringStoreForTests(undefined);
  }
});
