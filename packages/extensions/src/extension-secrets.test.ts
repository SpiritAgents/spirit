import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import type { HostExtensionSecretsAccessor } from "./extensions.js";
import { createHostExtensionManager, installPreparedExtensionDirectory } from "./index.js";
import type { ExtensionStateStore } from "./storage.js";

const SECRETS_GLOBAL = "__spiritExtensionPrivateSecretsTest";

type SecretFixture = {
  spiritDataDir: string;
  preparedRoot: string;
  extensionId: string;
  secrets: Map<string, string>;
};

async function writePackage(
  packageDir: string,
  input: { secretSlots: unknown; main?: string },
): Promise<void> {
  await mkdir(join(packageDir, ".spirit"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify({ name: "secret-demo", version: "1.0.0", ...(input.main ? { main: input.main } : {}) }, null, 2)}\n`,
  );
  await writeFile(
    join(packageDir, ".spirit", "extension.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        name: "secret-demo",
        version: "1.0.0",
        sourceId: "personal",
        displayName: "Secret Demo",
        description: "Secret Demo extension.",
        manifest: {
          supportedHosts: ["desktop"],
          requestedCapabilities: ["secret-storage"],
          secretSlots: input.secretSlots,
        },
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

    await assert.rejects(() => secrets.set("privateKey", ""), /must not be empty/);
    await assert.rejects(() => secrets.get("unknown"), /does not declare the secret slot/);
    await assert.rejects(() => secrets.set("unknown", "value"), /does not declare the secret slot/);

    await secrets.delete("privateKey");
    assert.equal(await secrets.get("privateKey"), undefined);
    assert.equal(await secrets.has("privateKey"), false);
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
