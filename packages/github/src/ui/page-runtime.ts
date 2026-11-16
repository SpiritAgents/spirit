import i18next from "i18next";
import { resources, FALLBACK_LANGUAGE } from "@spiritagent/i18n";
import type {
  SpiritDesktopTabPageApi,
  SpiritDesktopViewPageApi,
} from "@spiritagent/extension-toolkit/desktop-ui";
export const bridge = (
  window as unknown as { spirit: { tab: SpiritDesktopTabPageApi; view: SpiritDesktopViewPageApi } }
).spirit;
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
