export type TranslucencyPreference = "off" | "sidebar" | "all";

export const DEFAULT_TRANSLUCENCY: TranslucencyPreference = "all";

export const TRANSLUCENCY_PREFERENCES = [
  "off",
  "sidebar",
  "all",
] as const satisfies ReadonlyArray<TranslucencyPreference>;

export function isTranslucencyPreference(value: unknown): value is TranslucencyPreference {
  return value === "off" || value === "sidebar" || value === "all";
}

/** Unknown or legacy values fall back to the default; no boolean mapping. */
export function parseTranslucencyPreference(value: unknown): TranslucencyPreference {
  return isTranslucencyPreference(value) ? value : DEFAULT_TRANSLUCENCY;
}

/** Native window material (Win Mica / macOS Vibrancy) is active. */
export function isNativeTranslucencyEnabled(pref: TranslucencyPreference): boolean {
  return pref !== "off";
}

/** Main-content / Composer surfaces use the All-mode translucent tints. */
export function isContentTranslucencyEnabled(pref: TranslucencyPreference): boolean {
  return pref === "all";
}
