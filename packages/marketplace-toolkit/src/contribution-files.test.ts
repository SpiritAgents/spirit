import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assertDeclaredInstructionContributionFiles,
  isValidDeclaredSkillMarkdown,
  type MarketplaceContributionFileReaders,
} from "./contribution-files.js";

const VALID_MCP_JSON = JSON.stringify({ mcpServers: { demo: { command: "demo" } } });
const VALID_HOOKS_JSON = JSON.stringify({ hooks: [] });
const VALID_RULE_MD = "# Rules\n\nBe nice.";
const VALID_SKILL_MD = "---\nname: demo-skill\ndescription: Demo skill.\n---\n\nBody.";

function noopValidators() {
  return {
    parseMcpConfigFile(parsed: unknown): void {
      if (typeof parsed !== "object" || parsed === null || !("mcpServers" in parsed)) {
        throw new Error("mcpServers missing");
      }
    },
    parseHooksConfigFile(parsed: unknown): void {
      if (typeof parsed !== "object" || parsed === null || !("hooks" in parsed)) {
        throw new Error("hooks missing");
      }
    },
  };
}

function readersFromFiles(files: Record<string, string>): MarketplaceContributionFileReaders {
  return {
    readRelativeTextFile(relativePath: string) {
      const content = files[relativePath];
      if (content === undefined) {
        return Promise.reject(new Error(`file does not exist: ${relativePath}`));
      }
      return Promise.resolve(content);
    },
    listRelativeChildDirectories(relativePath: string) {
      const prefix = `${relativePath}/`;
      const names = new Set<string>();
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const rest = key.slice(prefix.length);
        const first = rest.split("/")[0];
        if (first && rest.includes("/")) {
          names.add(first);
        }
      }
      return Promise.resolve([...names]);
    },
  };
}

test("no instruction declarations means no file reads", async () => {
  await assertDeclaredInstructionContributionFiles(undefined, {
    validators: noopValidators(),
  });
  await assertDeclaredInstructionContributionFiles({}, { validators: noopValidators() });
});

test("missing readers reject declared contributions", async () => {
  await assert.rejects(
    assertDeclaredInstructionContributionFiles({ mcp: true }, { validators: noopValidators() }),
    /cannot read extension contribution files/,
  );
});

test("mcp declaration requires a valid mcp.json", async () => {
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { mcp: true },
      { ...readersFromFiles({}), validators: noopValidators() },
    ),
    /file does not exist: mcp.json/,
  );
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { mcp: true },
      { ...readersFromFiles({ "mcp.json": "{ not json" }), validators: noopValidators() },
    ),
    /mcp.json is not valid JSON/,
  );
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { mcp: true },
      { ...readersFromFiles({ "mcp.json": "{}" }), validators: noopValidators() },
    ),
    /mcp.json is invalid: mcpServers missing/,
  );
  await assertDeclaredInstructionContributionFiles(
    { mcp: true },
    { ...readersFromFiles({ "mcp.json": VALID_MCP_JSON }), validators: noopValidators() },
  );
});

test("hooks declaration requires a valid hooks.json", async () => {
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { hooks: true },
      { ...readersFromFiles({ "hooks.json": "[]" }), validators: noopValidators() },
    ),
    /hooks.json is invalid: hooks missing/,
  );
  await assertDeclaredInstructionContributionFiles(
    { hooks: true },
    { ...readersFromFiles({ "hooks.json": VALID_HOOKS_JSON }), validators: noopValidators() },
  );
});

test("rules declaration requires a non-empty rule.md", async () => {
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { rules: true },
      { ...readersFromFiles({ "rule.md": "  \n" }), validators: noopValidators() },
    ),
    /rule.md must not be empty/,
  );
  await assertDeclaredInstructionContributionFiles(
    { rules: true },
    { ...readersFromFiles({ "rule.md": VALID_RULE_MD }), validators: noopValidators() },
  );
});

test("skills declaration requires at least one valid skills/<name>/SKILL.md", async () => {
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { skills: true },
      {
        ...readersFromFiles({ "skills/demo/SKILL.md": "no frontmatter" }),
        validators: noopValidators(),
      },
    ),
    /no valid skills\/\*\/SKILL.md/,
  );
  await assertDeclaredInstructionContributionFiles(
    { skills: true },
    {
      ...readersFromFiles({ "skills/demo-skill/SKILL.md": VALID_SKILL_MD }),
      validators: noopValidators(),
    },
  );
});

test("fieldPrefix customizes error messages for host call sites", async () => {
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { skills: true },
      {
        ...readersFromFiles({}),
        validators: noopValidators(),
        fieldPrefix: "spiritExtension.contributes",
      },
    ),
    /declares spiritExtension\.contributes\.skills/,
  );
});

test("isValidDeclaredSkillMarkdown enforces frontmatter name/description and directory match", () => {
  assert.equal(isValidDeclaredSkillMarkdown(VALID_SKILL_MD, "demo-skill"), true);
  assert.equal(isValidDeclaredSkillMarkdown(VALID_SKILL_MD, "other-name"), false);
  assert.equal(isValidDeclaredSkillMarkdown("no frontmatter", "demo-skill"), false);
  assert.equal(isValidDeclaredSkillMarkdown("---\nname: demo-skill\n---\n", "demo-skill"), false);
  assert.equal(
    isValidDeclaredSkillMarkdown("---\nname: Demo_Skill\ndescription: x\n---\n", "Demo_Skill"),
    false,
  );
});
