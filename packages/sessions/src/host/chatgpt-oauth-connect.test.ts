import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";

import type { DesktopSnapshot } from "@spiritagent/api/types";
import {
  readStoredChatGptOAuthCredentials,
  setKeyringStoreForTests,
  type KeyringStore,
} from "@spiritagent/config";
import { ChatGptOAuthConnectManager } from "./chatgpt-oauth-connect.js";
import { disconnectProviderCommand, type HostModelCommandContext } from "./host-model-commands.js";
import { forceRefreshModelCatalogForProvider } from "./model-catalog-startup-refresh.js";
import { loadConfig, runWithSpiritDataDir } from "./storage.js";

function createMemoryKeyring(): KeyringStore {
  const data = new Map<string, string>();
  return {
    getPassword: (service, account) => data.get(`${service}::${account}`),
    setPassword: (service, account, password) => {
      data.set(`${service}::${account}`, password);
    },
    deletePassword: (service, account) => {
      data.delete(`${service}::${account}`);
    },
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  setKeyringStoreForTests(undefined);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

test("ChatGptOAuthConnectManager completes dynamic registration, fetches SIWC models, and disconnect clears Keychain", async () => {
  setKeyringStoreForTests(createMemoryKeyring());
  const dataDir = mkdtempSync(join(tmpdir(), "spirit-chatgpt-connect-"));
  tempDirs.push(dataDir);

  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = {
    ...(publicKey.export({ format: "jwk" }) as object),
    kid: "mock-kid",
    use: "sig",
  };

  let lastAuthNonce = "";
  const mockServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/accounts/oauth/token") {
      const header = Buffer.from(
        JSON.stringify({ alg: "RS256", typ: "JWT", kid: "mock-kid" }),
      ).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({
          iss: `http://127.0.0.1:${(mockServer.address() as AddressInfo).port}`,
          aud: "oaiapp_issued_777",
          sub: "user_99",
          email: "dev@example.test",
          nonce: lastAuthNonce,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url");
      const signingInput = `${header}.${payload}`;
      const sig = cryptoSign("sha256", Buffer.from(signingInput, "utf8"), privateKey).toString(
        "base64url",
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "access_mock_1",
          refresh_token: "refresh_mock_1",
          id_token: `${signingInput}.${sig}`,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid profile email offline_access chatgpt.tokens.use.direct resource.invoke",
        }),
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      assert.equal(req.headers.authorization, "Bearer access_mock_1");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          models: [
            { slug: "gpt-5.4", display_name: "GPT-5.4", visibility: "list" },
            { slug: "hidden-beta", display_name: "Hidden", visibility: "hide" },
            { slug: "gpt-5.4-mini", display_name: "GPT-5.4 Mini", visibility: "list" },
          ],
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const { port } = mockServer.address() as AddressInfo;
  const mockOrigin = `http://127.0.0.1:${port}`;

  try {
    await runWithSpiritDataDir(dataDir, async () => {
      const config = await loadConfig();
      const state = {
        workspaceRoot: dataDir,
        workspaceBinding: "project" as const,
        config,
        metadata: {} as never,
      };
      const ctx: HostModelCommandContext = {
        runSerialized: (work) => work(),
        ensureInitialized: async () => {},
        requireState: () => state,
        activeBundle: () => ({
          deferredRuntimeRefreshWhileBusy: false,
          activeModel: state.config.activeModel,
        }),
        isRuntimeBusy: () => false,
        refreshRuntime: async () => {},
        refreshActiveModelTransportConfig: async () => {},
        refreshModelKeyPresence: async () => {},
        flushDeferredRuntimeRefreshIfIdle: async () => {},
        persistCurrentSessionIfNeeded: async () => {},
        clearActiveContextUsage: () => {},
        setLastRuntimeError: () => {},
        buildSnapshot: () => ({}) as DesktopSnapshot,
        disposeAllLspServices: async () => {},
        invalidateToolExecutors: () => {},
        applyWebToolExposureToRuntimes: async () => {},
        refreshLspSnapshot: async () => {},
      };

      const manager = new ChatGptOAuthConnectManager();
      let openedUrl = "";
      const begun = await manager.begin(
        {},
        {
          openExternal: async (url) => {
            openedUrl = url;
          },
          endpoints: {
            issuer: mockOrigin,
            authorizationUrl: `${mockOrigin}/api/accounts/authorize`,
            tokenUrl: `${mockOrigin}/api/accounts/oauth/token`,
            jwksUrl: `${mockOrigin}/.well-known/jwks.json`,
            resource: `${mockOrigin}/v1`,
          },
        },
      );

      assert.equal(openedUrl, begun.authorizationUrl);
      const authUrl = new URL(begun.authorizationUrl);
      assert.equal(authUrl.searchParams.get("client_id"), "dynamic_agent_client");
      assert.equal(authUrl.searchParams.get("agent_name_hint"), "Spirit");
      lastAuthNonce = authUrl.searchParams.get("nonce") ?? "";
      const redirectUri = authUrl.searchParams.get("redirect_uri") ?? "";
      const stateParam = authUrl.searchParams.get("state") ?? "";

      const completionPromise = manager.complete(begun.sessionId, ctx, {
        apiBaseOverride: `${mockOrigin}/v1`,
      });
      const callbackRes = await fetch(
        `${redirectUri}?code=code_ok&state=${encodeURIComponent(stateParam)}&client_id=oaiapp_issued_777`,
      );
      assert.equal(callbackRes.status, 200);

      const completed = await completionPromise;
      assert.equal(completed.phase, "connected");
      if (completed.phase === "connected") {
        assert.equal(completed.email, "dev@example.test");
        assert.equal(completed.modelCount, 2);
      }

      const persisted = await loadConfig();
      const chatgptProvider = persisted.providers.find((entry) => entry.id === "chatgpt");
      assert.ok(chatgptProvider);
      assert.equal(chatgptProvider.options?.auth, "chatgpt-oauth");
      assert.equal(chatgptProvider.options?.statelessStreamingResponses, true);
      assert.deepEqual(
        chatgptProvider.models.map((m) => m.name),
        ["gpt-5.4", "gpt-5.4-mini"],
      );
      assert.equal(readStoredChatGptOAuthCredentials("chatgpt")?.clientId, "oaiapp_issued_777");

      // Startup/background catalog refresh uses the OAuth credential manager (not static apiKey).
      const refreshedCatalog = await forceRefreshModelCatalogForProvider(chatgptProvider);
      assert.deepEqual(refreshedCatalog?.modelIds, ["gpt-5.4", "gpt-5.4-mini"]);

      // Reconnecting with the exact same models succeeds without error and preserves models.
      const begunReconnect = await manager.begin(
        {},
        {
          endpoints: {
            issuer: mockOrigin,
            authorizationUrl: `${mockOrigin}/api/accounts/authorize`,
            tokenUrl: `${mockOrigin}/api/accounts/oauth/token`,
            jwksUrl: `${mockOrigin}/.well-known/jwks.json`,
            resource: `${mockOrigin}/v1`,
          },
        },
      );
      const reconnectAuthUrl = new URL(begunReconnect.authorizationUrl);
      assert.equal(reconnectAuthUrl.searchParams.get("client_id"), "oaiapp_issued_777");
      lastAuthNonce = reconnectAuthUrl.searchParams.get("nonce") ?? "";
      const reconnectCompletion = manager.complete(begunReconnect.sessionId, ctx, {
        apiBaseOverride: `${mockOrigin}/v1`,
      });
      await fetch(
        `${reconnectAuthUrl.searchParams.get("redirect_uri")}?code=code_reauth&state=${encodeURIComponent(reconnectAuthUrl.searchParams.get("state") ?? "")}`,
      );
      const reconnected = await reconnectCompletion;
      assert.equal(reconnected.phase, "connected");

      // Real model-save failures surface as error instead of hiding behind an empty-models fallback.
      const busyCtx: HostModelCommandContext = { ...ctx, isRuntimeBusy: () => true };
      const begunBusy = await manager.begin(
        {},
        {
          endpoints: {
            issuer: mockOrigin,
            authorizationUrl: `${mockOrigin}/api/accounts/authorize`,
            tokenUrl: `${mockOrigin}/api/accounts/oauth/token`,
            jwksUrl: `${mockOrigin}/.well-known/jwks.json`,
            resource: `${mockOrigin}/v1`,
          },
        },
      );
      const busyAuthUrl = new URL(begunBusy.authorizationUrl);
      lastAuthNonce = busyAuthUrl.searchParams.get("nonce") ?? "";
      const busyCompletion = manager.complete(begunBusy.sessionId, busyCtx, {
        apiBaseOverride: `${mockOrigin}/v1`,
      });
      await fetch(
        `${busyAuthUrl.searchParams.get("redirect_uri")}?code=code_busy&state=${encodeURIComponent(busyAuthUrl.searchParams.get("state") ?? "")}`,
      );
      const busyResult = await busyCompletion;
      assert.equal(busyResult.phase, "error");

      // Starting a second begin() for the same provider cancels the previous pending session.
      const firstSuperseded = await manager.begin(
        {},
        {
          endpoints: {
            issuer: mockOrigin,
            authorizationUrl: `${mockOrigin}/api/accounts/authorize`,
            tokenUrl: `${mockOrigin}/api/accounts/oauth/token`,
            jwksUrl: `${mockOrigin}/.well-known/jwks.json`,
            resource: `${mockOrigin}/v1`,
          },
        },
      );
      const firstSupersededCompletion = manager.complete(firstSuperseded.sessionId, ctx, {
        apiBaseOverride: `${mockOrigin}/v1`,
      });
      const secondSuperseding = await manager.begin(
        {},
        {
          endpoints: {
            issuer: mockOrigin,
            authorizationUrl: `${mockOrigin}/api/accounts/authorize`,
            tokenUrl: `${mockOrigin}/api/accounts/oauth/token`,
            jwksUrl: `${mockOrigin}/.well-known/jwks.json`,
            resource: `${mockOrigin}/v1`,
          },
        },
      );
      const supersededOutcome = await firstSupersededCompletion;
      assert.equal(supersededOutcome.phase, "error");
      if (supersededOutcome.phase === "error") {
        assert.equal(supersededOutcome.code, "cancelled");
      }
      manager.cancel(secondSuperseding.sessionId);

      // Disconnecting removes both config entry and Keychain OAuth credentials.
      await disconnectProviderCommand(ctx, { providerId: "chatgpt" });
      assert.equal(readStoredChatGptOAuthCredentials("chatgpt"), undefined);
      const afterDisconnect = await loadConfig();
      assert.equal(
        afterDisconnect.providers.find((entry) => entry.id === "chatgpt"),
        undefined,
      );
    });
  } finally {
    mockServer.close();
  }
});
