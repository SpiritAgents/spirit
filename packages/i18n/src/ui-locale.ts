export const SYSTEM_LANGUAGE = "system" as const;
/** Used when the OS locale is unsupported, and as i18next `fallbackLng`. */
export const FALLBACK_LANGUAGE = "en" as const;

export const VALID_LANGUAGES = [
  "zh-CN",
  "en",
  "zh-TW",
  "ja",
  "ko",
  "de",
  "fr",
  "es",
  "pt-BR",
  "ru",
] as const;

export type ValidLanguage = (typeof VALID_LANGUAGES)[number];
export type LanguagePreference = typeof SYSTEM_LANGUAGE | ValidLanguage;

export const LANGUAGE_PREFERENCE_OPTIONS: readonly LanguagePreference[] = [
  SYSTEM_LANGUAGE,
  ...VALID_LANGUAGES,
];

export const LOCALE_LABEL_KEYS: Record<LanguagePreference, string> = {
  system: "settings.langSystem",
  "zh-CN": "settings.langZhCN",
  en: "settings.langEn",
  "zh-TW": "settings.langZhTW",
  ja: "settings.langJa",
  ko: "settings.langKo",
  de: "settings.langDe",
  fr: "settings.langFr",
  es: "settings.langEs",
  "pt-BR": "settings.langPtBR",
  ru: "settings.langRu",
};

export function isValidLanguage(v: string): v is ValidLanguage {
  return VALID_LANGUAGES.includes(v as ValidLanguage);
}

export function isLanguagePreference(v: string): v is LanguagePreference {
  return v === SYSTEM_LANGUAGE || isValidLanguage(v);
}

export function matchLocaleTag(tag: string): ValidLanguage | undefined {
  const normalized = tag.trim().replace(/_/g, "-");
  if (!normalized) {
    return undefined;
  }
  if (isValidLanguage(normalized)) {
    return normalized;
  }

  const lower = normalized.toLowerCase();
  const exact = VALID_LANGUAGES.find((lang) => lang.toLowerCase() === lower);
  if (exact) {
    return exact;
  }
  if (
    lower.startsWith("zh-hant") ||
    lower.startsWith("zh-tw") ||
    lower.startsWith("zh-hk") ||
    lower.startsWith("zh-mo")
  ) {
    return "zh-TW";
  }
  if (lower.startsWith("zh")) {
    return "zh-CN";
  }
  if (lower.startsWith("pt-br")) {
    return "pt-BR";
  }

  const primary = normalized.split("-")[0];
  if (primary && isValidLanguage(primary)) {
    return primary;
  }
  return undefined;
}

type NavigatorLanguageTags = {
  language?: string;
  languages?: readonly string[];
};

export function collectDefaultLanguageTags(): string[] {
  const tags: string[] = [];
  const navigatorLike = (globalThis as { navigator?: NavigatorLanguageTags }).navigator;
  if (navigatorLike) {
    if (Array.isArray(navigatorLike.languages)) {
      tags.push(...navigatorLike.languages);
    }
    if (typeof navigatorLike.language === "string" && navigatorLike.language) {
      tags.push(navigatorLike.language);
    }
  }
  if (typeof process !== "undefined" && process.env) {
    for (const key of ["LC_ALL", "LC_MESSAGES", "LANG"] as const) {
      const value = process.env[key];
      if (typeof value === "string" && value.trim()) {
        const tag = value.trim().split(".")[0]?.replace(/_/g, "-");
        if (tag) {
          tags.push(tag);
        }
      }
    }
  }
  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale) {
      tags.push(intlLocale);
    }
  } catch {
    // Intl may be unavailable in some test/host shims
  }
  return tags;
}

export function detectSystemLanguage(tags?: readonly string[]): ValidLanguage {
  const candidates = tags ?? collectDefaultLanguageTags();
  for (const tag of candidates) {
    const matched = matchLocaleTag(tag);
    if (matched) {
      return matched;
    }
  }
  return FALLBACK_LANGUAGE;
}

/** Resolves a stored UI-language preference to an installed locale pack. */
export function resolveUiLocalePreference(
  preference: string | undefined,
  tags?: readonly string[],
): ValidLanguage {
  if (preference && isValidLanguage(preference)) {
    return preference;
  }
  return detectSystemLanguage(tags);
}
