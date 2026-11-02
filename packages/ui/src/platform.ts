/** Platform detection for keyboard shortcut presentation; renderer-safe, no host imports. */

function isIosOrIpadOsNavigator(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return true;
  }
  return /Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1;
}

/** macOS desktop via `navigator.platform` / UA, rejecting iPhone, iPad, and iPadOS 13+ desktop-mode Macintosh UA. */
export function isMacNavigatorPlatform(): boolean {
  if (typeof navigator === "undefined" || isIosOrIpadOsNavigator()) {
    return false;
  }
  if (/Mac/i.test(navigator.platform)) {
    return true;
  }
  return /Macintosh|Mac OS X/i.test(navigator.userAgent);
}

/** Physical Ctrl + letter shortcut keys for tooltip Kbd chips (not Cmd on macOS). */
export function ctrlLetterShortcutKbdKeys(key: string): readonly string[] {
  const letter = key.toUpperCase();
  return isMacNavigatorPlatform() ? ["⌃", letter] : ["Ctrl", letter];
}

/** Cmd/Ctrl + letter shortcut keys for tooltip Kbd chips. */
export function modLetterShortcutKbdKeys(key: string): readonly string[] {
  const letter = key.toUpperCase();
  return isMacNavigatorPlatform() ? ["⌘", letter] : ["Ctrl", letter];
}

/** Cmd/Ctrl + / shortcut keys for tooltip Kbd chips. */
export function modSlashShortcutKbdKeys(): readonly string[] {
  return isMacNavigatorPlatform() ? ["⌘", "/"] : ["Ctrl", "/"];
}
