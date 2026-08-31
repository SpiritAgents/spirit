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
  await writeFile(join(packageDir, "README.md"), "# Toggle demo\n\nFixture readme.\n", "utf8");

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

test("readDocument returns whitelisted package documents only", async () => {
  const fixture = await installToggleDemoFixture();
  try {
    const manager = createHostExtensionManager({
      spiritDataDir: fixture.spiritDataDir,
      hostKind: "desktop",
    });

    const readme = await manager.readDocument(fixture.extensionId, "README.md");
    assert.equal(readme, "# Toggle demo\n\nFixture readme.\n");

    // Missing optional documents read as empty.
    assert.equal(await manager.readDocument(fixture.extensionId, "CHANGELOG.md"), "");

    // Unknown or traversal-looking ids never resolve to a directory.
    await assert.rejects(() => manager.readDocument("../..", "README.md"), /Extension not found/);
    await assert.rejects(
      () => manager.readDocument("@spiritagent/extension-missing", "README.md"),
      /Extension not found/,
    );

    // Anything outside the fixed document whitelist is refused.
    await assert.rejects(
      () => manager.readDocument(fixture.extensionId, "package.json"),
      /Unsupported extension document file name/,
    );
    await assert.rejects(
      () => manager.readDocument(fixture.extensionId, "../../etc/passwd"),
      /Unsupported extension document file name/,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

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
  spiritExtension: Record<string, unknown>,
  files?: Record<string, string>,
): Promise<void> {
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: "spirit.instruction-contribution-demo",
        version: "0.0.1",
        spiritExtension: {
          schemaVersion: 1,
          displayName: "Instruction contribution demo",
          supportedHosts: ["desktop"],
          ...spiritExtension,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  for (const [relativePath, content] of Object.entries(files ?? {})) {
    const target = join(packageDir, relativePath);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
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
          { preparedDirectoryPath: missingCapabilityDir, installSource: "archive" },
        ),
      /missing mcp in spiritExtension.requestedCapabilities/,
    );

    const missingContributeDir = join(preparedRoot, "missing-contribute");
    await writeMinimalExtensionPackage(missingContributeDir, {
      requestedCapabilities: ["mcp"],
    });
    await assert.rejects(
      () =>
        installPreparedExtensionDirectory(
          { spiritDataDir, hostKind: "desktop" },
          { preparedDirectoryPath: missingContributeDir, installSource: "archive" },
        ),
      /missing spiritExtension.contributes.mcp/,
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
          { preparedDirectoryPath: missingFileDir, installSource: "archive" },
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
          { preparedDirectoryPath: invalidJsonDir, installSource: "archive" },
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
          { preparedDirectoryPath: emptySkillsDir, installSource: "archive" },
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
          { preparedDirectoryPath: emptyRuleDir, installSource: "archive" },
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
      { preparedDirectoryPath: undeclaredDir, installSource: "archive" },
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
        contributes: { mcp: true, hooks: {}, skills: true, rules: true },
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
        installSource: "archive",
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
