import assert from "node:assert/strict";
import { test } from "vitest";

import { normalizeComposerSegmentsPolicy } from "@spiritagent/ui/composer";
import { emptySegments } from "@spiritagent/ui/composer";
import { hasAgentModeSegment, insertAgentModeSegment } from "@spiritagent/ui/composer";
import { hasLoopSegment, insertLoopSegment } from "@spiritagent/ui/composer";

test("normalizeComposerSegmentsPolicy pins ask chip when host mode is ask", () => {
  const normalized = normalizeComposerSegmentsPolicy(emptySegments(), {
    agentMode: "ask",
    agentModeChipDismissed: false,
  });
  assert.ok(hasAgentModeSegment(normalized));
  assert.equal(
    normalized.some((s) => s.kind === "ask"),
    true,
  );
});

test("normalizeComposerSegmentsPolicy removes ask chip when dismissed", () => {
  const withAsk = insertAgentModeSegment(emptySegments(), "ask").segments;
  const normalized = normalizeComposerSegmentsPolicy(withAsk, {
    agentMode: "ask",
    agentModeChipDismissed: true,
  });
  assert.equal(hasAgentModeSegment(normalized), false);
});

test("normalizeComposerSegmentsPolicy preserves loop before ask chip", () => {
  const withLoop = insertLoopSegment(emptySegments()).segments;
  const normalized = normalizeComposerSegmentsPolicy(withLoop, {
    agentMode: "ask",
    agentModeChipDismissed: false,
  });
  assert.ok(hasLoopSegment(normalized));
  const loopIndex = normalized.findIndex((s) => s.kind === "loop");
  const askIndex = normalized.findIndex((s) => s.kind === "ask");
  assert.ok(loopIndex >= 0 && askIndex >= 0);
  assert.ok(loopIndex < askIndex);
});

test("normalizeComposerSegmentsPolicy merges body text with pinned ask chip", () => {
  const body = [{ kind: "text", value: "hello world" }];
  const merged = normalizeComposerSegmentsPolicy(body, {
    agentMode: "ask",
    agentModeChipDismissed: false,
  });
  assert.equal(
    merged.some((s) => s.kind === "ask"),
    true,
  );
  assert.equal(
    merged.some((s) => s.kind === "text" && s.value === "hello world"),
    true,
  );
});
