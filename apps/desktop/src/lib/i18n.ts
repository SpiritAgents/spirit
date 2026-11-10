import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { product } from "@spiritagent/product";

import { resources } from "@spiritagent/i18n/resources";
import {
  FALLBACK_LANGUAGE,
  isLanguagePreference,
  resolveUiLocalePreference,
  SYSTEM_LANGUAGE,
  type LanguagePreference,
  type ValidLanguage,
} from "@spiritagent/i18n/ui-locale";
import { flushDesktopRendererStorage } from "./desktop-renderer-storage";

export {
  FALLBACK_LANGUAGE,
  LANGUAGE_PREFERENCE_OPTIONS,
  LOCALE_LABEL_KEYS,
  SYSTEM_LANGUAGE,
  VALID_LANGUAGES,
  detectSystemLanguage,
  isLanguagePreference,
  isValidLanguage,
  resolveUiLocalePreference,
} from "@spiritagent/i18n/ui-locale";
export type { LanguagePreference, ValidLanguage } from "@spiritagent/i18n/ui-locale";

export const LANGUAGE_STORAGE_KEY = "spirit-desktop-language" as const;

export function getStoredLanguagePreference(): LanguagePreference {
  if (typeof localStorage === "undefined") {
    return SYSTEM_LANGUAGE;
  }
  const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (raw && isLanguagePreference(raw)) {
    return raw;
  }
  return SYSTEM_LANGUAGE;
}

export function getStoredLanguage(): ValidLanguage {
  return resolveUiLocalePreference(getStoredLanguagePreference());
}

export function setStoredLanguage(lang: string): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  flushDesktopRendererStorage();
}

function syncHostLanguage(lang: ValidLanguage): void {
  if (typeof window !== "undefined" && window.spiritDesktop) {
    window.spiritDesktop.syncLanguage?.(lang).catch(() => {
      // ignore IPC errors
    });
  }
}

async function applyResolvedLanguage(preference: LanguagePreference): Promise<ValidLanguage> {
  const resolved = resolveUiLocalePreference(preference);
  await i18n.changeLanguage(resolved);
  syncHostLanguage(resolved);
  return resolved;
}

export async function changeLanguage(lang: string): Promise<void> {
  if (!isLanguagePreference(lang)) {
    return;
  }
  setStoredLanguage(lang);
  await applyResolvedLanguage(lang);
}

i18n.use(initReactI18next).init({
  resources,
  lng: getStoredLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: {
    escapeValue: false,
    defaultVariables: { product },
  },
});

if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    if (getStoredLanguagePreference() === SYSTEM_LANGUAGE) {
      void applyResolvedLanguage(SYSTEM_LANGUAGE);
    }
  });
}

export default i18n;
