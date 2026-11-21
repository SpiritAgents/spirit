import i18next from "i18next";
import { FALLBACK_LANGUAGE } from "@spiritagent/i18n";
import type { SpiritDesktopViewPageApi } from "@spiritagent/extension-toolkit/desktop-ui";
import { resources } from "../locales.js";

export const bridge = (window as unknown as { spirit: { view: SpiritDesktopViewPageApi } }).spirit;

export async function createPageI18n(locale: string) {
  const instance = i18next.createInstance();
  await instance.init({
    resources,
    lng: locale,
    fallbackLng: FALLBACK_LANGUAGE,
    interpolation: { escapeValue: false },
  });
  return instance;
}
