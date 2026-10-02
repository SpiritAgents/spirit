import i18n from "i18next";
import { product } from "@spiritagent/product";

import de from "../locales/de.json" with { type: "json" };
import en from "../locales/en.json" with { type: "json" };
import es from "../locales/es.json" with { type: "json" };
import fr from "../locales/fr.json" with { type: "json" };
import ja from "../locales/ja.json" with { type: "json" };
import ko from "../locales/ko.json" with { type: "json" };
import ptBR from "../locales/pt-BR.json" with { type: "json" };
import ru from "../locales/ru.json" with { type: "json" };
import zhCN from "../locales/zh-CN.json" with { type: "json" };
import zhTW from "../locales/zh-TW.json" with { type: "json" };
import { detectSystemLanguage, FALLBACK_LANGUAGE } from "./ui-locale.js";

const resources = {
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
};

const instance = i18n.createInstance();

instance.init({
  resources,
  lng: detectSystemLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: {
    escapeValue: false,
    defaultVariables: { product },
  },
});

export default instance;
