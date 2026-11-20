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

const developmentLocalesDirectory =
  typeof process !== "undefined" && process.versions?.node
    ? process.env.SPIRIT_DEV_I18N_LOCALES_DIR
    : undefined;
if (developmentLocalesDirectory) {
  // This host entry is also imported by a few browser-safe modules. Keep the
  // Node-only watcher out of their Vite module graph; production hosts resolve
  // the compiled helper only when the development directory is explicitly set.
  const developmentLocalesModule = "./development-locales.js";
  void import(/* @vite-ignore */ developmentLocalesModule).then(({ watchDevelopmentLocales }) =>
    watchDevelopmentLocales(instance, developmentLocalesDirectory),
  );
}

export default instance;
