import { llms } from "fumadocs-core/source";

import { getSiteOrigin } from "@/content/site-document";
import { DEFAULT_LOCALE, getLocaleLabel, getLocalePath, SUPPORTED_LOCALES } from "@/i18n/config";
import { source } from "@/lib/source";

export const revalidate = false;

function withFullDocsPointer(index: string): string {
  const origin = getSiteOrigin();
  const pointer = `The complete documentation is available at [${origin}/llms-full.txt](${origin}/llms-full.txt).`;
  const headerBreak = index.indexOf("\n\n");
  return `${index.slice(0, headerBreak)}\n\n${pointer}${index.slice(headerBreak)}`;
}

function availableLanguagesSection(): string {
  const origin = getSiteOrigin();
  const rows = SUPPORTED_LOCALES.map(
    (locale) => `- ${getLocaleLabel(locale)}: ${origin}${getLocalePath(locale, "docs")}`,
  );
  return `## Available languages\n\n${rows.join("\n")}`;
}

export function GET() {
  return new Response(`${withFullDocsPointer(llms(source).index(DEFAULT_LOCALE))}\n\n${availableLanguagesSection()}`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
