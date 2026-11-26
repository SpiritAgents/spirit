import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assertDeclaredInstructionContributionFiles,
  isValidDeclaredSkillMarkdown,
  type MarketplaceContributionFileReaders,
} from "./contribution-files.js";

const MCP_DECLARATION = [{ name: "demo", transport: "stdio" as const }];
const HTTP_MCP_DECLARATION = [{ name: "demo", transport: "http" as const }];
const HOOKS_DECLARATION = [{ event: "sessionStart" }];
const RULES_DECLARATION = { displayName: {}, summary: {} };
const SKILLS_DECLARATION = [{ name: "demo-skill" }];
const VALID_MCP_JSON = JSON.stringify({
  servers: { demo: { transport: { type: "stdio" } } },
});
const VALID_HOOKS_JSON = JSON.stringify({ hooks: { sessionStart: [{}] } });
const VALID_RULE_MD = "# Rules\n\nBe nice.";
const VALID_SKILL_MD = "---\nname: demo-skill\ndescription: Demo skill.\n---\n\nBody.";

function noopValidators() {
  return {
    parseMcpConfigFile(parsed: unknown) {
      if (typeof parsed !== "object" || parsed === null || !("servers" in parsed)) {
        throw new Error("servers missing");
      }
      return parsed as { servers: Record<string, { transport: { type: "stdio" | "http" } }> };
    },
    parseHooksConfigFile(parsed: unknown) {
      if (typeof parsed !== "object" || parsed === null || !("hooks" in parsed)) {
        throw new Error("hooks missing");
      }
      return parsed as { hooks: Record<string, unknown[]> };
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
    assertDeclaredInstructionContributionFiles(
      { mcp: MCP_DECLARATION },
      { validators: noopValidators() },
    ),
    /cannot read extension contribution files/,
  );
});

test("mcp declaration requires a valid mcp.json", async () => {
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { mcp: MCP_DECLARATION },
      { ...readersFromFiles({}), validators: noopValidators() },
    ),
    /file does not exist: mcp.json/,
  );
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { mcp: MCP_DECLARATION },
      { ...readersFromFiles({ "mcp.json": "{ not json" }), validators: noopValidators() },
    ),
    /mcp.json is not valid JSON/,
  );
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { mcp: MCP_DECLARATION },
      { ...readersFromFiles({ "mcp.json": "{}" }), validators: noopValidators() },
    ),
    /mcp.json is invalid: servers missing/,
  );
  await assertDeclaredInstructionContributionFiles(
    { mcp: MCP_DECLARATION },
    { ...readersFromFiles({ "mcp.json": VALID_MCP_JSON }), validators: noopValidators() },
  );
});

test("mcp secret references must use declared secret slots", async () => {
  const files = {
    "mcp.json": JSON.stringify({
      servers: {
        demo: {
          transport: {
            type: "http",
            url: "http://127.0.0.1/mcp",
            headers: { Authorization: "Bearer ${extension-secret:credentials:accessToken}" },
          },
        },
      },
    }),
  };
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { mcp: HTTP_MCP_DECLARATION },
      { ...readersFromFiles(files), validators: noopValidators(), secretSlots: [] },
    ),
    /undeclared extension secret slot: credentials/,
  );
  await assertDeclaredInstructionContributionFiles(
    { mcp: HTTP_MCP_DECLARATION },
    {
      ...readersFromFiles(files),
      validators: noopValidators(),
      secretSlots: ["credentials"],
    },
  );
});

test("hooks declaration requires a valid hooks.json", async () => {
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { hooks: HOOKS_DECLARATION },
      { ...readersFromFiles({ "hooks.json": "[]" }), validators: noopValidators() },
    ),
    /hooks.json is invalid: hooks missing/,
  );
  await assertDeclaredInstructionContributionFiles(
    { hooks: HOOKS_DECLARATION },
    { ...readersFromFiles({ "hooks.json": VALID_HOOKS_JSON }), validators: noopValidators() },
  );
});

test("rules declaration requires a non-empty AGENTS.md", async () => {
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { rules: RULES_DECLARATION },
      { ...readersFromFiles({ "AGENTS.md": "  \n" }), validators: noopValidators() },
    ),
    /AGENTS.md must not be empty/,
  );
  await assertDeclaredInstructionContributionFiles(
    { rules: RULES_DECLARATION },
    { ...readersFromFiles({ "AGENTS.md": VALID_RULE_MD }), validators: noopValidators() },
  );
});

test("skills declaration requires at least one valid skills/<name>/SKILL.md", async () => {
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { skills: SKILLS_DECLARATION },
      {
        ...readersFromFiles({ "skills/demo/SKILL.md": "no frontmatter" }),
        validators: noopValidators(),
      },
    ),
    /no valid skills\/\*\/SKILL.md/,
  );
  await assertDeclaredInstructionContributionFiles(
    { skills: SKILLS_DECLARATION },
    {
      ...readersFromFiles({ "skills/demo-skill/SKILL.md": VALID_SKILL_MD }),
      validators: noopValidators(),
    },
  );
});

test("fieldPrefix customizes error messages for host call sites", async () => {
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { skills: SKILLS_DECLARATION },
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

test("presentation declarations exactly match MCP, hook, and skill package contents", async () => {
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { mcp: [{ name: "demo", transport: "http" }] },
      { ...readersFromFiles({ "mcp.json": VALID_MCP_JSON }), validators: noopValidators() },
    ),
    /presentation declarations must match package contents/,
  );
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { hooks: [{ event: "sessionEnd" }] },
      { ...readersFromFiles({ "hooks.json": VALID_HOOKS_JSON }), validators: noopValidators() },
    ),
    /presentation declarations must match package contents/,
  );
  await assert.rejects(
    assertDeclaredInstructionContributionFiles(
      { skills: [{ name: "missing-skill" }] },
      {
        ...readersFromFiles({ "skills/demo-skill/SKILL.md": VALID_SKILL_MD }),
        validators: noopValidators(),
      },
    ),
    /presentation declarations must match package contents/,
  );
});
