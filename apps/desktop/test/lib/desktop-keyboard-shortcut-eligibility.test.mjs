import assert from "node:assert/strict";
import { test } from "vitest";

import {
  parseModDigitIndex,
  resolveModBackslashSplitShortcutAction,
  resolveModCommaSettingsShortcutAction,
  resolveModDigitShortcutAction,
  resolveModPShortcutAction,
  resolveModTNewToolTabShortcutAction,
  shouldTriggerConversationAbortShortcut,
  shouldTriggerSettingsEscapeShortcut,
} from "../../src/lib/desktop-keyboard-shortcut-eligibility.ts";

const conversationContext = {
  activeSurface: "conversation",
  conversationAbortShortcutEligible: true,
};

test("resolveModPShortcutAction returns file-picker for Mod+P", () => {
  assert.equal(
    resolveModPShortcutAction({
      defaultPrevented: false,
      key: "p",
      shiftKey: false,
      modPressed: true,
    }),
    "file-picker",
  );
});

test("resolveModPShortcutAction returns action-picker for Mod+Shift+P", () => {
  assert.equal(
    resolveModPShortcutAction({
      defaultPrevented: false,
      key: "P",
      shiftKey: true,
      modPressed: true,
    }),
    "action-picker",
  );
});

test("resolveModPShortcutAction returns null when mod is not pressed", () => {
  assert.equal(
    resolveModPShortcutAction({
      defaultPrevented: false,
      key: "p",
      shiftKey: false,
      modPressed: false,
    }),
    null,
  );
});

test("resolveModBackslashSplitShortcutAction returns split-right for Mod+Backslash on conversation", () => {
  assert.equal(
    resolveModBackslashSplitShortcutAction(
      {
        defaultPrevented: false,
        shiftKey: false,
        altKey: false,
        code: "Backslash",
        target: { tagName: "DIV", closest: () => null },
        modPressed: true,
      },
      conversationContext,
    ),
    "split-right",
  );
});

test("resolveModBackslashSplitShortcutAction returns split-down for Mod+Shift+Backslash", () => {
  assert.equal(
    resolveModBackslashSplitShortcutAction(
      {
        defaultPrevented: false,
        shiftKey: true,
        altKey: false,
        code: "Backslash",
        target: { tagName: "DIV", closest: () => null },
        modPressed: true,
      },
      conversationContext,
    ),
    "split-down",
  );
});

test("resolveModBackslashSplitShortcutAction returns null outside conversation surface", () => {
  assert.equal(
    resolveModBackslashSplitShortcutAction(
      {
        defaultPrevented: false,
        shiftKey: false,
        altKey: false,
        code: "Backslash",
        target: { tagName: "DIV", closest: () => null },
        modPressed: true,
      },
      { activeSurface: "settings" },
    ),
    null,
  );
});

test("shouldTriggerConversationAbortShortcut accepts physical Ctrl+C on conversation surface", () => {
  assert.equal(
    shouldTriggerConversationAbortShortcut(
      {
        defaultPrevented: false,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: "KeyC",
        key: "c",
        target: { tagName: "DIV", closest: () => null },
      },
      conversationContext,
    ),
    true,
  );
});

test("shouldTriggerConversationAbortShortcut rejects when not on conversation surface", () => {
  assert.equal(
    shouldTriggerConversationAbortShortcut(
      {
        defaultPrevented: false,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: "KeyC",
        key: "c",
        target: null,
      },
      { ...conversationContext, activeSurface: "settings" },
    ),
    false,
  );
});

test("shouldTriggerConversationAbortShortcut rejects Cmd+C (meta without ctrl-only path)", () => {
  assert.equal(
    shouldTriggerConversationAbortShortcut(
      {
        defaultPrevented: false,
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
        code: "KeyC",
        key: "c",
        target: null,
      },
      conversationContext,
    ),
    false,
  );
});

test("shouldTriggerConversationAbortShortcut rejects textarea targets", () => {
  assert.equal(
    shouldTriggerConversationAbortShortcut(
      {
        defaultPrevented: false,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: "KeyC",
        key: "c",
        target: { tagName: "TEXTAREA", closest: () => null },
      },
      conversationContext,
    ),
    false,
  );
});

test("shouldTriggerConversationAbortShortcut rejects xterm targets", () => {
  assert.equal(
    shouldTriggerConversationAbortShortcut(
      {
        defaultPrevented: false,
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: "KeyC",
        key: "c",
        target: {
          tagName: "DIV",
          closest: (selector) => (selector.includes("xterm") ? {} : null),
        },
      },
      conversationContext,
    ),
    false,
  );
});

test("resolveModCommaSettingsShortcutAction opens settings from conversation", () => {
  assert.equal(
    resolveModCommaSettingsShortcutAction(
      {
        defaultPrevented: false,
        key: ",",
        shiftKey: false,
        altKey: false,
        modPressed: true,
        target: { tagName: "DIV" },
      },
      { activeSurface: "conversation" },
    ),
    "open-settings",
  );
});

test("resolveModCommaSettingsShortcutAction ignores when already on settings", () => {
  assert.equal(
    resolveModCommaSettingsShortcutAction(
      {
        defaultPrevented: false,
        key: ",",
        shiftKey: false,
        altKey: false,
        modPressed: true,
        target: { tagName: "DIV" },
      },
      { activeSurface: "settings" },
    ),
    null,
  );
});

test("resolveModCommaSettingsShortcutAction ignores textarea targets", () => {
  assert.equal(
    resolveModCommaSettingsShortcutAction(
      {
        defaultPrevented: false,
        key: ",",
        shiftKey: false,
        altKey: false,
        modPressed: true,
        target: { tagName: "TEXTAREA" },
      },
      { activeSurface: "conversation" },
    ),
    null,
  );
});

test("shouldTriggerSettingsEscapeShortcut accepts escape on settings surface", () => {
  assert.equal(
    shouldTriggerSettingsEscapeShortcut(
      {
        defaultPrevented: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: "Escape",
        key: "Escape",
        target: { tagName: "DIV", isContentEditable: false, closest: () => null },
      },
      { activeSurface: "settings" },
    ),
    true,
  );
});

test("shouldTriggerSettingsEscapeShortcut rejects non-settings surface", () => {
  assert.equal(
    shouldTriggerSettingsEscapeShortcut(
      {
        defaultPrevented: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: "Escape",
        key: "Escape",
        target: null,
      },
      { activeSurface: "conversation" },
    ),
    false,
  );
});

test("shouldTriggerSettingsEscapeShortcut rejects textarea targets", () => {
  assert.equal(
    shouldTriggerSettingsEscapeShortcut(
      {
        defaultPrevented: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        code: "Escape",
        key: "Escape",
        target: { tagName: "TEXTAREA", isContentEditable: false, closest: () => null },
      },
      { activeSurface: "settings" },
    ),
    false,
  );
});

test("shouldTriggerSettingsEscapeShortcut rejects when a Radix dialog is open", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector: (selector) =>
      selector.includes('data-slot="dialog-content"][data-open') ? {} : null,
  };
  try {
    assert.equal(
      shouldTriggerSettingsEscapeShortcut(
        {
          defaultPrevented: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          code: "Escape",
          key: "Escape",
          target: { tagName: "DIV", isContentEditable: false, closest: () => null },
        },
        { activeSurface: "settings" },
      ),
      false,
    );
  } finally {
    globalThis.document = previousDocument;
  }
});

test("resolveModTNewToolTabShortcutAction returns open-new-tool-tab on conversation surface", () => {
  assert.equal(
    resolveModTNewToolTabShortcutAction(
      {
        defaultPrevented: false,
        key: "t",
        shiftKey: false,
        altKey: false,
        modPressed: true,
      },
      { activeSurface: "conversation" },
    ),
    "open-new-tool-tab",
  );
});

test("resolveModTNewToolTabShortcutAction returns null outside conversation surface", () => {
  assert.equal(
    resolveModTNewToolTabShortcutAction(
      {
        defaultPrevented: false,
        key: "t",
        shiftKey: false,
        altKey: false,
        modPressed: true,
      },
      { activeSurface: "settings" },
    ),
    null,
  );
});

test("resolveModTNewToolTabShortcutAction ignores shift and alt modifiers", () => {
  assert.equal(
    resolveModTNewToolTabShortcutAction(
      {
        defaultPrevented: false,
        key: "t",
        shiftKey: true,
        altKey: false,
        modPressed: true,
      },
      { activeSurface: "conversation" },
    ),
    null,
  );
  assert.equal(
    resolveModTNewToolTabShortcutAction(
      {
        defaultPrevented: false,
        key: "t",
        shiftKey: false,
        altKey: true,
        modPressed: true,
      },
      { activeSurface: "conversation" },
    ),
    null,
  );
});

const panelSurfaceSelector = '[data-spirit-surface="workspace-panel"]';

function digitEvent(overrides = {}) {
  return {
    defaultPrevented: false,
    shiftKey: false,
    altKey: false,
    code: "Digit1",
    modPressed: true,
    target: { tagName: "DIV", closest: () => null },
    ...overrides,
  };
}

function targetClosest(matchedSelector) {
  return {
    tagName: "DIV",
    closest: (selector) => (selector === matchedSelector ? {} : null),
  };
}

test("parseModDigitIndex returns 1 and 9 for Digit1 and Digit9", () => {
  assert.equal(parseModDigitIndex(digitEvent({ code: "Digit1" })), 1);
  assert.equal(parseModDigitIndex(digitEvent({ code: "Digit9" })), 9);
});

test("parseModDigitIndex returns null for Digit0, missing mod, shift, and alt", () => {
  assert.equal(parseModDigitIndex(digitEvent({ code: "Digit0" })), null);
  assert.equal(parseModDigitIndex(digitEvent({ modPressed: false })), null);
  assert.equal(parseModDigitIndex(digitEvent({ shiftKey: true })), null);
  assert.equal(parseModDigitIndex(digitEvent({ altKey: true })), null);
});

test("resolveModDigitShortcutAction routes to session outside the workspace panel", () => {
  assert.equal(
    resolveModDigitShortcutAction(digitEvent(), { workspaceToolsOpen: true }),
    "session",
  );
  assert.equal(
    resolveModDigitShortcutAction(digitEvent(), { workspaceToolsOpen: false }),
    "session",
  );
});

test("resolveModDigitShortcutAction routes to tab when focus is in an open workspace panel", () => {
  assert.equal(
    resolveModDigitShortcutAction(digitEvent({ target: targetClosest(panelSurfaceSelector) }), {
      workspaceToolsOpen: true,
    }),
    "tab",
  );
});

test("resolveModDigitShortcutAction stays on session when the workspace panel is closed", () => {
  assert.equal(
    resolveModDigitShortcutAction(digitEvent({ target: targetClosest(panelSurfaceSelector) }), {
      workspaceToolsOpen: false,
    }),
    "session",
  );
});

test("resolveModDigitShortcutAction treats workspace-dock focus as session", () => {
  assert.equal(
    resolveModDigitShortcutAction(
      digitEvent({ target: targetClosest('[data-spirit-surface="workspace-dock"]') }),
      { workspaceToolsOpen: true },
    ),
    "session",
  );
});

test("resolveModDigitShortcutAction still fires when an INPUT is focused", () => {
  assert.equal(
    resolveModDigitShortcutAction(
      digitEvent({ target: { tagName: "INPUT", closest: () => null } }),
      { workspaceToolsOpen: false },
    ),
    "session",
  );
});

