import { product } from "@spiritagent/product";

import { isValidLanguage, type ValidLanguage } from "./ui-locale.js";

/** Site docs locales match the desktop languages except English (en → en-US). */
const SITE_DOCS_LOCALE_BY_LANGUAGE: Record<ValidLanguage, string> = {
  "zh-CN": "zh-CN",
  en: "en-US",
  "zh-TW": "zh-TW",
  ja: "ja",
  ko: "ko",
  de: "de",
  fr: "fr",
  es: "es",
  "pt-BR": "pt-BR",
  ru: "ru",
};

const FALLBACK_SITE_DOCS_LOCALE = "en-US";

/**
 * Localized docs site URL for a docs path such as "/agent/tools#web_search".
 * Unknown or unsupported languages fall back to the en-US docs.
 */
export function siteDocsUrl(language: string, docsPath: string): string {
  const locale = isValidLanguage(language)
    ? SITE_DOCS_LOCALE_BY_LANGUAGE[language]
    : FALLBACK_SITE_DOCS_LOCALE;
  return `${product.websiteOrigin}/${locale}/docs${docsPath}`;
}
