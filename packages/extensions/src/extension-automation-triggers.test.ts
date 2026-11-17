import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { collectAutomationTriggerContributions } from "./automation-triggers.js";
import { createHostExtensionManager, installPreparedExtensionDirectory } from "./index.js";
import type { ExtensionStateStore } from "./storage.js";
import { localizedTestPackage } from "@spiritagent/extension-toolkit/test-localization";

async function writeTriggerPackage(
  packageDir: string,
  options?: {
    manifestOverrides?: Record<string, unknown>;
    triggerOverrides?: Record<string, unknown>;
  },
): Promise<void> {
  const trigger = {
    id: "activity",
    name: "Repository Activity",
    description: "React to new repository activity.",
    icon: { type: "spirit", name: "globe" },
    configuration: "menu",
    inputSchema: {
      type: "object",
      properties: { repository: { type: "string" } },
      required: ["repository"],
      additionalProperties: false,
    },
    authorization: "oauth",
    ...options?.triggerOverrides,
  };
  await mkdir(join(packageDir, ".spirit"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify({ name: "trigger-demo", version: "1.0.0", main: "index.js" }, null, 2)}\n`,
  );
  await writeFile(
    join(packageDir, ".spirit", "extension.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      name: "trigger-demo",
      version: "1.0.0",
      sourceId: "personal",
      ...localizedTestPackage("Trigger Demo", "Trigger Demo extension.", {
        supportedHosts: ["desktop"],
        requestedCapabilities: ["secret-storage", "automation-triggers"],
        secretSlots: ["oauthAccessToken"],
        contributes: {
          authorizations: [{ id: "oauth", action: "authorize", secretSlots: ["oauthAccessToken"] }],
          automationTriggers: [trigger],
        },
        ...options?.manifestOverrides,
      }),
    })}\n`,
  );
  await writeFile(
    join(packageDir, "index.js"),
    `export function activate() {
      return {
        automationTriggers: {
          activity: {
            validate({ config }) {
              return { config, label: "Activity: " + config.repository };
            },
            menu({ path, query, page }) {
              return {
                items: [{
                  action: "select",
                  id: "repo",
                  label: "Repository",
                  config: { repository: query || "spirit", event: path[0] || "created", page: page },
                }],
              };
            },
            poll({ triggers }) {
              return {
                results: triggers.map((trigger) => ({
                  automationId: trigger.automationId,
                  checkpoint: { cursor: 1 },
                })),
              };
            },
          },
        },
      };
    }\n`,
  );
}

function stateStore(): ExtensionStateStore {
  return {
    async loadSettings() {
      return {};
    },
    async saveSettings() {},
    async loadSecret() {
      return "token";
    },
  };
}

async function installTrigger(options?: Parameters<typeof writeTriggerPackage>[1]) {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-trigger-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-trigger-package-"));
  const packageDir = join(preparedRoot, "trigger-demo");
  await writeTriggerPackage(packageDir, options);
  const installed = await installPreparedExtensionDirectory(
    { spiritDataDir, hostKind: "desktop" },
    { preparedDirectoryPath: packageDir },
  );
  return { spiritDataDir, preparedRoot, installed };
}

test("Automation trigger contributions register namespaced kinds and invoke their provider", async () => {
  const current = await installTrigger();
  try {
    const manager = createHostExtensionManager({
      spiritDataDir: current.spiritDataDir,
      hostKind: "desktop",
      stateStore: stateStore(),
    });
    const [registered] = collectAutomationTriggerContributions(await manager.list());
    assert.equal(registered?.kind, "extension:personal/trigger-demo/activity");
    assert.equal(registered?.extensionId, current.installed.id);
    assert.equal(registered?.authorization, "oauth");

    const validation = await manager.validateAutomationTrigger({
      extensionId: current.installed.id,
      contributionId: "activity",
      config: { repository: "spirit" },
      host: {},
    });
    assert.deepEqual(validation, {
      config: { repository: "spirit" },
      label: "Activity: spirit",
    });

    const menu = await manager.invokeAutomationTriggerMenu({
      extensionId: current.installed.id,
      contributionId: "activity",
      path: ["created"],
      query: "spi",
      page: 1,
      signal: new AbortController().signal,
      host: {},
    });
    assert.equal(menu.items[0]?.action, "select");

    const poll = await manager.invokeAutomationTriggerPoll({
      extensionId: current.installed.id,
      contributionId: "activity",
      triggers: [{ automationId: "automation-1", config: { repository: "spirit" } }],
      signal: new AbortController().signal,
      host: {},
    });
    assert.deepEqual(poll.results, [{ automationId: "automation-1", checkpoint: { cursor: 1 } }]);
  } finally {
    await rm(current.spiritDataDir, { recursive: true, force: true });
    await rm(current.preparedRoot, { recursive: true, force: true });
  }
});

test("Automation trigger declarations reject missing capabilities and unknown references", async () => {
  for (const options of [
    { manifestOverrides: { requestedCapabilities: ["secret-storage"] } },
    { triggerOverrides: { authorization: "missing" } },
    { triggerOverrides: { inputSchema: { type: "object", $ref: "#/definitions/config" } } },
  ]) {
    const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-trigger-data-"));
    const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-trigger-package-"));
    try {
      const packageDir = join(preparedRoot, "trigger-demo");
      await writeTriggerPackage(packageDir, options);
      await assert.rejects(
        () =>
          installPreparedExtensionDirectory(
            { spiritDataDir, hostKind: "desktop" },
            { preparedDirectoryPath: packageDir },
          ),
        /automation-triggers capability|unknown authorization|self-contained/,
      );
    } finally {
      await rm(spiritDataDir, { recursive: true, force: true });
      await rm(preparedRoot, { recursive: true, force: true });
    }
  }
});
