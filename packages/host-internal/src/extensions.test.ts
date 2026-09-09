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

/** Write an install-dir-layout extension: pure npm package.json + `.spirit/extension.json`. */
async function writeExtensionDumpPackage(
  packageDir: string,
  options: {
    name: string;
    displayName: string;
    sourceId?: string;
    version?: string;
    main?: string;
    manifest: Record<string, unknown>;
  },
  files?: Record<string, string>,
): Promise<void> {
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: options.name,
        version: options.version ?? "0.0.1",
        ...(options.main ? { main: options.main } : {}),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const dump = {
    schemaVersion: 1,
    name: options.name,
    version: options.version ?? "0.0.1",
    sourceId: options.sourceId ?? "personal",
    displayName: options.displayName,
    description: `${options.displayName} extension.`,
    manifest: options.manifest,
  };
  await mkdir(join(packageDir, ".spirit"), { recursive: true });
  await writeFile(
    join(packageDir, ".spirit", "extension.json"),
    `${JSON.stringify(dump, null, 2)}\n`,
    "utf8",
  );
  for (const [relativePath, content] of Object.entries(files ?? {})) {
    const target = join(packageDir, relativePath);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

async function installToggleDemoFixture(): Promise<ToggleDemoFixture> {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-ext-toggle-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-ext-toggle-prepared-"));
  const packageDir = join(preparedRoot, "toggle-demo");
  await writeExtensionDumpPackage(packageDir, {
    name: "extension-toggle-demo",
    displayName: "Toggle demo",
    main: "index.js",
    manifest: {
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
  });
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
    { preparedDirectoryPath: packageDir },
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
    assert.equal(fixture.extensionId, "personal/extension-toggle-demo");
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
      () => manager.setEnabled("personal/extension-missing", false),
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

const VALID_MCP_JSON = `${JSON.stringify(
  {
    servers: {
      docs: {
        transport: { type: "stdio", command: "echo" },
      },
    },
  },
  null,
  2,
)}\n`;

const VALID_HOOKS_JSON = `${JSON.stringify(
  {
    version: 1,
    hooks: {
      sessionStart: [{ command: "hooks/session-start.sh" }],
    },
  },
  null,
  2,
)}\n`;

const VALID_RULE_MD = "# Extension rules\n\nFollow the bundled extension rules.\n";

const VALID_SKILL_MD = `---
name: demo-skill
description: A bundled demo skill.
---

Do the demo skill.
`;

async function writeMinimalExtensionPackage(
  packageDir: string,
  manifest: Record<string, unknown>,
  files?: Record<string, string>,
): Promise<void> {
  await writeExtensionDumpPackage(
    packageDir,
    {
      name: "instruction-contribution-demo",
      displayName: "Instruction contribution demo",
      manifest: {
        supportedHosts: ["desktop"],
        ...manifest,
      },
    },
    files,
  );
}

test("instruction contributions require matching capabilities and conventional files", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-ext-contrib-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-ext-contrib-prepared-"));
  try {
    const missingCapabilityDir = join(preparedRoot, "missing-capability");
    await writeMinimalExtensionPackage(missingCapabilityDir, {
      contributes: { mcp: true },
    });
    await assert.rejects(
      () =>
        installPreparedExtensionDirectory(
          { spiritDataDir, hostKind: "desktop" },
          { preparedDirectoryPath: missingCapabilityDir },
        ),
      /missing mcp in .*requestedCapabilities/,
    );

    const missingContributeDir = join(preparedRoot, "missing-contribute");
    await writeMinimalExtensionPackage(missingContributeDir, {
      requestedCapabilities: ["mcp"],
    });
    await assert.rejects(
      () =>
        installPreparedExtensionDirectory(
          { spiritDataDir, hostKind: "desktop" },
          { preparedDirectoryPath: missingContributeDir },
        ),
      /declares the mcp capability but is missing/,
    );

    const missingFileDir = join(preparedRoot, "missing-file");
    await writeMinimalExtensionPackage(missingFileDir, {
      requestedCapabilities: ["mcp"],
      contributes: { mcp: true },
    });
    await assert.rejects(
      () =>
        installPreparedExtensionDirectory(
          { spiritDataDir, hostKind: "desktop" },
          { preparedDirectoryPath: missingFileDir },
        ),
      /does not exist: mcp.json/,
    );

    const invalidJsonDir = join(preparedRoot, "invalid-json");
    await writeMinimalExtensionPackage(
      invalidJsonDir,
      { requestedCapabilities: ["mcp"], contributes: { mcp: true } },
      { "mcp.json": "{ not json" },
    );
    await assert.rejects(
      () =>
        installPreparedExtensionDirectory(
          { spiritDataDir, hostKind: "desktop" },
          { preparedDirectoryPath: invalidJsonDir },
        ),
      /mcp.json is not valid JSON/,
    );

    const emptySkillsDir = join(preparedRoot, "empty-skills");
    await writeMinimalExtensionPackage(
      emptySkillsDir,
      { requestedCapabilities: ["skills"], contributes: { skills: true } },
      { "skills/.keep": "" },
    );
    await assert.rejects(
      () =>
        installPreparedExtensionDirectory(
          { spiritDataDir, hostKind: "desktop" },
          { preparedDirectoryPath: emptySkillsDir },
        ),
      /no valid skills\/\*\/SKILL.md/,
    );

    const emptyRuleDir = join(preparedRoot, "empty-rule");
    await writeMinimalExtensionPackage(
      emptyRuleDir,
      { requestedCapabilities: ["rules"], contributes: { rules: true } },
      { "rule.md": "  \n" },
    );
    await assert.rejects(
      () =>
        installPreparedExtensionDirectory(
          { spiritDataDir, hostKind: "desktop" },
          { preparedDirectoryPath: emptyRuleDir },
        ),
      /rule.md must not be empty/,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(preparedRoot, { recursive: true, force: true });
  }
});

test("undeclared instruction files are ignored and declared files install", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-ext-contrib-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-ext-contrib-prepared-"));
  try {
    const undeclaredDir = join(preparedRoot, "undeclared");
    await writeMinimalExtensionPackage(
      undeclaredDir,
      {},
      {
        "mcp.json": VALID_MCP_JSON,
        "hooks.json": VALID_HOOKS_JSON,
        "rule.md": VALID_RULE_MD,
        "skills/demo-skill/SKILL.md": VALID_SKILL_MD,
      },
    );
    const undeclared = await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      { preparedDirectoryPath: undeclaredDir },
    );
    assert.equal(undeclared.manifest.contributes?.mcp, undefined);
    assert.equal(undeclared.manifest.contributes?.hooks, undefined);
    assert.equal(undeclared.manifest.contributes?.skills, undefined);
    assert.equal(undeclared.manifest.contributes?.rules, undefined);

    const declaredDir = join(preparedRoot, "declared");
    await writeMinimalExtensionPackage(
      declaredDir,
      {
        requestedCapabilities: ["mcp", "hooks", "skills", "rules"],
        contributes: { mcp: true, hooks: true, skills: true, rules: true },
      },
      {
        "mcp.json": VALID_MCP_JSON,
        "hooks.json": VALID_HOOKS_JSON,
        "rule.md": VALID_RULE_MD,
        "skills/demo-skill/SKILL.md": VALID_SKILL_MD,
      },
    );
    const declared = await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      {
        preparedDirectoryPath: declaredDir,
        replaceExisting: true,
      },
    );
    assert.equal(declared.manifest.contributes?.mcp, true);
    assert.equal(declared.manifest.contributes?.hooks, true);
    assert.equal(declared.manifest.contributes?.skills, true);
    assert.equal(declared.manifest.contributes?.rules, true);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(preparedRoot, { recursive: true, force: true });
  }
});

test("desktop views-only contributions parse and reject illegal view paths", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-ext-views-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-ext-views-prepared-"));
  try {
    const viewsOnlyDir = join(preparedRoot, "views-only");
    await writeMinimalExtensionPackage(
      viewsOnlyDir,
      {
        requestedCapabilities: ["desktop-ui"],
        contributes: {
          desktop: {
            views: [{ id: "enable", path: "ui/enable.mjs", title: "Enable", width: 480 }],
          },
        },
      },
      {
        "ui/enable.mjs": "export default function View({ close }) { close({}); }\n",
      },
    );
    const installed = await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      { preparedDirectoryPath: viewsOnlyDir },
    );
    assert.deepEqual(installed.manifest.contributes?.desktop, {
      views: [{ id: "enable", path: "ui/enable.mjs", title: "Enable", width: 480 }],
    });

    const sourcePathDir = join(preparedRoot, "tsx-path");
    await writeMinimalExtensionPackage(sourcePathDir, {
      requestedCapabilities: ["desktop-ui"],
      contributes: {
        desktop: { views: [{ id: "enable", path: "ui/enable.tsx" }] },
      },
    });
    await assert.rejects(
      () =>
        installPreparedExtensionDirectory(
          { spiritDataDir, hostKind: "desktop" },
          { preparedDirectoryPath: sourcePathDir },
        ),
      /precompiled \.js or \.mjs/,
    );

    const duplicateDir = join(preparedRoot, "duplicate-id");
    await writeMinimalExtensionPackage(duplicateDir, {
      requestedCapabilities: ["desktop-ui"],
      contributes: {
        desktop: {
          views: [
            { id: "enable", path: "ui/a.mjs" },
            { id: "enable", path: "ui/b.mjs" },
          ],
        },
      },
    });
    await assert.rejects(
      () =>
        installPreparedExtensionDirectory(
          { spiritDataDir, hostKind: "desktop" },
          { preparedDirectoryPath: duplicateDir },
        ),
      /duplicate view id/,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(preparedRoot, { recursive: true, force: true });
  }
});
