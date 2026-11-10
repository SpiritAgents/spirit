import assert from "node:assert/strict";
import { test } from "vitest";

import type { ResolvedTaskPresentation } from "../tasks/public.js";
import { computeExitIntent, computeLaunchIntent } from "./presentation.js";

function presentation(overrides: Partial<ResolvedTaskPresentation>): ResolvedTaskPresentation {
  return {
    echo: true,
    reveal: "always",
    focus: false,
    panel: "shared",
    clear: false,
    close: false,
    preserveTerminalName: false,
    ...overrides,
  };
}

test("launch intent: focus always expands and focuses regardless of reveal", () => {
  for (const reveal of ["always", "silent", "never"] as const) {
    assert.deepEqual(computeLaunchIntent(presentation({ focus: true, reveal })), {
      reveal: "expand",
      focus: true,
    });
  }
});

test("launch intent: without focus only reveal always expands", () => {
  assert.deepEqual(computeLaunchIntent(presentation({ reveal: "always" })), {
    reveal: "expand",
    focus: false,
  });
  assert.deepEqual(computeLaunchIntent(presentation({ reveal: "silent" })), {
    reveal: "none",
    focus: false,
  });
  assert.deepEqual(computeLaunchIntent(presentation({ reveal: "never" })), {
    reveal: "none",
    focus: false,
  });
});

test("exit intent reveals only for silent non-zero exits of foreground tasks", () => {
  assert.deepEqual(computeExitIntent(presentation({ reveal: "silent" }), 1, false), {
    reveal: "expand",
    closeTab: false,
  });
  assert.deepEqual(computeExitIntent(presentation({ reveal: "silent" }), 0, false), {
    reveal: "none",
    closeTab: false,
  });
  assert.deepEqual(computeExitIntent(presentation({ reveal: "silent" }), 1, true), {
    reveal: "none",
    closeTab: false,
  });
  assert.deepEqual(computeExitIntent(presentation({ reveal: "never" }), 1, false), {
    reveal: "none",
    closeTab: false,
  });
  assert.deepEqual(computeExitIntent(presentation({ reveal: "always" }), 1, false), {
    reveal: "none",
    closeTab: false,
  });
});

test("exit intent closeTab follows the close flag independently of everything else", () => {
  const closing = presentation({ close: true, reveal: "silent" });
  assert.deepEqual(computeExitIntent(closing, 0, false), { reveal: "none", closeTab: true });
  assert.deepEqual(computeExitIntent(closing, 1, false), { reveal: "expand", closeTab: true });
  assert.deepEqual(computeExitIntent(closing, 1, true), { reveal: "none", closeTab: true });

  const open = presentation({ close: false, reveal: "silent" });
  assert.deepEqual(computeExitIntent(open, 1, false), { reveal: "expand", closeTab: false });
});
