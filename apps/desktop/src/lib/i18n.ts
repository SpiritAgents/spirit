import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import de from "../locales/de.json";
import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import ja from "../locales/ja.json";
import ko from "../locales/ko.json";
import ptBR from "../locales/pt-BR.json";
import ru from "../locales/ru.json";
import zhCN from "../locales/zh-CN.json";
import zhTW from "../locales/zh-TW.json";
import {
  FALLBACK_LANGUAGE,
  isLanguagePreference,
  resolveUiLocalePreference,
  SYSTEM_LANGUAGE,
  type LanguagePreference,
  type ValidLanguage,
} from "./ui-locale";
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
} from "./ui-locale";
export type { LanguagePreference, ValidLanguage } from "./ui-locale";

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
  resources: {
    "zh-CN": { translation: zhCN },
    en: { translation: en },
    "zh-TW": { translation: zhTW },
    ja: { translation: ja },
    ko: { translation: ko },
    de: { translation: de },
    fr: { translation: fr },
    es: { translation: es },
    "pt-BR": { translation: ptBR },
    ru: { translation: ru },
  },
  lng: getStoredLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: {
    escapeValue: false,
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
