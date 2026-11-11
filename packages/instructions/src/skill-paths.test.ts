import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isSkillMarkdownPath,
  lsToolDisplayPath,
  parseSkillNameFromMarkdown,
  readFileToolDisplayBase,
} from "./skill-paths.js";

test("isSkillMarkdownPath matches SKILL_FILE_NAME case-sensitively", () => {
  assert.equal(isSkillMarkdownPath("skills/git-commit/SKILL.md"), true);
  assert.equal(isSkillMarkdownPath("skills/git-commit/skill.md"), false);
  assert.equal(isSkillMarkdownPath("App.tsx"), false);
});

test("lsToolDisplayPath relativizes paths within workspace root", () => {
  const root = "/Users/yu/Spirit";
  assert.equal(lsToolDisplayPath("/Users/yu/Spirit/apps", root, "Directory"), "apps");
  assert.equal(lsToolDisplayPath("/Users/yu/Spirit/apps/", root, "Directory"), "apps/");
  assert.equal(
    lsToolDisplayPath("/Users/yu/Spirit/apps/cli/src", root, "Directory"),
    "apps/cli/src",
  );
  assert.equal(lsToolDisplayPath("/Users/yu/Spirit", root, "Directory"), ".");
  assert.equal(lsToolDisplayPath("/Users/yu/Spirit/", root, "Directory"), ".");
});

test("lsToolDisplayPath keeps absolute paths outside workspace", () => {
  const root = "/Users/yu/Spirit";
  assert.equal(lsToolDisplayPath("/tmp/foo", root, "Directory"), "/tmp/foo");
  assert.equal(lsToolDisplayPath("", root, "Directory"), "Directory");
});

test("lsToolDisplayPath without workspace root keeps absolute path", () => {
  assert.equal(
    lsToolDisplayPath("/Users/yu/Spirit/apps", undefined, "Directory"),
    "/Users/yu/Spirit/apps",
  );
});

test("lsToolDisplayPath normalizes Windows-style paths", () => {
  assert.equal(lsToolDisplayPath("D:\\proj\\apps", "D:\\proj", "Directory"), "apps");
});

test("readFileToolDisplayBase returns empty string for SKILL.md without frontmatter content", () => {
  assert.equal(readFileToolDisplayBase("skills/foo/SKILL.md", "File"), "");
  assert.equal(readFileToolDisplayBase("/proj/src/App.tsx", "File"), "App.tsx");
  assert.equal(readFileToolDisplayBase("src/App.tsx", "File"), "src/App.tsx");
});

test("readFileToolDisplayBase uses SKILL.md frontmatter name from read_file tool output", () => {
  const formattedOutput = `[read]
path: skills/create-rule/SKILL.md
range: 1-6

     1 | ---
     2 | name: create-rule
     3 | description: Author rules
     4 | ---
     5 | ## Goal
`;
  assert.equal(
    readFileToolDisplayBase("skills/create-rule/SKILL.md", "File", {
      skillMarkdownContent: formattedOutput,
    }),
    "create-rule",
  );
});

test("readFileToolDisplayBase uses SKILL.md frontmatter name", () => {
  const markdown = `---
name: llm-debug
description: Developer debug access
---
# Body
`;
  assert.equal(
    readFileToolDisplayBase("skills/wrong-folder/SKILL.md", "File", {
      skillMarkdownContent: markdown,
    }),
    "llm-debug",
  );
});

test("parseSkillNameFromMarkdown reads name before closing frontmatter delimiter", () => {
  assert.equal(
    parseSkillNameFromMarkdown("---\nname: llm-debug\ndescription: still streaming"),
    "llm-debug",
  );
});
