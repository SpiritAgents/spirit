import { flushDesktopRendererStorage } from "./desktop-renderer-storage";

export const THEME_STORAGE_KEY = "spirit-desktop-theme" as const;

export type ThemePreference = "system" | "light" | "dark";

const VALID: readonly ThemePreference[] = ["system", "light", "dark"];

function isThemePreference(v: string): v is ThemePreference {
  return (VALID as readonly string[]).includes(v);
}

export function getStoredTheme(): ThemePreference {
  if (typeof localStorage === "undefined") {
    return "system";
  }
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  if (raw && isThemePreference(raw)) {
    return raw;
  }
  return "system";
}

export function setStoredTheme(pref: ThemePreference): void {
  localStorage.setItem(THEME_STORAGE_KEY, pref);
  flushDesktopRendererStorage();
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  // In Electron, prefers-color-scheme follows nativeTheme.themeSource: while it is overridden to
  // light/dark, matchMedia misreports. Prefer synchronously reading the OS truth tracked by the main
  // process, so switching to system flips the correct class in the same frame.
  if (window.spiritDesktop) {
    return window.spiritDesktop.readOsPrefersDark();
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveDark(pref: ThemePreference): boolean {
  if (pref === "dark") {
    return true;
  }
  if (pref === "light") {
    return false;
  }
  return systemPrefersDark();
}

export function desktopNativeThemeForPreference(
  pref: ThemePreference,
): "light" | "dark" | "system" {
  if (pref === "system") {
    return "system";
  }
  if (pref === "dark") {
    return "dark";
  }
  return "light";
}

/** Held on `<html>` while theme tokens flip, so `transition-colors` etc. do not interpolate old → new. */
export const THEME_SWITCHING_CLASS = "spirit-theme-switching" as const;

let themeSwitchEpoch = 0;

function afterNextPaint(callback: () => void): void {
  const raf = globalThis.requestAnimationFrame?.bind(globalThis);
  if (typeof raf === "function") {
    raf(() => {
      raf(callback);
    });
    return;
  }
  globalThis.setTimeout(callback, 0);
}

function runWithoutCssTransitions(mutate: () => void): void {
  const root = document.documentElement;
  const epoch = ++themeSwitchEpoch;
  root.classList.add(THEME_SWITCHING_CLASS);
  mutate();
  // Flush the new tokens under transition:none so interpolation never starts.
  void root.offsetHeight;
  afterNextPaint(() => {
    if (epoch !== themeSwitchEpoch) {
      return;
    }
    root.classList.remove(THEME_SWITCHING_CLASS);
  });
}

function setDocumentDark(dark: boolean): void {
  const root = document.documentElement;
  const nextTheme = dark ? "dark" : "light";
  if (root.classList.contains("dark") === dark && root.dataset.spiritTheme === nextTheme) {
    return;
  }
  runWithoutCssTransitions(() => {
    root.classList.toggle("dark", dark);
    // data-spirit-theme is maintained directly at the document level (previously on the app-shell JSX):
    // avoids App subscribing to the theme context for this, which would re-render the whole tree on theme switches
    root.dataset.spiritTheme = nextTheme;
  });
}

export type ApplyThemeToDocumentOptions = {
  /** Under the system theme, syncs resolvedDark and other React subscribers after the IPC returns the OS truth. */
  onSystemDarkResolved?: (dark: boolean) => void;
};

/** Toggles the `dark` class on `document.documentElement`, matching the `.dark` variant of shadcn / tw-animate. */
export function applyThemeToDocument(
  pref: ThemePreference,
  options?: ApplyThemeToDocumentOptions,
): void {
  if (typeof document === "undefined") {
    return;
  }
  const dark = resolveDark(pref);
  setDocumentDark(dark);
  const nativeTheme = desktopNativeThemeForPreference(pref);
  syncDesktopWindowFrame(dark, nativeTheme, {
    translucency: document.documentElement.classList.contains("spirit-desktop-translucency"),
    // When switching back to system, the renderer's prefers-color-scheme still follows the old override, so resolveDark may compute wrongly;
    // the main process returns the real dark after themeSource takes effect, correcting the document here in one shot instead of waiting for an mq change to flip twice.
    onDarkCorrected: (realDark) => {
      if (getStoredTheme() !== pref) {
        return;
      }
      setDocumentDark(realDark);
    },
    onSystemDarkResolved: pref === "system" ? options?.onSystemDarkResolved : undefined,
  });
}

/** Aligned with Tauri `sync_tauri_frame_styling`: within the same IPC, set `nativeTheme.themeSource` first and then refresh the background, avoiding mismatch with the system theme. */
export function syncDesktopWindowFrame(
  dark: boolean,
  nativeTheme: "system" | "light" | "dark",
  options?: {
    translucency?: boolean;
    /** The main process returns the real dark after themeSource takes effect; called when it differs from the local computation. */
    onDarkCorrected?: (realDark: boolean) => void;
    /** Called after the IPC resolves when nativeTheme is system; syncs resolvedDark etc. */
    onSystemDarkResolved?: (realDark: boolean) => void;
  },
): void {
  if (typeof window === "undefined" || !window.spiritDesktop) {
    if (
      typeof navigator !== "undefined" &&
      /\bElectron\//.test(navigator.userAgent) &&
      import.meta.env.DEV
    ) {
      console.warn(
        "[spirit-desktop] no spiritDesktop preload bridge; window material IPC not sent (check preload and webPreferences)",
      );
    }
    return;
  }
  void window.spiritDesktop
    .syncWindowFrame({ dark, nativeTheme, translucency: options?.translucency })
    .then((realDark) => {
      if (nativeTheme === "system") {
        options?.onSystemDarkResolved?.(realDark);
      }
      if (realDark !== dark) {
        options?.onDarkCorrected?.(realDark);
      }
    })
    .catch((err) => {
      console.error("[spirit-desktop] syncWindowFrame IPC failed:", err);
    });
}
