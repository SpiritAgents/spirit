import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import type { HostExtensionSecretsAccessor } from "./extensions.js";
import { createHostExtensionManager, installPreparedExtensionDirectory } from "./index.js";
import type { ExtensionStateStore } from "./storage.js";
import { localizedTestPackage } from "@spiritagent/extension-toolkit/test-localization";

const SECRETS_GLOBAL = "__spiritExtensionPrivateSecretsTest";

type SecretFixture = {
  spiritDataDir: string;
  preparedRoot: string;
  extensionId: string;
  secrets: Map<string, string>;
};

async function writePackage(
  packageDir: string,
  input: { secretSlots: unknown; main?: string; version?: string },
): Promise<void> {
  await mkdir(join(packageDir, ".spirit"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify({ name: "secret-demo", version: input.version ?? "1.0.0", ...(input.main ? { main: input.main } : {}) }, null, 2)}\n`,
  );
  await writeFile(
    join(packageDir, ".spirit", "extension.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name: "secret-demo",
        version: input.version ?? "1.0.0",
        sourceId: "personal",
        ...localizedTestPackage("Secret Demo", "Secret Demo extension.", {
          supportedHosts: ["desktop"],
          requestedCapabilities: ["secret-storage"],
          secretSlots: input.secretSlots,
        }),
      },
      null,
      2,
    )}\n`,
  );
  if (input.main) {
    await writeFile(
      join(packageDir, input.main),
      `export function activate(context) {
        globalThis.${SECRETS_GLOBAL} = context.secrets;
      }\n`,
    );
  }
}

async function fixture(
  secretSlots: unknown = ["oauthToken", "privateKey"],
): Promise<SecretFixture> {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-secret-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-secret-package-"));
  const packageDir = join(preparedRoot, "secret-demo");
  await writePackage(packageDir, { secretSlots, main: "index.js" });
  const installed = await installPreparedExtensionDirectory(
    { spiritDataDir, hostKind: "desktop" },
    { preparedDirectoryPath: packageDir },
  );
  return { spiritDataDir, preparedRoot, extensionId: installed.id, secrets: new Map() };
}

function stateStore(fixture: SecretFixture): ExtensionStateStore {
  const account = (key: string) => `${fixture.extensionId}::${key}`;
  return {
    async loadSettings() {
      return {};
    },
    async saveSettings() {},
    async loadSecret(_extensionId, key) {
      return fixture.secrets.get(account(key));
    },
    async saveSecret(_extensionId, key, value) {
      fixture.secrets.set(account(key), value);
    },
    async deleteSecret(_extensionId, key) {
      fixture.secrets.delete(account(key));
    },
    async hasSecret(_extensionId, key) {
      return fixture.secrets.has(account(key));
    },
  };
}

async function cleanup(fixture: SecretFixture): Promise<void> {
  await rm(fixture.spiritDataDir, { recursive: true, force: true });
  await rm(fixture.preparedRoot, { recursive: true, force: true });
  delete (globalThis as Record<string, unknown>)[SECRETS_GLOBAL];
}

function accessor(): HostExtensionSecretsAccessor {
  return (globalThis as Record<string, unknown>)[SECRETS_GLOBAL] as HostExtensionSecretsAccessor;
}

test("secret accessors are extension-private and preserve exact non-empty values", async () => {
  const current = await fixture();
  try {
    const manager = createHostExtensionManager({
      spiritDataDir: current.spiritDataDir,
      hostKind: "desktop",
      stateStore: stateStore(current),
    });
    await manager.run({ id: current.extensionId, host: {} });

    const secrets = accessor();
    const value = "  first line\nsecond line\n";
    await secrets.set("privateKey", value);
    assert.equal(await secrets.get("privateKey"), value);
    assert.equal(await secrets.has("privateKey"), true);
    assert.equal(current.secrets.get(`${current.extensionId}::privateKey`), value);

    const updated = await secrets.update("privateKey", (currentValue) =>
      Promise.resolve(`${currentValue}rotated`),
    );
    assert.equal(updated, `${value}rotated`);
    assert.equal(await secrets.get("privateKey"), `${value}rotated`);
    assert.equal(
      await secrets.update("privateKey", (currentValue) => currentValue),
      `${value}rotated`,
    );

    await assert.rejects(() => secrets.set("privateKey", ""), /must not be empty/);
    await assert.rejects(() => secrets.update("privateKey", () => ""), /must not be empty/);
    await assert.rejects(() => secrets.get("unknown"), /does not declare the secret slot/);
    await assert.rejects(() => secrets.set("unknown", "value"), /does not declare the secret slot/);

    await secrets.update("privateKey", () => undefined);
    assert.equal(await secrets.get("privateKey"), undefined);
    assert.equal(await secrets.has("privateKey"), false);
  } finally {
    await cleanup(current);
  }
});

test("an updater result is committed even if the extension is disabled while it runs", async () => {
  const current = await fixture();
  const context = {
    spiritDataDir: current.spiritDataDir,
    hostKind: "desktop" as const,
    stateStore: stateStore(current),
  };
  try {
    const manager = createHostExtensionManager(context);
    await manager.run({ id: current.extensionId, host: {} });
    const secrets = accessor();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const update = secrets.update("privateKey", async () => {
      markStarted();
      await gate;
      return "rotated-secret";
    });
    await started;
    await manager.setEnabled(current.extensionId, false);
    release();
    await assert.rejects(update, /abort/i);
    assert.equal(current.secrets.get(`${current.extensionId}::privateKey`), "rotated-secret");
  } finally {
    await cleanup(current);
  }
});

test("secret slots reject legacy objects, invalid keys, and duplicates", async () => {
  for (const slots of [
    [{ key: "oauthToken", title: "OAuth Token" }],
    ["not valid"],
    ["oauthToken", "oauthToken"],
  ]) {
    const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-secret-data-"));
    const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-secret-package-"));
    try {
      const packageDir = join(preparedRoot, "secret-demo");
      await writePackage(packageDir, { secretSlots: slots });
      await assert.rejects(
        () =>
          installPreparedExtensionDirectory(
            { spiritDataDir, hostKind: "desktop" },
            { preparedDirectoryPath: packageDir },
          ),
        /secret slot|secretSlots/,
      );
    } finally {
      await rm(spiritDataDir, { recursive: true, force: true });
      await rm(preparedRoot, { recursive: true, force: true });
    }
  }
});

test("updates delete only secret slots removed by the new manifest", async () => {
  const current = await fixture(["oauthToken", "privateKey", "retiredToken"]);
  try {
    const context = {
      spiritDataDir: current.spiritDataDir,
      hostKind: "desktop" as const,
      stateStore: stateStore(current),
    };
    const manager = createHostExtensionManager(context);
    await manager.run({ id: current.extensionId, host: {} });
    for (const key of ["oauthToken", "privateKey", "retiredToken"]) {
      await accessor().set(key, `${key}\n`);
    }

    const packageDir = join(current.preparedRoot, "secret-demo-v2");
    await writePackage(packageDir, {
      secretSlots: ["oauthToken", "privateKey"],
      main: "index.js",
      version: "1.1.0",
    });
    await installPreparedExtensionDirectory(context, {
      preparedDirectoryPath: packageDir,
      replaceExisting: true,
    });

    assert.equal(current.secrets.get(`${current.extensionId}::oauthToken`), "oauthToken\n");
    assert.equal(current.secrets.get(`${current.extensionId}::privateKey`), "privateKey\n");
    assert.equal(current.secrets.has(`${current.extensionId}::retiredToken`), false);
  } finally {
    await cleanup(current);
  }
});

test("failed update secret cleanup restores the installed extension and can be retried", async () => {
  const current = await fixture(["oauthToken", "retiredToken"]);
  const context = {
    spiritDataDir: current.spiritDataDir,
    hostKind: "desktop" as const,
    stateStore: stateStore(current),
  };
  try {
    const manager = createHostExtensionManager(context);
    await manager.run({ id: current.extensionId, host: {} });
    await accessor().set("oauthToken", "oauth");
    await accessor().set("retiredToken", "retired");

    const packageDir = join(current.preparedRoot, "secret-demo-v2");
    await writePackage(packageDir, {
      secretSlots: ["oauthToken"],
      main: "index.js",
      version: "1.1.0",
    });
    const manifestPath = join(
      current.spiritDataDir,
      "extensions",
      "desktop",
      "personal",
      "secret-demo",
      ".spirit",
      "extension.json",
    );
    const versionsSeenDuringDelete: string[] = [];
    const failingStore = stateStore(current);
    failingStore.deleteSecret = async () => {
      const dump = JSON.parse(await readFile(manifestPath, "utf8")) as { version: string };
      versionsSeenDuringDelete.push(dump.version);
      throw new Error("keyring unavailable");
    };

    await assert.rejects(
      () =>
        installPreparedExtensionDirectory(
          { ...context, stateStore: failingStore },
          { preparedDirectoryPath: packageDir, replaceExisting: true },
        ),
      /keyring unavailable/,
    );

    assert.deepEqual(versionsSeenDuringDelete, ["1.1.0"]);
    assert.equal(
      (await manager.list()).find((item) => item.id === current.extensionId)?.manifest.version,
      "1.0.0",
    );
    assert.equal(JSON.parse(await readFile(manifestPath, "utf8")).version, "1.0.0");
    assert.equal(current.secrets.get(`${current.extensionId}::retiredToken`), "retired");

    await installPreparedExtensionDirectory(context, {
      preparedDirectoryPath: packageDir,
      replaceExisting: true,
    });
    assert.equal(current.secrets.get(`${current.extensionId}::oauthToken`), "oauth");
    assert.equal(current.secrets.has(`${current.extensionId}::retiredToken`), false);
    assert.equal(JSON.parse(await readFile(manifestPath, "utf8")).version, "1.1.0");
  } finally {
    await cleanup(current);
  }
});

test("uninstall deletes secrets while disable preserves them", async () => {
  const current = await fixture();
  try {
    const manager = createHostExtensionManager({
      spiritDataDir: current.spiritDataDir,
      hostKind: "desktop",
      stateStore: stateStore(current),
    });
    await manager.run({ id: current.extensionId, host: {} });
    await accessor().set("oauthToken", "token");
    await manager.setEnabled(current.extensionId, false);
    assert.equal(current.secrets.has(`${current.extensionId}::oauthToken`), true);

    await manager.remove(current.extensionId);
    assert.equal(current.secrets.size, 0);
    assert.equal(
      (await manager.list()).some((item) => item.id === current.extensionId),
      false,
    );
  } finally {
    await cleanup(current);
  }
});

test("failed secret deletion aborts uninstall and can be retried", async () => {
  const current = await fixture();
  const context = {
    spiritDataDir: current.spiritDataDir,
    hostKind: "desktop" as const,
    stateStore: stateStore(current),
  };
  try {
    const manager = createHostExtensionManager(context);
    await manager.run({ id: current.extensionId, host: {} });
    await accessor().set("oauthToken", "token");

    const failingStore = stateStore(current);
    failingStore.deleteSecret = async () => {
      throw new Error("keyring unavailable");
    };
    const failingManager = createHostExtensionManager({
      ...context,
      stateStore: failingStore,
    });
    await assert.rejects(() => failingManager.remove(current.extensionId), /keyring unavailable/);
    assert.equal(
      (await manager.list()).some((item) => item.id === current.extensionId),
      true,
    );
    assert.equal(current.secrets.get(`${current.extensionId}::oauthToken`), "token");

    await manager.remove(current.extensionId);
    assert.equal(current.secrets.size, 0);
  } finally {
    await cleanup(current);
  }
});
