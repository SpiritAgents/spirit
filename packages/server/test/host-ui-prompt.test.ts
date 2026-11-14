import assert from "node:assert/strict";
import { test } from "vitest";

import {
  HOST_TOOL_DESCRIPTION_HINT_TEXT_MAX_CHARS,
  HOST_UI_PROMPT_SECTION_MAX_CHARS,
  normalizeHostToolDescriptionHints,
  normalizeHostUiPromptSection,
} from "../src/host-ui-prompt.js";

test("normalizeHostUiPromptSection trims and rejects empty", () => {
  assert.equal(normalizeHostUiPromptSection("  hello  "), "hello");
  assert.equal(normalizeHostUiPromptSection("   "), undefined);
  assert.equal(normalizeHostUiPromptSection(1), undefined);
});

test("normalizeHostUiPromptSection rejects oversized payload", () => {
  assert.equal(
    normalizeHostUiPromptSection("x".repeat(HOST_UI_PROMPT_SECTION_MAX_CHARS + 1)),
    undefined,
  );
  assert.equal(
    normalizeHostUiPromptSection("x".repeat(HOST_UI_PROMPT_SECTION_MAX_CHARS)),
    "x".repeat(HOST_UI_PROMPT_SECTION_MAX_CHARS),
  );
});

test("normalizeHostToolDescriptionHints trims and keeps valid entries", () => {
  assert.deepEqual(
    normalizeHostToolDescriptionHints([
      { toolName: " create_plan ", parameterName: " content ", text: "  hint  " },
      { toolName: "shell", text: "tool-level" },
    ]),
    [
      { toolName: "create_plan", parameterName: "content", text: "hint" },
      { toolName: "shell", text: "tool-level" },
    ],
  );
});

test("normalizeHostToolDescriptionHints rejects malformed payloads", () => {
  assert.equal(normalizeHostToolDescriptionHints("nope"), undefined);
  assert.equal(normalizeHostToolDescriptionHints([]), undefined);
  assert.equal(normalizeHostToolDescriptionHints([{ text: "missing toolName" }]), undefined);
  assert.equal(normalizeHostToolDescriptionHints([{ toolName: "shell", text: "  " }]), undefined);
  assert.equal(
    normalizeHostToolDescriptionHints([
      { toolName: "shell", text: "x".repeat(HOST_TOOL_DESCRIPTION_HINT_TEXT_MAX_CHARS + 1) },
    ]),
    undefined,
  );
  assert.deepEqual(
    normalizeHostToolDescriptionHints([{ toolName: "shell", parameterName: 1, text: "ok" }]),
    [{ toolName: "shell", text: "ok" }],
  );
});
