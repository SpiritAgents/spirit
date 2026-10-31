import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { AuthState, createAuthState } from "../src/auth/auth-state.js";
import { buildAuthMethods, buildTerminalAuthMethod } from "../src/auth/build-auth-methods.js";
import { TERMINAL_AUTH_ARGS, TERMINAL_AUTH_METHOD_ID } from "../src/auth/constants.js";
import { canCreateSession, createInitialAuthState } from "../src/auth/session-auth.js";
import { loadBaseConfig } from "../src/config.js";
import { hasResolvableCredentials, setKeyringStoreForTests } from "@spiritagent/host-internal";
import { providerInternalKeyAccount, resolveTransportConfig } from "@spiritagent/host-internal";
import {
  validateAzureSetup,
  validateBedrockCredentials,
  validateCustomSetup,
  validateModelName,
  buildProviderSetupResult,
} from "../src/setup/provider-wizard.js";
import { openAiProvider, v1ConfigFixture } from "./fixtures/v1-config.js";

test("buildTerminalAuthMethod declares terminal setup args", () => {
  const method = buildTerminalAuthMethod();
  assert.equal(method.id, TERMINAL_AUTH_METHOD_ID);
  assert.equal((method as { type?: string }).type, "terminal");
  assert.deepEqual((method as { args?: string[] }).args, [...TERMINAL_AUTH_ARGS]);
});

test("buildAuthMethods returns a non-empty terminal method list", () => {
  const methods = buildAuthMethods();
  assert.equal(methods.length, 1);
  assert.equal((methods[0] as { type?: string }).type, "terminal");
});

test("AuthState pre-authenticates when constructed with true", () => {
  const state = createAuthState(true);
  assert.equal(state.isAuthenticated(), true);
  state.logout();
  assert.equal(state.isAuthenticated(), false);
});

test("buildAuthMethods returns terminal auth even when shared credentials exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-auth-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify(
      v1ConfigFixture({
        providers: [openAiProvider([{ name: "gpt-4o-mini", capabilities: ["languageModel"] }])],
        activeModel: { providerId: "openai", name: "gpt-4o-mini" },
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
  passwords.set(providerInternalKeyAccount("openai"), "stored-key");

  try {
    assert.equal(buildAuthMethods().length, 1);
  } finally {
    setKeyringStoreForTests(undefined);
  }
});

test("logout allows authenticate to restore session creation", () => {
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-auth-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify(
      v1ConfigFixture({
        providers: [openAiProvider([{ name: "gpt-4o-mini", capabilities: ["languageModel"] }])],
        activeModel: { providerId: "openai", name: "gpt-4o-mini" },
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
  passwords.set(providerInternalKeyAccount("openai"), "stored-key");

  try {
    const config = loadBaseConfig();
    config.spiritDataDir = dir;
    const authState = createInitialAuthState(config);
    assert.equal(canCreateSession(config, authState), true);

    authState.logout();
    assert.equal(canCreateSession(config, authState), false);

    authState.markAuthenticated();
    assert.equal(canCreateSession(config, authState), true);
  } finally {
    setKeyringStoreForTests(undefined);
  }
});

test("createInitialAuthState pre-authenticates when shared credentials exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-auth-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify(
      v1ConfigFixture({
        providers: [openAiProvider([{ name: "gpt-4o-mini", capabilities: ["languageModel"] }])],
        activeModel: { providerId: "openai", name: "gpt-4o-mini" },
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
  passwords.set(providerInternalKeyAccount("openai"), "stored-key");

  try {
    const config = loadBaseConfig();
    config.spiritDataDir = dir;
    const authState = createInitialAuthState(config);
    assert.equal(authState.isAuthenticated(), true);
    assert.equal(canCreateSession(config, authState), true);
  } finally {
    setKeyringStoreForTests(undefined);
  }
});

test("canCreateSession requires authenticate when using shared credentials without pre-auth", () => {
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-auth-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify(
      v1ConfigFixture({
        providers: [openAiProvider([{ name: "gpt-4o-mini", capabilities: ["languageModel"] }])],
        activeModel: { providerId: "openai", name: "gpt-4o-mini" },
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
  passwords.set(providerInternalKeyAccount("openai"), "stored-key");

  try {
    const config = loadBaseConfig();
    config.spiritDataDir = dir;
    const unauthenticated = new AuthState(false);
    assert.equal(hasResolvableCredentials(dir), true);
    assert.equal(canCreateSession(config, unauthenticated), false);

    unauthenticated.markAuthenticated();
    assert.equal(canCreateSession(config, unauthenticated), true);
  } finally {
    setKeyringStoreForTests(undefined);
  }
});

test("loadBaseConfig only resolves runtime paths", () => {
  const config = loadBaseConfig();
  assert.ok(config.workspaceRoot);
  assert.ok(config.spiritDataDir);
  assert.equal(Object.keys(config).sort().join(","), "spiritDataDir,workspaceRoot");
});

test("resolveTransportConfig reads shared config and keyring", () => {
  const dir = mkdtempSync(join(tmpdir(), "spirit-acp-transport-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify(
      v1ConfigFixture({
        providers: [openAiProvider([{ name: "gpt-4o-mini", capabilities: ["languageModel"] }])],
        activeModel: { providerId: "openai", name: "gpt-4o-mini" },
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
  passwords.set(providerInternalKeyAccount("openai"), "stored-key");

  try {
    const config = loadBaseConfig();
    config.spiritDataDir = dir;
    const transport = resolveTransportConfig(config);
    assert.equal(transport.transportKind, "open-responses");
    if (transport.transportKind === "open-responses") {
      assert.equal(transport.apiKey, "stored-key");
      assert.equal(transport.model, "gpt-4o-mini");
    }
  } finally {
    setKeyringStoreForTests(undefined);
  }
});

test("setup validation helpers catch missing fields", () => {
  assert.ok(validateModelName(""));
  assert.ok(validateBedrockCredentials({ awsRegion: "us-east-1" }));
  assert.ok(validateAzureSetup({ azureResourceName: "my-resource", apiKey: "k", modelName: "" }));
  assert.equal(
    validateCustomSetup({ apiBase: "https://example.com/v1", apiKey: "k", modelName: "m" }),
    undefined,
  );
});

test("buildProviderSetupResult materializes the preset entry", () => {
  const setup = buildProviderSetupResult({
    provider: "openai",
    modelName: "gpt-4o-mini",
  });
  assert.equal(setup.materialize.presetId, "openai");
  assert.deepEqual(setup.activeModel, { providerId: "openai", name: "gpt-4o-mini" });
  assert.equal(setup.models?.[0]?.name, "gpt-4o-mini");
});
