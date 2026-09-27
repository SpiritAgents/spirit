import assert from "node:assert/strict";
import { test } from "vitest";
import { Terminal } from "lucide-react";
import * as spiritIcons from "@spiritagent/icons";

import { resolveTaskIcon } from "../../src/lib/task-icon.ts";

test("resolveTaskIcon prefers Spirit Icons over Lucide for the same name", () => {
  // "check" exists in both libraries; Spirit must win.
  const resolution = resolveTaskIcon("check");
  assert.equal(resolution.kind, "spirit");
  assert.equal(resolution.component, spiritIcons.Check);
});

test("resolveTaskIcon normalizes kebab-case ids to PascalCase for Spirit Icons", () => {
  const resolution = resolveTaskIcon("gear");
  assert.equal(resolution.kind, "spirit");
  assert.equal(resolution.component, spiritIcons.Gear);
});

test("resolveTaskIcon falls through to Lucide for lucide-only names", () => {
  const resolution = resolveTaskIcon("git-branch");
  assert.deepEqual(resolution, { kind: "lucide", name: "git-branch" });
});

test("resolveTaskIcon normalizes PascalCase ids to kebab for Lucide", () => {
  const resolution = resolveTaskIcon("GitBranch");
  assert.deepEqual(resolution, { kind: "lucide", name: "git-branch" });
});

test("resolveTaskIcon falls back to the terminal glyph for unknown or missing ids", () => {
  assert.deepEqual(resolveTaskIcon("definitely-not-an-icon-xyz"), {
    kind: "fallback",
    component: Terminal,
  });
  assert.deepEqual(resolveTaskIcon("   "), { kind: "fallback", component: Terminal });
  assert.deepEqual(resolveTaskIcon(undefined), { kind: "fallback", component: Terminal });
});
