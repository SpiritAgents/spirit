import assert from "node:assert/strict";
import { test } from "vitest";

import { currentWorkspaceFileReferenceQuery } from "@spiritagent/host-internal/workspace-file-reference-query";

import {
  buildSkillSlashSuggestions,
  currentSkillSlashQuery,
  currentSkillSlashQueryAtCursor,
  skillSlashQueryKey,
} from "@spiritagent/ui/composer";

test("buildSkillSlashSuggestions excludes start-implementing slash", () => {
  const suggestions = buildSkillSlashSuggestions("/", []);
  assert.equal(
    suggestions.some((item) => item.alias === "/start-implementing"),
    false,
  );
});

test("buildSkillSlashSuggestions includes loop command", () => {
  const suggestions = buildSkillSlashSuggestions("/loop", []);
  assert.ok(suggestions.some((item) => item.kind === "loop" && item.alias === "/loop"));
});

test("buildSkillSlashSuggestions filters loop by prefix", () => {
  const suggestions = buildSkillSlashSuggestions("/lo", []);
  assert.ok(suggestions.some((item) => item.kind === "loop"));
  assert.equal(
    buildSkillSlashSuggestions("/compact", []).some((item) => item.kind === "loop"),
    false,
  );
});

test("buildSkillSlashSuggestions includes plan and ask commands", () => {
  const suggestions = buildSkillSlashSuggestions("/", []);
  assert.ok(suggestions.some((item) => item.kind === "plan" && item.alias === "/plan"));
  assert.ok(suggestions.some((item) => item.kind === "ask" && item.alias === "/ask"));
});

test("buildSkillSlashSuggestions filters plan by prefix", () => {
  const suggestions = buildSkillSlashSuggestions("/p", []);
  assert.ok(suggestions.some((item) => item.kind === "plan"));
  assert.equal(
    buildSkillSlashSuggestions("/ask", []).some((item) => item.kind === "plan"),
    false,
  );
});

test("buildSkillSlashSuggestions matches side via btw search alias", () => {
  const suggestions = buildSkillSlashSuggestions("/btw", []);
  const side = suggestions.find((item) => item.kind === "side-chat");
  assert.ok(side);
  assert.equal(side.name, "Side");
  assert.equal(side.alias, "/side");
});

test("buildSkillSlashSuggestions filters side by btw alias prefix", () => {
  const suggestions = buildSkillSlashSuggestions("/bt", []);
  assert.ok(suggestions.some((item) => item.kind === "side-chat"));
  assert.equal(
    buildSkillSlashSuggestions("/compact", []).some((item) => item.kind === "side-chat"),
    false,
  );
});

test("currentSkillSlashQueryAtCursor matches slash token in middle of text", () => {
  const input = "hello /git";
  const query = currentSkillSlashQueryAtCursor(input, Array.from(input).length);
  assert.deepEqual(query, {
    start: 6,
    end: 10,
    raw: "/git",
  });
});

test("currentSkillSlashQueryAtCursor matches leading slash token", () => {
  const input = "/loop";
  const query = currentSkillSlashQueryAtCursor(input, Array.from(input).length);
  assert.deepEqual(query, { start: 0, end: 5, raw: "/loop" });
});

test("currentSkillSlashQueryAtCursor matches mid-text plan token", () => {
  const input = "please /plan";
  const query = currentSkillSlashQueryAtCursor(input, Array.from(input).length);
  assert.deepEqual(query, {
    start: 7,
    end: 12,
    raw: "/plan",
  });
});

test("currentSkillSlashQueryAtCursor rejects slash command followed by extra text", () => {
  assert.equal(
    currentSkillSlashQueryAtCursor("/loop extra", Array.from("/loop extra").length),
    undefined,
  );
  assert.equal(
    currentSkillSlashQueryAtCursor("hi /foo bar", Array.from("hi /foo bar").length),
    undefined,
  );
});

test("currentSkillSlashQueryAtCursor matches slash token after newline", () => {
  const input = "hello\n/plan";
  const query = currentSkillSlashQueryAtCursor(input, Array.from(input).length);
  assert.deepEqual(query, {
    start: 6,
    end: 11,
    raw: "/plan",
  });
});

test("currentSkillSlashQueryAtCursor matches lone slash on second line", () => {
  const input = "aaa\n/";
  const query = currentSkillSlashQueryAtCursor(input, Array.from(input).length);
  assert.deepEqual(query, {
    start: 4,
    end: 5,
    raw: "/",
  });
});

test("currentSkillSlashQueryAtCursor returns undefined when caret is outside slash token", () => {
  assert.equal(currentSkillSlashQueryAtCursor("hello world", 5), undefined);
});

test("currentSkillSlashQuery delegates to cursor-at-end behavior", () => {
  assert.equal(currentSkillSlashQuery("/loop"), "/loop");
  assert.equal(currentSkillSlashQuery("text /git"), "/git");
  assert.equal(currentSkillSlashQuery("hello world"), undefined);
});

test("skillSlashQueryKey is stable for the same query", () => {
  const query = { start: 1, end: 5, raw: "/git" };
  assert.equal(skillSlashQueryKey(query), "1\u00005\u0000/git");
});

test("slash and file-reference queries target different caret tokens", () => {
  const input = "see @src/foo.ts then /git";
  const fileCaret = Array.from("see @").length;
  const slashCaret = Array.from(input).length;
  const fileQuery = currentWorkspaceFileReferenceQuery(input, fileCaret);
  const slashQuery = currentSkillSlashQueryAtCursor(input, slashCaret);
  assert.ok(fileQuery?.raw.startsWith("@"));
  assert.equal(slashQuery?.raw, "/git");
  assert.notEqual(fileQuery?.raw, slashQuery?.raw);
});

test("buildSkillSlashSuggestions returns empty for undefined query", () => {
  assert.deepEqual(buildSkillSlashSuggestions(undefined, []), []);
});

test("isCompactSlashComposerSegments matches chip-only compact composer", async () => {
  const { COMPACT_SLASH_ALIAS, isCompactSlashComposerRequest, isCompactSlashComposerSegments } =
    await import("@spiritagent/ui/composer");
  const { skillContextText } = await import("@spiritagent/ui/composer");

  assert.equal(
    isCompactSlashComposerSegments([{ kind: "skill", alias: COMPACT_SLASH_ALIAS }]),
    true,
  );
  assert.equal(
    isCompactSlashComposerSegments([
      { kind: "skill", alias: COMPACT_SLASH_ALIAS },
      { kind: "text", value: " extra" },
    ]),
    false,
  );
  assert.equal(
    isCompactSlashComposerSegments([
      { kind: "plan" },
      { kind: "skill", alias: COMPACT_SLASH_ALIAS },
      { kind: "text", value: " " },
    ]),
    false,
  );
  assert.equal(isCompactSlashComposerRequest(COMPACT_SLASH_ALIAS, []), true);
  assert.equal(
    isCompactSlashComposerRequest(skillContextText(COMPACT_SLASH_ALIAS), [COMPACT_SLASH_ALIAS]),
    true,
  );
});
