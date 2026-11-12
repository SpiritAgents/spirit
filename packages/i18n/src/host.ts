import i18n from "i18next";
import { product } from "@spiritagent/product";

import { resources } from "./resources.js";
import { detectSystemLanguage, FALLBACK_LANGUAGE } from "./ui-locale.js";

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
