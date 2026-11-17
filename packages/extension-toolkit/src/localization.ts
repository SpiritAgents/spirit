export interface LocalizableText {
  message: string;
}

export type ExtensionMessageCatalog = {
  [key: string]: string | ExtensionMessageCatalog;
};

export interface ExtensionLocalization {
  defaultLocale: string;
  messages: Record<string, ExtensionMessageCatalog>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLocalizableText(value: unknown, fieldName: string): LocalizableText {
  if (!isRecord(value) || typeof value.message !== "string" || !value.message.trim()) {
    throw new Error(`${fieldName} must be a message reference ({ message: "..." }).`);
  }
  if (Object.keys(value).some((key) => key !== "message")) {
    throw new Error(`${fieldName} must contain only the message field.`);
  }
  return { message: value.message.trim() };
}

export function parseExtensionLocalization(
  value: Record<string, unknown>,
  fieldName: string,
): ExtensionLocalization {
  const defaultLocale = value.defaultLocale;
  if (typeof defaultLocale !== "string" || !defaultLocale.trim()) {
    throw new Error(`${fieldName}.defaultLocale must be a non-empty string.`);
  }
  if (!isRecord(value.messages) || Object.keys(value.messages).length === 0) {
    throw new Error(`${fieldName}.messages must contain at least the default locale.`);
  }

  const messages: Record<string, ExtensionMessageCatalog> = {};
  for (const [locale, catalog] of Object.entries(value.messages)) {
    if (!locale.trim()) {
      throw new Error(`${fieldName}.messages contains an empty locale.`);
    }
    messages[locale] = parseMessageCatalog(catalog, `${fieldName}.messages.${locale}`);
  }
  if (!messages[defaultLocale]) {
    throw new Error(`${fieldName}.messages is missing the default locale "${defaultLocale}".`);
  }

  const expectedKeys = Object.keys(flattenMessageCatalog(messages[defaultLocale]!)).sort();
  const expectedPlaceholders = messagePlaceholders(messages[defaultLocale]!);
  for (const [locale, catalog] of Object.entries(messages)) {
    const keys = Object.keys(flattenMessageCatalog(catalog)).sort();
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
      throw new Error(
        `${fieldName}.messages.${locale} must expose the same message keys as "${defaultLocale}".`,
      );
    }
    const placeholders = messagePlaceholders(catalog);
    for (const [key, expected] of Object.entries(expectedPlaceholders)) {
      if (JSON.stringify(placeholders[key]) !== JSON.stringify(expected)) {
        throw new Error(
          `${fieldName}.messages.${locale}.${key} must preserve interpolation variables and rich-text tags.`,
        );
      }
    }
  }

  return { defaultLocale: defaultLocale.trim(), messages };
}

function parseMessageCatalog(value: unknown, fieldName: string): ExtensionMessageCatalog {
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  const catalog: ExtensionMessageCatalog = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      if (!entry.trim()) {
        throw new Error(`${fieldName}.${key} must not be empty.`);
      }
      catalog[key] = entry;
    } else {
      catalog[key] = parseMessageCatalog(entry, `${fieldName}.${key}`);
    }
  }
  return catalog;
}

export function flattenMessageCatalog(
  catalog: ExtensionMessageCatalog,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      result[path] = value;
    } else {
      Object.assign(result, flattenMessageCatalog(value, path));
    }
  }
  return result;
}

export function readExtensionMessage(
  localization: ExtensionLocalization,
  reference: LocalizableText,
  locale: string,
): string {
  const catalog =
    localization.messages[locale] ?? localization.messages[localization.defaultLocale];
  const message = flattenMessageCatalog(catalog!)[reference.message];
  if (message === undefined) {
    throw new Error(`Unknown extension message "${reference.message}" for locale "${locale}".`);
  }
  return message;
}

export function assertExtensionMessageReferences(
  localization: ExtensionLocalization,
  value: unknown,
  fieldName: string,
): void {
  const defaultMessages = flattenMessageCatalog(localization.messages[localization.defaultLocale]!);
  for (const reference of collectMessageReferences(value)) {
    if (!(reference in defaultMessages)) {
      throw new Error(`${fieldName} references unknown message "${reference}".`);
    }
  }
}

function collectMessageReferences(value: unknown, result: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectMessageReferences(entry, result);
    }
  } else if (isRecord(value)) {
    if (typeof value.message === "string" && Object.keys(value).length === 1) {
      result.push(value.message);
      return result;
    }
    for (const entry of Object.values(value)) {
      collectMessageReferences(entry, result);
    }
  }
  return result;
}

function messagePlaceholders(catalog: ExtensionMessageCatalog): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(flattenMessageCatalog(catalog)).map(([key, message]) => [
      key,
      [
        ...(message.match(/\{\{\s*[^{}]+\s*\}\}/gu) ?? []),
        ...(message.match(/<\/?[A-Za-z][^>]*>/gu) ?? []),
      ].sort(),
    ]),
  );
}
