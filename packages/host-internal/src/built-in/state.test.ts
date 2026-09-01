import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  createHostExtensionManager,
  ensureBuiltInSkills,
  installPreparedExtensionDirectory,
  loadBuiltInState,
  noteBuiltInExtensionRemoved,
  noteBuiltInSkillRemoved,
} from "../index.js";

test("ensureBuiltInSkills does not reseed after noteBuiltInSkillRemoved", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-built-in-skill-removed-"));
  try {
    await ensureBuiltInSkills(spiritDataDir);
    const skillPath = join(spiritDataDir, "skills", "create-skill", "SKILL.md");
    await readFile(skillPath, "utf8");

    await noteBuiltInSkillRemoved(spiritDataDir, "create-skill");
    await rm(join(spiritDataDir, "skills", "create-skill"), { recursive: true, force: true });
    await ensureBuiltInSkills(spiritDataDir);

    await assert.rejects(() => readFile(skillPath, "utf8"));
    const state = await loadBuiltInState(spiritDataDir);
    assert.ok(state.removedSkillNames.includes("create-skill"));
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("installPreparedDirectory records installSource and remove notes built-in", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-built-in-ext-source-"));
  const preparedRoot = await mkdtemp(join(tmpdir(), "spirit-built-in-ext-prepared-"));
  try {
    const packageDir = join(preparedRoot, "demo-ext");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      `${JSON.stringify(
        {
          name: "@spiritagent/extension-built-in-source-demo",
          version: "0.0.1",
          description: "installSource persistence fixture",
          main: "index.js",
          spiritExtension: {
            schemaVersion: 1,
            displayName: "Built-in source demo",
            supportedHosts: ["desktop"],
            activationEvents: ["onStartup"],
            requestedCapabilities: ["system-prompt"],
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
    systemPrompt: "fixture",
  };
}
`,
      "utf8",
    );

    const installed = await installPreparedExtensionDirectory(
      { spiritDataDir, hostKind: "desktop" },
      {
        preparedDirectoryPath: packageDir,
        installSource: "built-in",
      },
    );
    assert.equal(installed.installSource, "built-in");

    const manager = createHostExtensionManager({ spiritDataDir, hostKind: "desktop" });
    const listed = await manager.list();
    const match = listed.find((item) => item.id === installed.id);
    assert.ok(match);
    assert.equal(match?.installSource, "built-in");

    await manager.remove(installed.id);
    assert.equal(
      (await manager.list()).some((item) => item.id === installed.id),
      false,
    );
    const state = await loadBuiltInState(spiritDataDir);
    assert.ok(state.removedExtensionIds.includes(installed.id));

    // Direct note API is idempotent.
    await noteBuiltInExtensionRemoved(spiritDataDir, installed.id);
    const again = await loadBuiltInState(spiritDataDir);
    assert.equal(again.removedExtensionIds.filter((id) => id === installed.id).length, 1);

    await noteBuiltInExtensionRemoved(spiritDataDir, installed.id.toUpperCase());
    const mixedCase = await loadBuiltInState(spiritDataDir);
    assert.equal(
      mixedCase.removedExtensionIds.filter((id) => id === installed.id.toLowerCase()).length,
      1,
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
    await rm(preparedRoot, { recursive: true, force: true });
  }
});
