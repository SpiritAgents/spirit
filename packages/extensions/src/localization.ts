import { matchLocaleTag } from "@spiritagent/i18n";
import {
  readExtensionMessage,
  type ExtensionLocalization,
  type LocalizableText,
} from "@spiritagent/extension-toolkit";

export function resolveExtensionLocalizationLocale(
  localization: ExtensionLocalization,
  locale: string | undefined,
): string {
  const matched = locale ? matchLocaleTag(locale) : undefined;
  return matched && localization.messages[matched] ? matched : localization.defaultLocale;
}

export function localizeExtensionText(
  localization: ExtensionLocalization,
  reference: LocalizableText,
  locale: string | undefined,
): string {
  return readExtensionMessage(
    localization,
    reference,
    resolveExtensionLocalizationLocale(localization, locale),
  );
}

export function resolveExtensionContextLocale(
  locale: string | (() => string) | undefined,
): string | undefined {
  return typeof locale === "function" ? locale() : locale;
}
