import { spiritShikiCodePlugin } from "./spirit-shiki-code-plugin.js";
import { resolveShikiLanguageAlias } from "./shiki-language-aliases.js";

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
