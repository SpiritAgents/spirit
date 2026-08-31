import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "vitest";

import {
  collectEnabledExtensionInstructionContributions,
  overlayExtensionRulesAndSkills,
  summarizeDeclaredExtensionContributionPoints,
} from "./extension-contributions.js";
import { createHostExtensionManager, installPreparedExtensionDirectory } from "./extensions.js";

const VALID_MCP_JSON = `${JSON.stringify(
  {
    servers: {
      bundled: {
        displayName: "Bundled Docs",
        transport: {
          type: "stdio",
          command: "./bin/mcp-server",
          args: ["serve"],
        },
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

const VALID_RULE_MD = "# Extension rules\n\nFollow bundled rules.\n";

const VALID_SKILL_MD = `---
name: demo-skill
description: A bundled demo skill.
---

Do the demo skill.
`;

async function writeExtensionPackage(
  packageDir: string,
  options: {
    name: string;
    requestedCapabilities?: string[];
    contributes?: Record<string, unknown>;
    files?: Record<string, string>;
  },
): Promise<void> {
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: options.name,
        version: "0.0.1",
        spiritExtension: {
          schemaVersion: 1,
          displayName: options.name,
          supportedHosts: ["desktop"],
          ...(options.requestedCapabilities
            ? { requestedCapabilities: options.requestedCapabilities }
            : {}),
          ...(options.contributes ? { contributes: options.contributes } : {}),
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  for (const [relativePath, content] of Object.entries(options.files ?? {})) {
    const target = join(packageDir, relativePath);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}

test("collector loads declared instruction contributions from enabled extensions only", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-ext-collect-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-ext-collect-prepared-"));
  try {
    const declaredDir = join(preparedRoot, "declared");
    await writeExtensionPackage(declaredDir, {
      name: "spirit.collect-declared",
      requestedCapabilities: ["mcp", "hooks", "skills", "rules"],
      contributes: { mcp: true, hooks: true, skills: true, rules: true },
      files: {
        "mcp.json": VALID_MCP_JSON,
        "hooks.json": VALID_HOOKS_JSON,
        "rule.md": VALID_RULE_MD,
        "skills/demo-skill/SKILL.md": VALID_SKILL_MD,
      },
    });
    await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      { preparedDirectoryPath: declaredDir, installSource: "archive" },
    );

    const undeclaredDir = join(preparedRoot, "undeclared");
    await writeExtensionPackage(undeclaredDir, {
      name: "spirit.collect-undeclared",
      files: {
        "mcp.json": VALID_MCP_JSON,
        "hooks.json": VALID_HOOKS_JSON,
        "rule.md": VALID_RULE_MD,
        "skills/other-skill/SKILL.md": `---
name: other-skill
description: Should be ignored.
---

Ignored.
`,
      },
    });
    await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      { preparedDirectoryPath: undeclaredDir, installSource: "archive" },
    );

    const manager = createHostExtensionManager({
      spiritDataDir,
      hostKind: "desktop",
    });
    const listed = await manager.list();
    const collected = await collectEnabledExtensionInstructionContributions(listed);

    assert.equal(Object.keys(collected.mcp.servers).join(","), "bundled");
    const bundled = collected.mcp.servers.bundled;
    assert.equal(bundled?.transport.type, "stdio");
    if (bundled?.transport.type === "stdio") {
      const declared = listed.find((item) => item.id === "spirit.collect-declared");
      assert.ok(declared);
      assert.equal(bundled.transport.command, resolve(declared.directoryPath, "bin/mcp-server"));
      assert.equal(bundled.transport.cwd, resolve(declared.directoryPath));
    }

    assert.equal(collected.hooks.length, 1);
    assert.equal(collected.hooks[0]?.scope, "extension");
    assert.equal(collected.hooks[0]?.event, "sessionStart");
    assert.equal(collected.hooks[0]?.command, "hooks/session-start.sh");
    assert.equal(
      collected.hooks[0]?.configDir,
      resolve(listed.find((item) => item.id === "spirit.collect-declared")?.directoryPath ?? ""),
    );

    assert.equal(collected.skills.length, 1);
    assert.equal(collected.skills[0]?.name, "demo-skill");
    assert.equal(collected.skills[0]?.scope, "extension");
    assert.equal(collected.rules.length, 1);
    assert.equal(collected.rules[0]?.scope, "extension");

    await manager.setEnabled("spirit.collect-declared", false);
    const disabledCollected = await collectEnabledExtensionInstructionContributions(
      await manager.list(),
    );
    assert.deepEqual(disabledCollected.mcp.servers, {});
    assert.equal(disabledCollected.hooks.length, 0);
    assert.equal(disabledCollected.skills.length, 0);
    assert.equal(disabledCollected.rules.length, 0);

    const disabledListed = await manager.list();
    const disabledDeclared = disabledListed.find((item) => item.id === "spirit.collect-declared");
    assert.ok(disabledDeclared);
    const summary = await summarizeDeclaredExtensionContributionPoints(disabledDeclared);
    assert.deepEqual(summary?.mcp, [
      { name: "bundled", displayName: "Bundled Docs", transport: "stdio" },
    ]);
    assert.deepEqual(summary?.hooks, ["sessionStart"]);
    assert.deepEqual(summary?.skills, [
      { name: "demo-skill", description: "A bundled demo skill." },
    ]);
    assert.deepEqual(summary?.rules, { content: VALID_RULE_MD });
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(preparedRoot, { recursive: true, force: true });
  }
});

test("collector keeps the first extension on mcp and skill name collisions", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-ext-collect-shadow-data-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-ext-collect-shadow-prepared-"));
  try {
    const firstDir = join(preparedRoot, "aaa");
    await writeExtensionPackage(firstDir, {
      name: "spirit.collect-aaa",
      requestedCapabilities: ["mcp", "skills"],
      contributes: { mcp: true, skills: true },
      files: {
        "mcp.json": `${JSON.stringify({
          servers: { shared: { transport: { type: "stdio", command: "first-cmd" } } },
        })}\n`,
        "skills/shared-skill/SKILL.md": `---
name: shared-skill
description: First skill.
---

First.
`,
      },
    });
    const secondDir = join(preparedRoot, "bbb");
    await writeExtensionPackage(secondDir, {
      name: "spirit.collect-bbb",
      requestedCapabilities: ["mcp", "skills"],
      contributes: { mcp: true, skills: true },
      files: {
        "mcp.json": `${JSON.stringify({
          servers: { shared: { transport: { type: "stdio", command: "second-cmd" } } },
        })}\n`,
        "skills/shared-skill/SKILL.md": `---
name: shared-skill
description: Second skill.
---

Second.
`,
      },
    });
    await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      { preparedDirectoryPath: firstDir, installSource: "archive" },
    );
    await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      { preparedDirectoryPath: secondDir, installSource: "archive" },
    );

    const manager = createHostExtensionManager({
      spiritDataDir,
      hostKind: "desktop",
    });
    const collected = await collectEnabledExtensionInstructionContributions(await manager.list());
    const shared = collected.mcp.servers.shared;
    assert.equal(shared?.transport.type, "stdio");
    if (shared?.transport.type === "stdio") {
      assert.equal(shared.transport.command, "first-cmd");
    }
    assert.equal(collected.skills.length, 1);
    assert.equal(collected.skills[0]?.description, "First skill.");
    assert.equal(collected.skills[0]?.extensionId, "spirit.collect-aaa");
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(preparedRoot, { recursive: true, force: true });
  }
});

test("overlay keeps user and workspace skills ahead of extension skills", async () => {
  const overlay = overlayExtensionRulesAndSkills(
    [
      {
        id: "user-rule",
        scope: "user",
        title: "User rules",
        path: "/tmp/rule.md",
        content: "user",
      },
    ],
    [
      {
        id: "user-skill",
        scope: "user",
        name: "shared-skill",
        description: "User skill",
        path: "/tmp/skills/shared-skill/SKILL.md",
      },
    ],
    {
      mcp: { servers: {} },
      hooks: [],
      skills: [
        {
          id: "ext-skill",
          extensionId: "spirit.demo",
          extensionName: "Demo",
          scope: "extension",
          name: "shared-skill",
          description: "Extension skill",
          path: "/tmp/ext/skills/shared-skill/SKILL.md",
          content: "ext",
        },
        {
          id: "ext-only",
          extensionId: "spirit.demo",
          extensionName: "Demo",
          scope: "extension",
          name: "ext-only",
          description: "Extension only",
          path: "/tmp/ext/skills/ext-only/SKILL.md",
          content: "only",
        },
      ],
      rules: [
        {
          id: "ext-rule",
          extensionId: "spirit.demo",
          extensionName: "Demo",
          scope: "extension",
          title: "Extension Demo rules",
          path: "/tmp/ext/rule.md",
          content: "ext rules",
        },
      ],
    },
  );

  assert.equal(overlay.skills.length, 2);
  assert.equal(overlay.skills[0]?.scope, "user");
  assert.equal(overlay.skills[1]?.scope, "extension");
  assert.equal(overlay.skills[1]?.name, "ext-only");
  assert.equal(overlay.rules.length, 2);
  assert.equal(overlay.rules[1]?.scope, "extension");
});
