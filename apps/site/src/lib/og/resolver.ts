import { DEFAULT_LOCALE, isSupportedLocale } from "@/i18n/config";
import { messagesByLocale } from "@/i18n/messages";
import { source } from "@/lib/source";

import { getDocsGroupNames, getRootSectionTitle } from "./content";
import type { OgModel } from "./model";

export function resolveOgModel(localeParam: string, segments: string[]): OgModel | null {
  const locale = isSupportedLocale(localeParam) ? localeParam : DEFAULT_LOCALE;
  if (!isSupportedLocale(localeParam)) return null;
  const messages = messagesByLocale[locale];

  if (segments.length === 0) {
    return { kind: "home", locale, path: "", alt: messages.meta.title };
  }

  const [root, ...slug] = segments;
  if (root === "docs" && slug.length > 0) {
    const page = source.getPage(slug, locale);
    if (!page || (page.data as { og?: unknown }).og === false) return null;
    return {
      kind: "detail",
      locale,
      path: `docs/${slug.join("/")}`,
      title: page.data.title,
      groups: getDocsGroupNames(source.getPageTree(locale), page.url),
    };
  }

  if (slug.length > 0) return null;
  const title = getRootSectionTitle(messages, root);
  if (!title) return null;
  return { kind: "section", locale, path: root, title };
}
