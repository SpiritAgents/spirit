import assert from "node:assert/strict";
import { test } from "vitest";
import type {
  SpiritExtensionContext,
  SpiritDesktopActionContext,
  SpiritDesktopViewSession,
} from "@spiritagent/extension-toolkit/desktop-ui";
import {
  createGitHubExtension,
  GITHUB_CREDENTIAL_SLOT,
  type GitHubAuthorizationState,
} from "./extension.js";

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
  const states: GitHubAuthorizationState[] = [];
  const links: unknown[] = [];
  const settings: Record<string, string | number | boolean | null> = {};
  const context: SpiritExtensionContext = {
    extension: {
      id: "built-in/github",
      name: "GitHub",
      version: "1.0.0",
      directoryPath: "/extension",
      manifestPath: "/extension/.spirit/extension.json",
      main: "index.mjs",
    },
    signal: controller.signal,
    log() {},
    host: {
      ui: {
        async open(_id, params) {
          states.push(params as GitHubAuthorizationState);
          const view = {
            requestId: "view",
            result: result.promise,
            update(params: unknown) {
              states.push(params as GitHubAuthorizationState);
            },
            close: result.resolve,
          };
          opened.resolve(view);
          return view;
        },
      },
      async openExternal(url) {
        links.push(url);
      },
      tabs: {
        async open(input) {
          links.push(input);
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
      async get(key) {
        return settings[key];
      },
      async getAll() {
        return settings;
      },
      async set(key, value) {
        settings[key] = value;
      },
      async setAll(values) {
        Object.assign(settings, values);
        return settings;
      },
    },
  };
  return {
    context,
    secrets,
    states,
    opened,
    result,
    links,
    controller,
    action: { ...context, actionId: "authorize" } satisfies SpiritDesktopActionContext,
  };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const storedOAuthCredentials = () => ({
  accessToken: "stored-private-token",
  refreshToken: "stored-private-refresh-token",
  accessTokenExpiresAt: Date.now() + 28_800_000,
  refreshTokenExpiresAt: Date.now() + 15_552_000_000,
  login: "fixture-account",
});
function successfulFetch(input: RequestInfo | URL) {
  const url = String(input);
  if (url.endsWith("/device/code"))
    return Promise.resolve(
      json({
        device_code: "private-device-code",
        user_code: "TEST-CODE",
        verification_uri: "https://github.com/login/device",
        interval: 1,
        expires_in: 600,
      }),
    );
  if (url.endsWith("/access_token"))
    return Promise.resolve(
      json({
        access_token: "private-access-token",
        refresh_token: "private-refresh-token",
        token_type: "bearer",
        scope: "repo",
        expires_in: 28_800,
        refresh_token_expires_in: 15_552_000,
      }),
    );
  if (url.endsWith("/user")) return Promise.resolve(json({ login: "fixture-account" }));
  throw new Error("Unexpected fixture request");
}

test("authorization commits one Secret and never exposes private credentials to a page", async () => {
  const f = fixture();
  const now = 1_800_000_000_000;
  const extension = createGitHubExtension(f.context, {
    clientId: "fixture-client",
    fetch: successfulFetch,
    now: () => now,
  });
  const first = extension.actions.authorize(f.action);
  assert.equal(extension.actions.authorize(f.action), first);
  assert.deepEqual(await first, { connected: true });
  assert.deepEqual(JSON.parse(f.secrets.get(GITHUB_CREDENTIAL_SLOT)!), {
    accessToken: "private-access-token",
    refreshToken: "private-refresh-token",
    accessTokenExpiresAt: now + 28_800_000,
    refreshTokenExpiresAt: now + 15_552_000_000,
    login: "fixture-account",
  });
  assert.deepEqual(
    f.states.map((state) => state.phase),
    ["loading", "challenge"],
  );
  assert.doesNotMatch(
    JSON.stringify(f.states),
    /private-device-code|private-access-token|private-refresh-token/,
  );
  assert.deepEqual(f.links, ["https://github.com/login/device"]);
});

test("missing OAuth App is an explicit non-network state", async () => {
  const f = fixture();
  const extension = createGitHubExtension(f.context, {
    clientId: "",
    fetch: async () => {
      assert.fail("OAuth must not reach the network without an app");
    },
  });
  const action = extension.actions.authorize(f.action);
  const view = await f.opened.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.states.at(-1)?.phase, "error");
  assert.equal((f.states.at(-1) as { unavailable?: boolean }).unavailable, true);
  view.close({ dismissed: true });
  await action;
  assert.equal(f.secrets.size, 0);
});

test("disposing during account lookup prevents late Secret writes even if transport ignores abort", async () => {
  const f = fixture();
  const lookup = deferred<void>();
  const release = deferred<Response>();
  const extension = createGitHubExtension(f.context, {
    clientId: "fixture-client",
    fetch: async (input) => {
      if (String(input).endsWith("/user")) {
        lookup.resolve();
        return release.promise;
      }
      return successfulFetch(input);
    },
  });
  const action = extension.actions.authorize(f.action);
  await lookup.promise;
  extension.dispose();
  release.resolve(json({ login: "too-late" }));
  await action;
  assert.equal(f.secrets.size, 0);
});

test("disconnect clears the declared Secret and only exposes the account label", async () => {
  const f = fixture();
  f.secrets.set(GITHUB_CREDENTIAL_SLOT, JSON.stringify(storedOAuthCredentials()));
  const extension = createGitHubExtension(f.context);
  const action = extension.actions.authorize(f.action);
  const view = await f.opened.promise;
  assert.deepEqual(f.states, [{ phase: "connected", login: "fixture-account" }]);
  view.close({ disconnect: true });
  await action;
  assert.equal(f.secrets.size, 0);
});

test("PR link parsing remains in the extension and passes navigation to the host", async () => {
  const f = fixture();
  const extension = createGitHubExtension(f.context);
  const input = {
    ...f.action,
    url: "https://github.com/example/project/pull/42",
    sourceTabId: "source",
  };
  assert.equal(await extension.onOpenLink(input), true);
  assert.deepEqual(f.links, [
    {
      contributionId: "pull-requests",
      reuse: "context",
      initialParams: { owner: "example", repo: "project", number: 42 },
      preferInstanceId: "source",
    },
  ]);
  assert.equal(
    await extension.onOpenLink({ ...input, url: "https://github.com/example/project/issues/42" }),
    false,
  );
});

test("401 clears authorization while 403 preserves it", async () => {
  for (const status of [401, 403]) {
    const f = fixture();
    f.secrets.set(GITHUB_CREDENTIAL_SLOT, JSON.stringify(storedOAuthCredentials()));
    const extension = createGitHubExtension(f.context, {
      fetch: async () => json({ message: "fixture denied" }, status),
    });
    await assert.rejects(
      extension.onTabRequest({
        ...f.context,
        contributionId: "pull-requests",
        instanceId: "tab",
        method: "listGitHubPullRequests",
        params: { owner: "example", repo: "project", state: "open" },
        context: { workspaceRoot: "/workspace", sessionKey: "session", branch: "main" },
      }),
    );
    assert.equal(f.secrets.has(GITHUB_CREDENTIAL_SLOT), status !== 401);
  }
});

test("an API 401 refreshes the stored credential and replays the original RPC", async () => {
  const f = fixture();
  f.secrets.set(GITHUB_CREDENTIAL_SLOT, JSON.stringify(storedOAuthCredentials()));
  let refreshRequests = 0;
  let pullRequests = 0;
  const extension = createGitHubExtension(f.context, {
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/access_token")) {
        refreshRequests += 1;
        return json({
          access_token: "rotated-private-access-token",
          refresh_token: "rotated-private-refresh-token",
          token_type: "bearer",
          expires_in: 28_800,
          refresh_token_expires_in: 15_552_000,
        });
      }
      if (url.includes("/pulls")) {
        pullRequests += 1;
        const authorization = new Headers(init?.headers).get("Authorization");
        if (authorization === "Bearer stored-private-token") {
          return json({ message: "Bad credentials" }, 401);
        }
        assert.equal(authorization, "Bearer rotated-private-access-token");
        return json([]);
      }
      throw new Error("Unexpected fixture request");
    },
  });
  const result = (await extension.onTabRequest({
    ...f.context,
    contributionId: "pull-requests",
    instanceId: "tab",
    method: "listGitHubPullRequests",
    params: { owner: "example", repo: "project", state: "open" },
    context: { workspaceRoot: "/workspace", sessionKey: "session", branch: "main" },
  })) as { items: unknown[] };
  assert.deepEqual(result.items, []);
  assert.equal(refreshRequests, 1);
  assert.equal(pullRequests, 2);
  const stored = JSON.parse(f.secrets.get(GITHUB_CREDENTIAL_SLOT)!);
  assert.equal(stored.accessToken, "rotated-private-access-token");
  assert.equal(stored.refreshToken, "rotated-private-refresh-token");
  assert.equal(stored.login, "fixture-account");
  assert.doesNotMatch(JSON.stringify(f.states), /rotated-private/);
});

test("an expired refresh credential starts a new Device Flow instead of blocking authorization", async () => {
  const f = fixture();
  f.secrets.set(
    GITHUB_CREDENTIAL_SLOT,
    JSON.stringify({
      ...storedOAuthCredentials(),
      accessTokenExpiresAt: Date.now(),
      refreshTokenExpiresAt: Date.now(),
    }),
  );
  const extension = createGitHubExtension(f.context, {
    clientId: "fixture-client",
    fetch: successfulFetch,
  });
  assert.deepEqual(await extension.actions.authorize(f.action), { connected: true });
  assert.deepEqual(
    f.states.map((state) => state.phase),
    ["loading", "challenge"],
  );
  assert.equal(f.secrets.has(GITHUB_CREDENTIAL_SLOT), true);
});

test("corrupt credentials still open management so the user can explicitly disconnect", async () => {
  for (const raw of [
    "malformed-private-value",
    JSON.stringify({ accessToken: 123, login: "fixture-account" }),
  ]) {
    const f = fixture();
    f.secrets.set(GITHUB_CREDENTIAL_SLOT, raw);
    const extension = createGitHubExtension(f.context, {
      fetch: async () => assert.fail("corrupt credentials must not start OAuth or API requests"),
    });
    const action = extension.actions.authorize(f.action);
    const outcome = await Promise.race([
      f.opened.promise.then((view) => ({ view })),
      action.then(
        () => ({ completed: true }),
        (error: unknown) => ({ error }),
      ),
    ]);
    assert.ok("view" in outcome, "corrupt credentials prevented the management view from opening");
    assert.equal(f.states[0]?.phase, "error");
    assert.equal((f.states[0] as { canDisconnect?: boolean }).canDisconnect, true);
    assert.doesNotMatch(JSON.stringify(f.states), /malformed-private-value|accessToken/);
    outcome.view.close({ disconnect: true });
    assert.deepEqual(await action, { connected: false });
    assert.equal(f.secrets.size, 0);
  }
});

test("Secret storage access failures are not treated as corrupt credentials", async () => {
  const f = fixture();
  f.context.secrets.get = async () => {
    throw new Error("Secret storage unavailable");
  };
  const extension = createGitHubExtension(f.context);
  await assert.rejects(extension.actions.authorize(f.action), /Secret storage unavailable/);
  assert.deepEqual(f.states, []);
});
