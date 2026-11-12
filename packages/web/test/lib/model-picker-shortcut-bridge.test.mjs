import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import {
  notifyModelPickerFocused,
  registerModelPicker,
  resetModelPickerShortcutBridgeForTests,
  resolveModelPickerToOpen,
} from "../../src/lib/model-picker-shortcut-bridge.ts";

function installDomStubs() {
  const previousDocument = globalThis.document;
  const previousGetComputedStyle = globalThis.getComputedStyle;

  globalThis.getComputedStyle = () => ({
    display: "block",
    visibility: "visible",
  });
  globalThis.document = {
    activeElement: null,
  };

  return () => {
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousGetComputedStyle;
  };
}

function createVisibleRoot(options = {}) {
  const { containsActive = false, visible = true } = options;
  const root = {
    isConnected: true,
    contains(node) {
      return containsActive && node === globalThis.document.activeElement;
    },
    getBoundingClientRect() {
      return visible ? { width: 120, height: 28 } : { width: 0, height: 0 };
    },
  };
  return root;
}

afterEach(() => {
  resetModelPickerShortcutBridgeForTests();
});

test("resolveModelPickerToOpen prefers picker containing active element", () => {
  const restoreDom = installDomStubs();
  try {
    const focusedButton = { tag: "button" };
    globalThis.document.activeElement = focusedButton;

    const focusedId = registerModelPicker({
      open: () => {},
      getRoot: () => createVisibleRoot({ containsActive: true }),
    });
    registerModelPicker({
      open: () => {},
      getRoot: () => createVisibleRoot(),
    });

    notifyModelPickerFocused(focusedId);
    const resolved = resolveModelPickerToOpen();
    assert.equal(resolved?.getRoot()?.contains(focusedButton), true);
  } finally {
    restoreDom();
  }
});

test("resolveModelPickerToOpen falls back to last focused picker", () => {
  const restoreDom = installDomStubs();
  try {
    globalThis.document.activeElement = null;
    const opened = [];

    const firstId = registerModelPicker({
      open: () => opened.push("first"),
      getRoot: () => createVisibleRoot(),
    });
    const secondId = registerModelPicker({
      open: () => opened.push("second"),
      getRoot: () => createVisibleRoot(),
    });

    notifyModelPickerFocused(firstId);
    notifyModelPickerFocused(secondId);

    resolveModelPickerToOpen()?.open();
    assert.deepEqual(opened, ["second"]);
  } finally {
    restoreDom();
  }
});

test("resolveModelPickerToOpen opens sole visible picker", () => {
  const restoreDom = installDomStubs();
  try {
    globalThis.document.activeElement = null;
    let opened = false;
    registerModelPicker({
      open: () => {
        opened = true;
      },
      getRoot: () => createVisibleRoot(),
    });

    const resolved = resolveModelPickerToOpen();
    assert.ok(resolved);
    resolved.open();
    assert.equal(opened, true);
  } finally {
    restoreDom();
  }
});

test("resolveModelPickerToOpen returns null when multiple visible and unresolved", () => {
  const restoreDom = installDomStubs();
  try {
    globalThis.document.activeElement = null;
    registerModelPicker({
      open: () => {},
      getRoot: () => createVisibleRoot(),
    });
    registerModelPicker({
      open: () => {},
      getRoot: () => createVisibleRoot(),
    });

    assert.equal(resolveModelPickerToOpen(), null);
  } finally {
    restoreDom();
  }
});

test("resolveModelPickerToOpen ignores hidden pickers", () => {
  const restoreDom = installDomStubs();
  try {
    globalThis.document.activeElement = null;
    registerModelPicker({
      open: () => {},
      getRoot: () => createVisibleRoot({ visible: false }),
    });

    assert.equal(resolveModelPickerToOpen(), null);
  } finally {
    restoreDom();
  }
});
