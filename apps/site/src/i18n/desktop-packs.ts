import desktopDe from "../../../../packages/i18n/src/locales/de.json";
import desktopEn from "../../../../packages/i18n/src/locales/en.json";
import desktopEs from "../../../../packages/i18n/src/locales/es.json";
import desktopFr from "../../../../packages/i18n/src/locales/fr.json";
import desktopJa from "../../../../packages/i18n/src/locales/ja.json";
import desktopKo from "../../../../packages/i18n/src/locales/ko.json";
import desktopPtBR from "../../../../packages/i18n/src/locales/pt-BR.json";
import desktopRu from "../../../../packages/i18n/src/locales/ru.json";
import desktopZhCN from "../../../../packages/i18n/src/locales/zh-CN.json";
import desktopZhTW from "../../../../packages/i18n/src/locales/zh-TW.json";

const DESKTOP_PACKS = {
  "en-US": desktopEn,
  "zh-CN": desktopZhCN,
  "zh-TW": desktopZhTW,
  ja: desktopJa,
  ko: desktopKo,
  de: desktopDe,
  fr: desktopFr,
  es: desktopEs,
  "pt-BR": desktopPtBR,
  ru: desktopRu,
} as const;

export function getDesktopPack(locale: string): Record<string, unknown> {
  if (locale in DESKTOP_PACKS) {
    return DESKTOP_PACKS[locale as keyof typeof DESKTOP_PACKS] as Record<string, unknown>;
  }
  return desktopEn as Record<string, unknown>;
}
