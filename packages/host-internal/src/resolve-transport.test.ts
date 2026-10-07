import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { ModelServiceTierConfigError } from "@spiritagent/agent-core/model-service-tier";

import { groupKeyAccount, setKeyringStoreForTests } from "./credentials/index.js";
import {
  NO_ACTIVE_MODEL_ERROR,
  resolveTransportConfig,
  tryResolveTransportConfig,
} from "./resolve-transport.js";

function emptyConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "spirit-resolve-transport-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      schemaVersion: 2,
      providerGroups: [],
      activeModel: { groupId: "", name: "" },
    }),
  );
  return dir;
}

test("tryResolveTransportConfig returns a setup error when no active model exists", () => {
  const spiritDataDir = emptyConfigDir();
  const result = tryResolveTransportConfig({
    workspaceRoot: tmpdir(),
    spiritDataDir,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, NO_ACTIVE_MODEL_ERROR);
  }
});

test("tryResolveTransportConfig treats an empty modelRef as no selector", () => {
  const spiritDataDir = emptyConfigDir();
  const result = tryResolveTransportConfig({
    workspaceRoot: tmpdir(),
    spiritDataDir,
    modelRef: { groupId: "", name: "" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, NO_ACTIVE_MODEL_ERROR);
  }
});

test("resolveTransportConfig still throws when no active model exists", () => {
  const spiritDataDir = emptyConfigDir();
  assert.throws(
    () =>
      resolveTransportConfig({
        workspaceRoot: tmpdir(),
        spiritDataDir,
      }),
    (error: unknown) => error instanceof Error && error.message === NO_ACTIVE_MODEL_ERROR,
  );
});

// ---------------------------------------------------------------------------
// service tier persistence / resolution
// ---------------------------------------------------------------------------

interface TierFixtureOptions {
  provider: string;
  modelName: string;
  serviceTier?: string;
  upstreamProvider?: string;
  vertexLocation?: string;
  awsRegion?: string;
}

function writeTierConfig(spiritDataDir: string, options: TierFixtureOptions): void {
  const groupId = options.provider;
  writeFileSync(
    join(spiritDataDir, "config.json"),
    JSON.stringify({
      schemaVersion: 2,
      providerGroups: [
        {
          id: groupId,
          provider: options.provider,
          apiBase: "https://example.test/v1",
          ...(options.vertexLocation ? { vertexLocation: options.vertexLocation } : {}),
          ...(options.awsRegion ? { awsRegion: options.awsRegion } : {}),
          models: [
            {
              name: options.modelName,
              ...(options.serviceTier !== undefined ? { serviceTier: options.serviceTier } : {}),
              ...(options.upstreamProvider !== undefined
                ? { upstreamProvider: options.upstreamProvider }
                : {}),
            },
          ],
        },
      ],
      activeModel: { groupId, name: options.modelName },
    }),
  );
}

function tierConfigDir(options: TierFixtureOptions): string {
  const dir = mkdtempSync(join(tmpdir(), "spirit-resolve-transport-tier-"));
  writeTierConfig(dir, options);
  return dir;
}

function withMockKeyring(groupIds: readonly string[], run: () => void): void {
  const store = new Map<string, string>();
  setKeyringStoreForTests({
    getPassword: (service, account) => store.get(`${service}/${account}`),
    setPassword: (service, account, password) => {
      store.set(`${service}/${account}`, password);
    },
    deletePassword: (service, account) => {
      store.delete(`${service}/${account}`);
    },
  });
  for (const groupId of groupIds) {
    store.set(`Spirit/${groupKeyAccount(groupId)}`, "test-key");
  }
  try {
    run();
  } finally {
    setKeyringStoreForTests(undefined);
  }
}

test("resolveTransportConfig carries serviceTier and upstreamProvider for an aggregator route", () => {
  withMockKeyring(["openrouter"], () => {
    const spiritDataDir = tierConfigDir({
      provider: "openrouter",
      modelName: "openai/gpt-5.4",
      serviceTier: "flex",
      upstreamProvider: "openai",
    });
    const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
    if (config.transportKind !== "openai-compatible") {
      assert.fail(`expected openai-compatible transport, got ${config.transportKind}`);
    }
    assert.equal(config.serviceTier, "flex");
    assert.equal(config.upstreamProvider, "openai");
  });
});

test("resolveTransportConfig stamps serviceTier on the open-responses transport", () => {
  withMockKeyring(["openai"], () => {
    const spiritDataDir = tierConfigDir({
      provider: "openai",
      modelName: "gpt-5.4",
      serviceTier: "flex",
    });
    const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
    if (config.transportKind !== "open-responses") {
      assert.fail(`expected open-responses transport, got ${config.transportKind}`);
    }
    assert.equal(config.serviceTier, "flex");
    assert.equal("upstreamProvider" in config, false);
  });
});

test("resolveTransportConfig stamps serviceTier on the anthropic transport for native Fast models", () => {
  withMockKeyring(["anthropic"], () => {
    const spiritDataDir = tierConfigDir({
      provider: "anthropic",
      modelName: "claude-opus-5",
      serviceTier: "fast",
    });
    const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
    if (config.transportKind !== "anthropic") {
      assert.fail(`expected anthropic transport, got ${config.transportKind}`);
    }
    assert.equal(config.serviceTier, "fast");
    assert.equal("upstreamProvider" in config, false);
  });
});

test("resolveTransportConfig leaves the bedrock transport without service tier fields", () => {
  withMockKeyring(["amazon-bedrock"], () => {
    const spiritDataDir = tierConfigDir({
      provider: "amazon-bedrock",
      modelName: "anthropic.claude-sonnet-4-5-v1:0",
      awsRegion: "us-east-1",
    });
    const config = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
    if (config.transportKind !== "bedrock") {
      assert.fail(`expected bedrock transport, got ${config.transportKind}`);
    }
    assert.equal("serviceTier" in config, false);
    assert.equal("upstreamProvider" in config, false);
  });
});

test("resolveTransportConfig rejects unsupported or unknown service tiers", () => {
  withMockKeyring(["openai", "anthropic", "amazon-bedrock"], () => {
    // OpenAI has no Priority tier (Flex/Fast only beyond Auto/Default).
    const priorityOnOpenAi = tierConfigDir({
      provider: "openai",
      modelName: "gpt-5.4",
      serviceTier: "priority",
    });
    const untouched = readFileSync(join(priorityOnOpenAi, "config.json"), "utf8");
    assert.throws(
      () => resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir: priorityOnOpenAi }),
      ModelServiceTierConfigError,
    );
    // The config file is left untouched for the user to fix.
    assert.equal(readFileSync(join(priorityOnOpenAi, "config.json"), "utf8"), untouched);

    // Anthropic native Fast is limited to eligible Claude Opus models.
    const fastOnSonnet = tierConfigDir({
      provider: "anthropic",
      modelName: "claude-sonnet-4-5",
      serviceTier: "fast",
    });
    assert.throws(
      () => resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir: fastOnSonnet }),
      ModelServiceTierConfigError,
    );

    // Unknown values are rejected rather than normalized away.
    const unknownTier = tierConfigDir({
      provider: "openai",
      modelName: "gpt-5.4",
      serviceTier: "turbo",
    });
    assert.throws(
      () => resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir: unknownTier }),
      /Unknown service tier "turbo"/,
    );

    // Providers outside the capability matrix reject any configured tier.
    const tierOnBedrock = tierConfigDir({
      provider: "amazon-bedrock",
      modelName: "anthropic.claude-sonnet-4-5-v1:0",
      awsRegion: "us-east-1",
      serviceTier: "fast",
    });
    assert.throws(
      () => resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir: tierOnBedrock }),
      ModelServiceTierConfigError,
    );
  });
});

test("resolveTransportConfig gates Vertex non-default tiers to the global endpoint", () => {
  withMockKeyring(["google-vertex-ai"], () => {
    const regional = tierConfigDir({
      provider: "google-vertex-ai",
      modelName: "gemini-3-pro",
      serviceTier: "flex",
      vertexLocation: "us-central1",
    });
    assert.throws(
      () => resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir: regional }),
      ModelServiceTierConfigError,
    );

    const globalEndpoint = tierConfigDir({
      provider: "google-vertex-ai",
      modelName: "gemini-3-pro",
      serviceTier: "flex",
      vertexLocation: "global",
    });
    const config = resolveTransportConfig({
      workspaceRoot: tmpdir(),
      spiritDataDir: globalEndpoint,
    });
    if (config.transportKind !== "openai-compatible") {
      assert.fail(`expected openai-compatible transport, got ${config.transportKind}`);
    }
    assert.equal(config.serviceTier, "flex");
  });
});

test("tryResolveTransportConfig propagates ModelServiceTierConfigError instead of degrading", () => {
  withMockKeyring(["openai"], () => {
    const spiritDataDir = tierConfigDir({
      provider: "openai",
      modelName: "gpt-5.4",
      serviceTier: "priority",
    });
    // Not a success-shaped result and not an { ok: false } setup error: the invalid
    // manual config throws so the daemon/Desktop surface it instead of misreporting it.
    assert.throws(
      () => tryResolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir }),
      ModelServiceTierConfigError,
    );
  });
});

test("re-resolution after rewriting config.json picks up the new service tier", () => {
  withMockKeyring(["openrouter"], () => {
    const base = {
      provider: "openrouter",
      modelName: "openai/gpt-5.4",
      upstreamProvider: "openai",
    };
    const spiritDataDir = tierConfigDir({ ...base, serviceTier: "flex" });

    const first = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
    if (first.transportKind !== "openai-compatible") {
      assert.fail(`expected openai-compatible transport, got ${first.transportKind}`);
    }
    assert.equal(first.serviceTier, "flex");

    // Same model, new tier: the daemon's session.replaceConfig re-reads config.json.
    writeTierConfig(spiritDataDir, { ...base, serviceTier: "fast" });
    const second = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
    if (second.transportKind !== "openai-compatible") {
      assert.fail(`expected openai-compatible transport, got ${second.transportKind}`);
    }
    assert.equal(second.serviceTier, "fast");

    // Clearing the preference removes the field from the resolved transport.
    writeTierConfig(spiritDataDir, base);
    const third = resolveTransportConfig({ workspaceRoot: tmpdir(), spiritDataDir });
    if (third.transportKind !== "openai-compatible") {
      assert.fail(`expected openai-compatible transport, got ${third.transportKind}`);
    }
    assert.equal("serviceTier" in third, false);
    assert.equal(third.upstreamProvider, "openai");
  });
});
