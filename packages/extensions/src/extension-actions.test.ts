import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { createHostExtensionManager, installPreparedExtensionDirectory } from "./index.js";
import type { ExtensionStateStore } from "./storage.js";

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
      displayName: "Action Demo",
      description: "Action Demo extension.",
      manifest: {
        supportedHosts: ["desktop"],
        requestedCapabilities: ["secret-storage"],
        secretSlots,
        contributes: {
          authorizations: [{ id: "oauth", action: "authorize", secretSlots: authorizationSlots }],
        },
      },
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
