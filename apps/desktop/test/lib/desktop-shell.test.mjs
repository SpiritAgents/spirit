import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ctrlLetterShortcutKbdKeys,
  isMacDesktopPlatform,
  isModAltShortcutPressed,
  isModShortcutPressed,
  isNativeTranslucencySupported,
  modAltLetterShortcutKbdKeys,
  modBackslashShortcutKbdKeys,
  modBackslashShortcutLabel,
  modCommaShortcutKbdKeys,
  modLetterShortcutKbdKeys,
  modShiftBackslashShortcutKbdKeys,
  modShiftBackslashShortcutLabel,
  modSlashShortcutKbdKeys,
  modSlashShortcutLabel,
  settingsShortcutLabel,
  shortcutLabel,
} from "../../src/lib/desktop-shell.ts";

function withDesktopPlatform(platform, run) {
  const previousWindow = globalThis.window;
  globalThis.window = {
    spiritDesktop: { platform },
  };
  try {
    run();
  } finally {
    globalThis.window = previousWindow;
  }
}

function withWebNavigator(navigator, run) {
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.window = {};
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    enumerable: true,
    value: navigator,
    writable: true,
  });
  try {
    return run();
  } finally {
    globalThis.window = previousWindow;
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
}

test("isMacDesktopPlatform prefers Electron preload and treats only darwin as macOS desktop", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(isMacDesktopPlatform(), true);
  });
  withDesktopPlatform("win32", () => {
    assert.equal(isMacDesktopPlatform(), false);
  });
  withDesktopPlatform("linux", () => {
    assert.equal(isMacDesktopPlatform(), false);
  });
});

test("isMacDesktopPlatform falls back to Web macOS desktop and rejects iOS / iPadOS / Windows", () => {
  withWebNavigator(
    {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      maxTouchPoints: 0,
    },
    () => {
      assert.equal(isMacDesktopPlatform(), true);
    },
  );
  withWebNavigator(
    {
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      maxTouchPoints: 0,
    },
    () => {
      assert.equal(isMacDesktopPlatform(), false);
    },
  );
  withWebNavigator(
    {
      platform: "iPhone",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      maxTouchPoints: 5,
    },
    () => {
      assert.equal(isMacDesktopPlatform(), false);
    },
  );
  withWebNavigator(
    {
      platform: "iPad",
      userAgent: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)",
      maxTouchPoints: 5,
    },
    () => {
      assert.equal(isMacDesktopPlatform(), false);
    },
  );
  withWebNavigator(
    {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      maxTouchPoints: 5,
    },
    () => {
      assert.equal(isMacDesktopPlatform(), false);
    },
  );
});

test("isNativeTranslucencySupported stays false on Web even on macOS desktop", () => {
  withWebNavigator(
    {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      maxTouchPoints: 0,
    },
    () => {
      assert.equal(isNativeTranslucencySupported(), false);
    },
  );
  withDesktopPlatform("darwin", () => {
    assert.equal(isNativeTranslucencySupported(), true);
  });
});

test("shortcutLabel formats letter shortcuts per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(shortcutLabel("n"), "⌘N");
  });
  withDesktopPlatform("win32", () => {
    assert.equal(shortcutLabel("n"), "Ctrl+N");
  });
});

test("ctrlLetterShortcutKbdKeys returns physical Control letter shortcut chips per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.deepEqual(ctrlLetterShortcutKbdKeys("c"), ["⌃", "C"]);
  });
  withDesktopPlatform("win32", () => {
    assert.deepEqual(ctrlLetterShortcutKbdKeys("c"), ["Ctrl", "C"]);
  });
  withDesktopPlatform("linux", () => {
    assert.deepEqual(ctrlLetterShortcutKbdKeys("c"), ["Ctrl", "C"]);
  });
});

test("modLetterShortcutKbdKeys returns letter shortcut chips per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.deepEqual(modLetterShortcutKbdKeys("b"), ["⌘", "B"]);
  });
  withDesktopPlatform("win32", () => {
    assert.deepEqual(modLetterShortcutKbdKeys("b"), ["Ctrl", "B"]);
  });
  withDesktopPlatform("linux", () => {
    assert.deepEqual(modLetterShortcutKbdKeys("b"), ["Ctrl", "B"]);
  });
});

test("modAltLetterShortcutKbdKeys returns alt-mod letter shortcut chips per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.deepEqual(modAltLetterShortcutKbdKeys("b"), ["⌥", "⌘", "B"]);
  });
  withDesktopPlatform("win32", () => {
    assert.deepEqual(modAltLetterShortcutKbdKeys("b"), ["Ctrl", "Alt", "B"]);
  });
  withDesktopPlatform("linux", () => {
    assert.deepEqual(modAltLetterShortcutKbdKeys("b"), ["Ctrl", "Alt", "B"]);
  });
});

test("modSlashShortcutKbdKeys returns slash shortcut chips per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.deepEqual(modSlashShortcutKbdKeys(), ["⌘", "/"]);
  });
  withDesktopPlatform("win32", () => {
    assert.deepEqual(modSlashShortcutKbdKeys(), ["Ctrl", "/"]);
  });
  withDesktopPlatform("linux", () => {
    assert.deepEqual(modSlashShortcutKbdKeys(), ["Ctrl", "/"]);
  });
});

test("modSlashShortcutLabel formats slash shortcut per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(modSlashShortcutLabel(), "⌘/");
  });
  withDesktopPlatform("win32", () => {
    assert.equal(modSlashShortcutLabel(), "Ctrl+/");
  });
  withDesktopPlatform("linux", () => {
    assert.equal(modSlashShortcutLabel(), "Ctrl+/");
  });
});

test("modCommaShortcutKbdKeys returns comma shortcut chips per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.deepEqual(modCommaShortcutKbdKeys(), ["⌘", ","]);
  });
  withDesktopPlatform("win32", () => {
    assert.deepEqual(modCommaShortcutKbdKeys(), ["Ctrl", ","]);
  });
  withDesktopPlatform("linux", () => {
    assert.deepEqual(modCommaShortcutKbdKeys(), ["Ctrl", ","]);
  });
});

test("settingsShortcutLabel formats comma shortcut per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(settingsShortcutLabel(), "⌘,");
  });
  withDesktopPlatform("win32", () => {
    assert.equal(settingsShortcutLabel(), "Ctrl+,");
  });
  withDesktopPlatform("linux", () => {
    assert.equal(settingsShortcutLabel(), "Ctrl+,");
  });
});

test("modShiftBackslashShortcutKbdKeys returns split-down shortcut chips per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.deepEqual(modShiftBackslashShortcutKbdKeys(), ["⌘", "⇧", "\\"]);
  });
  withDesktopPlatform("win32", () => {
    assert.deepEqual(modShiftBackslashShortcutKbdKeys(), ["Ctrl", "Shift", "\\"]);
  });
});

test("modBackslashShortcutKbdKeys returns split-right shortcut chips per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.deepEqual(modBackslashShortcutKbdKeys(), ["⌘", "\\"]);
  });
  withDesktopPlatform("win32", () => {
    assert.deepEqual(modBackslashShortcutKbdKeys(), ["Ctrl", "\\"]);
  });
});

test("modBackslashShortcutLabel formats split-right shortcut per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(modBackslashShortcutLabel(), "⌘\\");
  });
  withDesktopPlatform("win32", () => {
    assert.equal(modBackslashShortcutLabel(), "Ctrl+\\");
  });
});

test("modShiftBackslashShortcutLabel formats split-down shortcut per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(modShiftBackslashShortcutLabel(), "⌘⇧\\");
  });
  withDesktopPlatform("win32", () => {
    assert.equal(modShiftBackslashShortcutLabel(), "Ctrl+Shift+\\");
  });
});

test("isModShortcutPressed uses Command on macOS and Ctrl elsewhere", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(isModShortcutPressed({ altKey: false, ctrlKey: true, metaKey: false }), false);
    assert.equal(isModShortcutPressed({ altKey: false, ctrlKey: false, metaKey: true }), true);
  });
  withDesktopPlatform("win32", () => {
    assert.equal(isModShortcutPressed({ altKey: false, ctrlKey: true, metaKey: false }), true);
    assert.equal(isModShortcutPressed({ altKey: false, ctrlKey: false, metaKey: true }), false);
  });
});

test("isModAltShortcutPressed requires Alt plus the platform primary modifier", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(isModAltShortcutPressed({ altKey: true, ctrlKey: true, metaKey: false }), false);
    assert.equal(isModAltShortcutPressed({ altKey: true, ctrlKey: false, metaKey: true }), true);
  });
  withDesktopPlatform("win32", () => {
    assert.equal(isModAltShortcutPressed({ altKey: true, ctrlKey: true, metaKey: false }), true);
    assert.equal(isModAltShortcutPressed({ altKey: true, ctrlKey: false, metaKey: true }), false);
  });
});
