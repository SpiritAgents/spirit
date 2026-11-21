import assert from "node:assert/strict";
import { test } from "vitest";
import type {
  SpiritDesktopActionContext,
  SpiritDesktopViewSession,
  SpiritExtensionContext,
} from "@spiritagent/extension-toolkit/desktop-ui";

import {
  createLinearExtension,
  LINEAR_CREDENTIAL_SLOT,
  type LinearAuthorizationState,
} from "./extension.js";
import { LINEAR_OAUTH_ISSUER } from "./oauth-config.js";

const NOW = 1_800_000_000_000;
const encodedIssuer = encodeURIComponent(LINEAR_OAUTH_ISSUER);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const secrets = new Map<string, string>();
  const controller = new AbortController();
  const opened = deferred<SpiritDesktopViewSession>();
  const result = deferred<unknown>();
  const states: LinearAuthorizationState[] = [];
  const logs: string[] = [];
  const context: SpiritExtensionContext = {
    extension: {
      id: "built-in/linear",
      name: "Linear",
      version: "1.0.0",
      directoryPath: "/extension",
      manifestPath: "/extension/.spirit/extension.json",
      main: "index.mjs",
    },
    signal: controller.signal,
    log(message) {
      logs.push(message);
    },
    host: {
      ui: {
        async open(_id, params) {
          states.push(params as LinearAuthorizationState);
          const view = {
            requestId: "view",
            result: result.promise,
            update(params: unknown) {
              states.push(params as LinearAuthorizationState);
            },
            close: result.resolve,
          };
          opened.resolve(view);
          return view;
        },
      },
      async openExternal() {
        assert.fail("tests inject openExternal");
      },
      tabs: {
        async open() {
          return {} as never;
        },
        async focus() {},
        async close() {},
        async update() {},
        emit() {},
      },
      automationTriggers: { async update() {} },
    },
    secrets: {
      async get(key) {
        return secrets.get(key);
      },
      async has(key) {
        return secrets.has(key);
      },
      async set(key, value) {
        secrets.set(key, value);
      },
      async update(key, updater) {
        const next = await updater(secrets.get(key));
        if (next === undefined) secrets.delete(key);
        else secrets.set(key, next);
        return next;
      },
      async delete(key) {
        secrets.delete(key);
      },
    },
    settings: {
      async get() {
        return undefined;
      },
      async getAll() {
        return {};
      },
      async set() {},
      async setAll() {
        return {};
      },
    },
  };
  return {
    context,
    secrets,
    states,
    logs,
    opened,
    result,
    controller,
    action: { ...context, actionId: "authorize" } satisfies SpiritDesktopActionContext,
  };
}

async function until(check: () => boolean) {
  for (let attempt = 0; !check(); attempt++) {
    assert.ok(attempt < 400, "condition was not reached");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Plays the browser: follows the authorization URL back to the loopback redirect. */
function browserReturning(query: (state: string) => string) {
  const responses: Promise<Response>[] = [];
  return {
    responses,
    async openExternal(url: string) {
      const authorization = new URL(url);
      const redirect = authorization.searchParams.get("redirect_uri")!;
      const state = authorization.searchParams.get("state")!;
      responses.push(fetch(`${redirect}?${query(state)}`));
    },
  };
}

test("authorization stores one Secret from the loopback code and never shows credentials to the page", async () => {
  const f = fixture();
  const tokenRequests: URLSearchParams[] = [];
  const browser = browserReturning(
    (state) => `state=${state}&iss=${encodedIssuer}&code=private-code`,
  );
  const extension = createLinearExtension(f.context, {
    now: () => NOW,
    openExternal: browser.openExternal,
    fetch: async (input, init) => {
      assert.equal(String(input), "https://mcp.linear.app/token");
      tokenRequests.push(init?.body as URLSearchParams);
      return json({
        access_token: "private-access-token",
        refresh_token: "private-refresh-token",
        expires_in: 3600,
      });
    },
  });
  const first = extension.actions.authorize(f.action);
  assert.equal(extension.actions.authorize(f.action), first);
  assert.deepEqual(await first, { connected: true });
  assert.equal((await browser.responses[0]).status, 200);

  assert.deepEqual(JSON.parse(f.secrets.get(LINEAR_CREDENTIAL_SLOT)!), {
    accessToken: "private-access-token",
    refreshToken: "private-refresh-token",
    accessTokenExpiresAt: NOW + 3_600_000,
  });
  assert.deepEqual(
    f.states.map((state) => state.phase),
    ["loading", "waiting"],
  );
  const verifier = tokenRequests[0]?.get("code_verifier");
  assert.ok(verifier);
  assert.equal(tokenRequests[0]?.get("code"), "private-code");
  const pageState = JSON.stringify(f.states);
  for (const secret of [
    verifier,
    "private-code",
    "private-access-token",
    "private-refresh-token",
  ]) {
    assert.ok(!pageState.includes(secret));
  }
});

test("a denied browser authorization stays visible and stores nothing", async () => {
  const f = fixture();
  const browser = browserReturning(
    (state) => `state=${state}&iss=${encodedIssuer}&error=access_denied`,
  );
  const extension = createLinearExtension(f.context, {
    openExternal: browser.openExternal,
    fetch: async () => assert.fail("a denied authorization must not request tokens"),
  });
  const action = extension.actions.authorize(f.action);
  await until(() => f.states.at(-1)?.phase === "error");
  assert.equal((await browser.responses[0]).status, 400);
  assert.deepEqual(f.states.at(-1), {
    phase: "error",
    message: "Linear authorization was denied.",
  });
  f.result.resolve({ dismissed: true });
  assert.deepEqual(await action, { connected: false });
  assert.equal(f.secrets.size, 0);
});

test("an authorization callback with a mismatched issuer shows an error and stores nothing", async () => {
  const f = fixture();
  const browser = browserReturning(
    (state) => `state=${state}&iss=${encodeURIComponent("https://example.com")}&code=private-code`,
  );
  const extension = createLinearExtension(f.context, {
    openExternal: browser.openExternal,
    fetch: async () => assert.fail("an issuer mismatch must not request tokens"),
  });
  const action = extension.actions.authorize(f.action);
  await until(() => f.states.at(-1)?.phase === "error");
  assert.equal((await browser.responses[0]).status, 400);
  assert.deepEqual(f.states.at(-1), {
    phase: "error",
    message: "Linear authorization returned an unexpected issuer.",
  });
  f.result.resolve({ dismissed: true });
  assert.deepEqual(await action, { connected: false });
  assert.equal(f.secrets.size, 0);
});

test("cancelling the view releases the loopback listener", async () => {
  const f = fixture();
  let authorizationUrl: string | undefined;
  const extension = createLinearExtension(f.context, {
    openExternal: async (url) => {
      authorizationUrl = url;
    },
    fetch: async () => assert.fail("a cancelled authorization must not request tokens"),
  });
  const action = extension.actions.authorize(f.action);
  await until(() => authorizationUrl !== undefined);
  f.result.resolve({ dismissed: true });
  assert.deepEqual(await action, { connected: false });
  const redirect = new URL(authorizationUrl!).searchParams.get("redirect_uri")!;
  await assert.rejects(fetch(redirect));
  assert.equal(f.secrets.size, 0);
});

test("an abandoned browser authorization times out instead of holding the port", async () => {
  const f = fixture();
  const extension = createLinearExtension(f.context, {
    authorizationTimeoutMs: 50,
    openExternal: async () => {},
    fetch: async () => assert.fail("a timed-out authorization must not request tokens"),
  });
  const action = extension.actions.authorize(f.action);
  await until(() => f.states.at(-1)?.phase === "error");
  assert.deepEqual(f.states.at(-1), {
    phase: "error",
    message: "Linear authorization timed out. Try again.",
  });
  f.result.resolve({ dismissed: true });
  assert.deepEqual(await action, { connected: false });
});

test("disconnect removes the credential first and revokes both tokens", async () => {
  const f = fixture();
  f.secrets.set(
    LINEAR_CREDENTIAL_SLOT,
    JSON.stringify({
      accessToken: "stored-access",
      refreshToken: "stored-refresh",
      accessTokenExpiresAt: Date.now() + 3_600_000,
    }),
  );
  const revoked: Array<[string | null, string | null, boolean]> = [];
  const extension = createLinearExtension(f.context, {
    fetch: async (input, init) => {
      assert.equal(String(input), "https://mcp.linear.app/token");
      const body = init?.body as URLSearchParams;
      revoked.push([body.get("token"), body.get("token_type_hint"), f.secrets.size === 0]);
      return new Response(null, {
        status: body.get("token_type_hint") === "access_token" ? 503 : 200,
      });
    },
  });
  const action = extension.actions.authorize(f.action);
  await f.opened.promise;
  assert.deepEqual(f.states, [{ phase: "connected" }]);
  f.result.resolve({ disconnect: true });
  assert.deepEqual(await action, { connected: false });
  assert.equal(f.secrets.size, 0);
  assert.deepEqual(revoked, [
    ["stored-refresh", "refresh_token", true],
    ["stored-access", "access_token", true],
  ]);
  assert.deepEqual(f.logs, [
    "Linear access_token revocation failed; the local credential was removed.",
  ]);
});

test("corrupt credentials still open management so the user can disconnect", async () => {
  const f = fixture();
  f.secrets.set(LINEAR_CREDENTIAL_SLOT, "not json");
  const extension = createLinearExtension(f.context, {
    fetch: async () => assert.fail("unreadable credentials cannot be revoked"),
  });
  const action = extension.actions.authorize(f.action);
  await f.opened.promise;
  assert.deepEqual(f.states, [
    {
      phase: "error",
      message: "Stored Linear authorization is invalid. Disconnect and authorize again.",
      canDisconnect: true,
    },
  ]);
  f.result.resolve({ disconnect: true });
  assert.deepEqual(await action, { connected: false });
  assert.equal(f.secrets.size, 0);
});
