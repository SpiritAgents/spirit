import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  collectHostExtensionContributedTools,
  createHostExtensionManager,
  installPreparedExtensionDirectory,
} from "./index.js";

const TOGGLE_EVENTS_GLOBAL = "__spiritExtensionToggleDemoEvents";

type ToggleDemoFixture = {
  spiritDataDir: string;
  preparedRoot: string;
  extensionId: string;
};

async function installToggleDemoFixture(): Promise<ToggleDemoFixture> {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-ext-toggle-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-ext-toggle-prepared-"));
  const packageDir = join(preparedRoot, "toggle-demo");
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: "@spiritagent/extension-toggle-demo",
        version: "0.0.1",
        main: "index.js",
        spiritExtension: {
          schemaVersion: 1,
          displayName: "Toggle demo",
          supportedHosts: ["desktop"],
          activationEvents: ["onStartup"],
          requestedCapabilities: ["system-prompt", "tool-definitions", "tool-execution"],
          contributes: {
            tools: [
              {
                name: "demo_tool",
                description: "Demo tool",
                inputSchema: { type: "object" },
              },
            ],
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(packageDir, "index.js"),
    `export function activate() {
  return {
    systemPrompt: "fixture prompt",
    onEvent() {
      globalThis.${TOGGLE_EVENTS_GLOBAL} = (globalThis.${TOGGLE_EVENTS_GLOBAL} ?? 0) + 1;
    },
  };
}
`,
    "utf8",
  );

  const installed = await installPreparedExtensionDirectory(
    { spiritDataDir, hostKind: "desktop" },
    { preparedDirectoryPath: packageDir, installSource: "archive" },
  );
  return { spiritDataDir, preparedRoot, extensionId: installed.id };
}

async function cleanupFixture(fixture: ToggleDemoFixture): Promise<void> {
  await rm(fixture.spiritDataDir, { recursive: true, force: true });
  await rm(fixture.preparedRoot, { recursive: true, force: true });
}

function readToggleEventCount(): number {
  return (globalThis as Record<string, unknown>)[TOGGLE_EVENTS_GLOBAL] as number;
}

test("extensions are enabled by default and setEnabled persists per-host overrides", async () => {
  const fixture = await installToggleDemoFixture();
  try {
    const manager = createHostExtensionManager({
      spiritDataDir: fixture.spiritDataDir,
      hostKind: "desktop",
    });

    const initially = await manager.list();
    assert.equal(initially.find((item) => item.id === fixture.extensionId)?.enabled, true);

    await manager.setEnabled(fixture.extensionId, false);
    const disabled = await manager.list();
    assert.equal(disabled.find((item) => item.id === fixture.extensionId)?.enabled, false);
    const stateRaw = JSON.parse(
      await readFile(
        join(fixture.spiritDataDir, "extensions", "desktop", "extensions-state.json"),
        "utf8",
      ),
    ) as { enabledOverrides?: Record<string, boolean> };
    assert.equal(stateRaw.enabledOverrides?.[fixture.extensionId], false);

    await manager.setEnabled(fixture.extensionId, true);
    const reenabled = await manager.list();
    assert.equal(reenabled.find((item) => item.id === fixture.extensionId)?.enabled, true);
    const prunedRaw = JSON.parse(
      await readFile(
        join(fixture.spiritDataDir, "extensions", "desktop", "extensions-state.json"),
        "utf8",
      ),
    ) as { enabledOverrides?: Record<string, boolean> };
    assert.equal(fixture.extensionId in (prunedRaw.enabledOverrides ?? {}), false);

    await assert.rejects(
      () => manager.setEnabled("@spiritagent/extension-missing", false),
      /Extension not found/,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("disabled extensions contribute no tools, prompts, events, or runs", async () => {
  const fixture = await installToggleDemoFixture();
  try {
    (globalThis as Record<string, unknown>)[TOGGLE_EVENTS_GLOBAL] = 0;
    const manager = createHostExtensionManager({
      spiritDataDir: fixture.spiritDataDir,
      hostKind: "desktop",
    });
    const host = {};

    let listed = await manager.list();
    assert.equal(collectHostExtensionContributedTools(listed).length, 1);
    assert.equal((await manager.collectSystemPromptContributions({ host })).length, 1);
    await manager.dispatchEvent({ event: { type: "onStartup" }, host });
    assert.equal(readToggleEventCount(), 1);
    await manager.run({ id: fixture.extensionId, host });

    await manager.setEnabled(fixture.extensionId, false);

    listed = await manager.list();
    assert.equal(collectHostExtensionContributedTools(listed).length, 0);
    assert.equal((await manager.collectSystemPromptContributions({ host })).length, 0);
    await manager.dispatchEvent({ event: { type: "onStartup" }, host });
    assert.equal(readToggleEventCount(), 1);
    await assert.rejects(
      () => manager.run({ id: fixture.extensionId, host }),
      /The extension is disabled/,
    );
    await assert.rejects(
      () =>
        manager.invokeTool({
          extensionId: fixture.extensionId,
          toolName: "demo_tool",
          arguments: {},
          host,
        }),
      /The extension is disabled/,
    );

    await manager.setEnabled(fixture.extensionId, true);
    await manager.dispatchEvent({ event: { type: "onStartup" }, host });
    assert.equal(readToggleEventCount(), 2);
  } finally {
    await cleanupFixture(fixture);
  }
});
