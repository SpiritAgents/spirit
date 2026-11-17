import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { createHostExtensionManager, installPreparedExtensionDirectory } from "./index.js";
import type { ExtensionStateStore } from "./storage.js";
import { localizedTestPackage } from "@spiritagent/extension-toolkit/test-localization";

async function writeActionPackage(
  packageDir: string,
  options?: { secretSlots?: string[]; authorizationSlots?: string[] },
): Promise<void> {
  const secretSlots = options?.secretSlots ?? ["oauthAccessToken"];
  const authorizationSlots = options?.authorizationSlots ?? secretSlots;
  await mkdir(join(packageDir, ".spirit"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify({ name: "action-demo", version: "1.0.0", main: "index.js" }, null, 2)}\n`,
  );
  await writeFile(
    join(packageDir, ".spirit", "extension.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      name: "action-demo",
      version: "1.0.0",
      sourceId: "personal",
      ...localizedTestPackage("Action Demo", "Action Demo extension.", {
        supportedHosts: ["desktop"],
        requestedCapabilities: ["secret-storage"],
        secretSlots,
        contributes: {
          authorizations: [{ id: "oauth", action: "authorize", secretSlots: authorizationSlots }],
        },
      }),
    })}\n`,
  );
  await writeFile(
    join(packageDir, "index.js"),
    `export function activate() {
      return {
        actions: {
          async authorize(context) {
            await context.secrets.set("oauthAccessToken", "private-token");
            return {
              actionId: context.actionId,
              params: context.params,
              extensionId: context.host.boundExtensionId,
            };
          },
        },
      };
    }\n`,
  );
}

test("declared actions receive scoped host, params, settings, and secrets", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-action-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-action-package-"));
  const values = new Map<string, string>();
  try {
    const packageDir = join(preparedRoot, "action-demo");
    await writeActionPackage(packageDir);
    const installed = await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      { preparedDirectoryPath: packageDir },
    );
    const stateStore: ExtensionStateStore = {
      async loadSettings() {
        return {};
      },
      async saveSettings() {},
      async saveSecret(_extensionId, key, value) {
        values.set(key, value);
      },
      async loadSecret(_extensionId, key) {
        return values.get(key);
      },
      async deleteSecret(_extensionId, key) {
        values.delete(key);
      },
    };
    const manager = createHostExtensionManager({
      spiritDataDir,
      hostKind: "desktop",
      stateStore,
    });
    const host = {
      boundExtensionId: installed.id,
      forExtension(extensionId: string) {
        return { ...this, boundExtensionId: extensionId };
      },
    };
    const result = await manager.invokeAction({
      extensionId: installed.id,
      actionId: "authorize",
      params: { authorizationId: "oauth" },
      host,
    });
    assert.deepEqual(result, {
      actionId: "authorize",
      params: { authorizationId: "oauth" },
      extensionId: installed.id,
    });
    assert.equal(values.get("oauthAccessToken"), "private-token");

    await assert.rejects(
      () => manager.invokeAction({ extensionId: installed.id, actionId: "missing", host }),
      /does not declare the action/,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(preparedRoot, { recursive: true, force: true });
  }
});

test("authorization declarations must reference declared secret slots", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-action-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-action-package-"));
  try {
    const packageDir = join(preparedRoot, "action-demo");
    await writeActionPackage(packageDir, {
      secretSlots: ["oauthAccessToken"],
      authorizationSlots: ["missing"],
    });
    await assert.rejects(
      () =>
        installPreparedExtensionDirectory(
          { spiritDataDir, hostKind: "desktop" },
          { preparedDirectoryPath: packageDir },
        ),
      /references an undeclared secret slot: missing/,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(preparedRoot, { recursive: true, force: true });
  }
});

test("authorization configuration reports only secret presence", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-action-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-action-package-"));
  const values = new Map<string, string>();
  try {
    const packageDir = join(preparedRoot, "action-demo");
    await writeActionPackage(packageDir);
    const installed = await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      { preparedDirectoryPath: packageDir },
    );
    const stateStore: ExtensionStateStore = {
      async loadSettings() {
        return {};
      },
      async saveSettings() {},
      async loadSecret(_extensionId, key) {
        return values.get(key);
      },
      async saveSecret(_extensionId, key, value) {
        values.set(key, value);
      },
    };
    const manager = createHostExtensionManager({ spiritDataDir, hostKind: "desktop", stateStore });
    assert.deepEqual(await manager.getAuthorizationConfigurations(installed.id), { oauth: false });
    values.set("oauthAccessToken", "not-returned-by-the-api");
    assert.deepEqual(await manager.getAuthorizationConfigurations(installed.id), { oauth: true });
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(preparedRoot, { recursive: true, force: true });
  }
});

test("disabling an extension cancels its action and rejects late secret writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "spirit-action-lifetime-"));
  const values = new Map<string, string>();
  const packageDir = join(root, "package");
  let started!: () => void;
  let release!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await writeActionPackage(packageDir);
    await writeFile(
      join(packageDir, "index.js"),
      `export function activate() { return { actions: { async authorize(context) {
      context.host.started(); await context.host.gate;
      await context.secrets.set("oauthAccessToken", "must-not-be-written");
    } } }; }`,
    );
    const manager = createHostExtensionManager({
      spiritDataDir: join(root, "data"),
      hostKind: "desktop",
      stateStore: {
        async loadSettings() {
          return {};
        },
        async saveSettings() {},
        async saveSecret(_id, key, value) {
          values.set(key, value);
        },
      },
    });
    const extension = await manager.installPreparedDirectory({ preparedDirectoryPath: packageDir });
    const action = manager.invokeAction({
      extensionId: extension.id,
      actionId: "authorize",
      host: { started, gate },
    });
    await began;
    await manager.setEnabled(extension.id, false);
    release();
    await assert.rejects(action, /abort/i);
    assert.equal(values.size, 0);
  } finally {
    release?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent callers share activation and removal cancels activation in flight", async () => {
  const root = await mkdtemp(join(tmpdir(), "spirit-activation-lifetime-"));
  const packageDir = join(root, "package");
  let starts = 0;
  let started!: () => void;
  let release!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await writeActionPackage(packageDir);
    await writeFile(
      join(packageDir, "index.js"),
      `export async function activate(context) {
      context.host.started(); await context.host.gate;
      await context.secrets.set("oauthAccessToken", "must-not-be-written");
      return { actions: { authorize() { return true; } } };
    }`,
    );
    const manager = createHostExtensionManager({
      spiritDataDir: join(root, "data"),
      hostKind: "desktop",
      stateStore: {
        async loadSettings() {
          return {};
        },
        async saveSettings() {},
        async saveSecret() {
          assert.fail("late secret write");
        },
      },
    });
    const extension = await manager.installPreparedDirectory({ preparedDirectoryPath: packageDir });
    const request = {
      extensionId: extension.id,
      actionId: "authorize",
      host: {
        started() {
          starts++;
          started();
        },
        gate,
      },
    };
    const results = Promise.allSettled([
      manager.invokeAction(request),
      manager.invokeAction(request),
    ]);
    await began;
    await manager.setEnabled(extension.id, false);
    release();
    assert.ok((await results).every((result) => result.status === "rejected"));
    assert.equal(starts, 1);
  } finally {
    release?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("page and link handlers receive scoped backend services and declared origins", async () => {
  const root = await mkdtemp(join(tmpdir(), "spirit-page-context-"));
  try {
    const packageDir = join(root, "package");
    await writeActionPackage(packageDir);
    const dumpPath = join(packageDir, ".spirit", "extension.json");
    const dump = JSON.parse(await readFile(dumpPath, "utf8"));
    dump.manifest.requestedCapabilities.push("desktop-ui");
    dump.manifest.contributes.desktop = {
      tabs: [
        {
          id: "notes",
          name: { message: "desktop.tabs.notes.name" },
          path: "page.html",
          icon: { type: "spirit", name: "globe" },
          authorization: "oauth",
        },
      ],
      views: [{ id: "authorize", path: "page.html" }],
      linkHandlers: [{ id: "notes", tab: "notes", origins: ["https://example.test"] }],
    };
    await writeFile(dumpPath, JSON.stringify(dump));
    await writeFile(join(packageDir, "page.html"), "<!doctype html><html></html>");
    await writeFile(
      join(packageDir, "index.js"),
      `export function activate() {
      const handler = async (request) => ({ context: request.context, hasSecret: await request.secrets.has("oauthAccessToken"), hasSettings: typeof request.settings.get === "function", host: request.host.boundExtensionId });
      return { onTabRequest: handler, onViewRequest: handler, onOpenLink(request) { request.host.opened(request.url); return true; } };
    }`,
    );
    const manager = createHostExtensionManager({
      spiritDataDir: join(root, "data"),
      hostKind: "desktop",
    });
    const extension = await manager.installPreparedDirectory({ preparedDirectoryPath: packageDir });
    const opened: string[] = [];
    const host = {
      forExtension(id: string) {
        return { boundExtensionId: id, opened: (url: string) => opened.push(url) };
      },
    };
    const context = { workspaceRoot: "/workspace", sessionKey: "session", branch: "feature" };
    const request = {
      extensionId: extension.id,
      instanceId: "instance",
      method: "read",
      context,
      host,
    };
    for (const [kind, id] of [
      ["tab", "notes"],
      ["view", "authorize"],
    ] as const) {
      const result =
        kind === "tab"
          ? await manager.invokeTabRequest({ ...request, contributionId: id })
          : await manager.invokeViewRequest({ ...request, contributionId: id });
      assert.deepEqual(result, {
        context,
        hasSecret: false,
        hasSettings: true,
        host: extension.id,
      });
    }
    assert.equal(
      await manager.openLink({
        extensionId: extension.id,
        actionId: "notes",
        url: "https://other.test/item",
        host,
      }),
      false,
    );
    assert.equal(
      await manager.openLink({
        extensionId: extension.id,
        actionId: "notes",
        url: "https://example.test/item",
        host,
      }),
      true,
    );
    assert.deepEqual(opened, ["https://example.test/item"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
