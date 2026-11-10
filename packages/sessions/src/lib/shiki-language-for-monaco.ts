import { spiritShikiCodePlugin } from "@/lib/spirit-shiki-code-plugin";
import { resolveShikiLanguageAlias } from "@/lib/shiki-language-aliases";

import type { BundledLanguage } from "shiki";

/** monacoLanguageId → Shiki bundled language; undefined means no highlighting. */
export function shikiLanguageForMonacoId(languageId: string): BundledLanguage | undefined {
  const aliased = resolveShikiLanguageAlias(languageId);
  if (!aliased) {
    return undefined;
  }

  return spiritShikiCodePlugin.supportsLanguage(aliased as BundledLanguage)
    ? (aliased as BundledLanguage)
    : undefined;
}
