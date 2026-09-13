import {
  DEFAULT_TRANSLUCENCY,
  isContentTranslucencyEnabled,
  isNativeTranslucencyEnabled,
  parseTranslucencyPreference,
  type TranslucencyPreference,
} from "@/lib/translucency";

/** Current Desktop Electron host platform; `undefined` on Web or when preload was not injected. */
export function desktopShellPlatform(): NodeJS.Platform | undefined {
  return typeof window !== "undefined" ? window.spiritDesktop?.platform : undefined;
}

export function isNativeTranslucencyPlatform(
  platform: NodeJS.Platform | undefined,
): platform is "win32" | "darwin" {
  return platform === "win32" || platform === "darwin";
}

/** Whether native window-level translucent materials such as Windows Mica / macOS Vibrancy are available. */
export function isNativeTranslucencySupported(): boolean {
  return isNativeTranslucencyPlatform(desktopShellPlatform());
}

/** True only in the Spirit Electron window (preload injects `window.spiritDesktop`). */
export function isElectronChrome(): boolean {
  return typeof window !== "undefined" && Boolean(window.spiritDesktop);
}

/** Aligned with Electron's `readTranslucencyFromDisk`; used to avoid wrongly enabling the translucency transparent layer before the first-paint snapshot is ready. */
export function readStoredTranslucencyPreference(): TranslucencyPreference {
  if (!isNativeTranslucencySupported()) {
    return "off";
  }
  try {
    return parseTranslucencyPreference(window.spiritDesktop?.readTranslucency());
  } catch {
    return DEFAULT_TRANSLUCENCY;
  }
}

export function readStoredTranslucency(): boolean {
  return isNativeTranslucencyEnabled(readStoredTranslucencyPreference());
}

export function resolveTranslucencyPreference(
  translucency: TranslucencyPreference | undefined,
): TranslucencyPreference {
  if (!isNativeTranslucencySupported()) {
    return "off";
  }
  if (translucency === undefined) {
    return readStoredTranslucencyPreference();
  }
  return parseTranslucencyPreference(translucency);
}

export function resolveUseTranslucency(translucency: TranslucencyPreference | undefined): boolean {
  return isNativeTranslucencyEnabled(resolveTranslucencyPreference(translucency));
}

export function resolveUseContentTranslucency(
  translucency: TranslucencyPreference | undefined,
): boolean {
  return isContentTranslucencyEnabled(resolveTranslucencyPreference(translucency));
}

/**
 * Aligned with Electron's `readOnboardingCompletedFromDisk`.
 * `undefined` means the sync API is missing (Web): keep the snapshot gate so the settings default
 * `onboardingCompleted: false` cannot flash OOBE for returning users.
 */
export function readStoredOnboardingCompleted(): boolean | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const read = window.spiritDesktop?.readOnboardingCompleted;
    if (typeof read !== "function") {
      return undefined;
    }
    return read() === true;
  } catch {
    return undefined;
  }
}

/** Writes the Desktop native shell classes before first paint, so the launch layer never uses translucency transparent styles before the snapshot is ready. */
export function applyDesktopNativeChromeToDocument(): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  const native = isElectronChrome();
  const translucencyOn = native && readStoredTranslucency();
  root.classList.toggle("spirit-desktop-native", native);
  root.classList.toggle("spirit-desktop-translucency", translucencyOn);
  // Synced with LaunchSplash: mark the launch layer (including hiding the custom title bar) on the very first frame, so the Menubar is never exposed before useEffect runs.
  root.classList.toggle("spirit-launch-splash-active", native);
}

export type ShellOverlayPhase = "running" | "leaving" | "gone";

/** Syncs the fullscreen overlay (LaunchSplash / OOBE) phase to the html class (called from a single point in App based on both overlay phases; components must not call it themselves, to avoid cleanup races). */
export function syncLaunchSplashChromeToDocument(phase: ShellOverlayPhase): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (phase === "gone") {
    root.classList.remove("spirit-launch-splash-active", "spirit-launch-splash-exiting");
    return;
  }
  root.classList.add("spirit-launch-splash-active");
  root.classList.toggle("spirit-launch-splash-exiting", phase === "leaving");
}

/**
 * iPhone / iPad / iPod, including iPadOS 13+ which spoofs a Macintosh desktop UA.
 * Distinguished from macOS by `maxTouchPoints`: macOS browsers report 0 even with a
 * trackpad, while iPad reports a multi-touch screen.
 */
function isIosOrIpadOsNavigator(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return true;
  }
  return /Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1;
}

/** Web fallback when Electron preload did not inject a platform: macOS desktop only. */
function isMacOsDesktopNavigator(): boolean {
  if (typeof navigator === "undefined" || isIosOrIpadOsNavigator()) {
    return false;
  }
  if (/Mac/i.test(navigator.platform)) {
    return true;
  }
  return /Macintosh|Mac OS X/i.test(navigator.userAgent);
}

/**
 * Whether the current host is macOS desktop (not iOS / iPadOS).
 * Prefers Electron preload `platform === "darwin"`; when preload is absent (Web),
 * falls back to `navigator.platform` / UA and rejects iPhone, iPad, and iPadOS 13+
 * desktop-mode Macintosh UA.
 */
export function isMacDesktopPlatform(): boolean {
  const platform = desktopShellPlatform();
  if (platform !== undefined) {
    return platform === "darwin";
  }
  return isMacOsDesktopNavigator();
}

/**
 * Formats a shortcut label for the current platform.
 * - macOS desktop: `mod` → `⌘`, joined without a separator (e.g. `⌘N`)
 * - Windows / Linux / iOS / iPadOS: `mod` → `Ctrl`, joined with `+` (e.g. `Ctrl+N`)
 */
export function shortcutLabel(key: string): string {
  const letter = key.toUpperCase();
  return isMacDesktopPlatform() ? `⌘${letter}` : `Ctrl+${letter}`;
}

/** Physical Ctrl + letter shortcut keys for tooltip Kbd chips (not Cmd on macOS). */
export function ctrlLetterShortcutKbdKeys(key: string): readonly string[] {
  const letter = key.toUpperCase();
  return isMacDesktopPlatform() ? ["⌃", letter] : ["Ctrl", letter];
}

/** Cmd/Ctrl + letter shortcut keys for tooltip Kbd chips. */
export function modLetterShortcutKbdKeys(key: string): readonly string[] {
  const letter = key.toUpperCase();
  return isMacDesktopPlatform() ? ["⌘", letter] : ["Ctrl", letter];
}

/** Alt+Cmd / Ctrl+Alt + letter shortcut keys for tooltip Kbd chips. */
export function modAltLetterShortcutKbdKeys(key: string): readonly string[] {
  const letter = key.toUpperCase();
  return isMacDesktopPlatform() ? ["⌥", "⌘", letter] : ["Ctrl", "Alt", letter];
}

/** Cmd/Ctrl + / shortcut keys for tooltip Kbd chips. */
export function modSlashShortcutKbdKeys(): readonly string[] {
  return isMacDesktopPlatform() ? ["⌘", "/"] : ["Ctrl", "/"];
}

/** Cmd/Ctrl + / shortcut label for the model picker. */
export function modSlashShortcutLabel(): string {
  const keys = modSlashShortcutKbdKeys();
  return isMacDesktopPlatform() ? keys.join("") : keys.join("+");
}

/** Cmd/Ctrl + , shortcut keys for tooltip Kbd chips. */
export function modCommaShortcutKbdKeys(): readonly string[] {
  return isMacDesktopPlatform() ? ["⌘", ","] : ["Ctrl", ","];
}

/** Cmd/Ctrl + , shortcut label for opening settings. */
export function settingsShortcutLabel(): string {
  const keys = modCommaShortcutKbdKeys();
  return isMacDesktopPlatform() ? keys.join("") : keys.join("+");
}

/** Cmd/Ctrl + \\ shortcut keys for tooltip Kbd chips. */
export function modBackslashShortcutKbdKeys(): readonly string[] {
  return isMacDesktopPlatform() ? ["⌘", "\\"] : ["Ctrl", "\\"];
}

/** Cmd/Ctrl + Shift + \\ shortcut keys for tooltip Kbd chips. */
export function modShiftBackslashShortcutKbdKeys(): readonly string[] {
  return isMacDesktopPlatform() ? ["⌘", "⇧", "\\"] : ["Ctrl", "Shift", "\\"];
}

/** Cmd/Ctrl + \\ shortcut label for split-right. */
export function modBackslashShortcutLabel(): string {
  const keys = modBackslashShortcutKbdKeys();
  return isMacDesktopPlatform() ? keys.join("") : keys.join("+");
}

/** Cmd/Ctrl + Shift + \\ shortcut label for split-down. */
export function modShiftBackslashShortcutLabel(): string {
  const keys = modShiftBackslashShortcutKbdKeys();
  return isMacDesktopPlatform() ? keys.join("") : keys.join("+");
}

type KeyboardModifierState = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey">;

/** Whether the platform primary shortcut modifier (⌘ on macOS desktop, Ctrl elsewhere) is held. */
export function isModShortcutPressed(event: KeyboardModifierState): boolean {
  return isMacDesktopPlatform() ? event.metaKey : event.ctrlKey;
}

/** Whether Alt + primary shortcut modifier is held (⌥⌘ on macOS, Ctrl+Alt elsewhere). */
export function isModAltShortcutPressed(event: KeyboardModifierState): boolean {
  if (!event.altKey) {
    return false;
  }
  return isModShortcutPressed(event);
}

/** Windows Electron: uses `titleBarOverlay` + a custom-drawn title bar; macOS keeps the system menu bar */
export function isWin32ElectronShell(): boolean {
  if (!isElectronChrome() || typeof navigator === "undefined") {
    return false;
  }
  return /Windows/i.test(navigator.userAgent);
}

/** macOS Electron: `titleBarStyle: hiddenInset`, so a traffic-light safe area must be reserved */
export function isDarwinElectronShell(): boolean {
  if (!isElectronChrome()) {
    return false;
  }
  return window.spiritDesktop?.platform === "darwin";
}
