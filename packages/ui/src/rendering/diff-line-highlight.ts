import { useEffect, useMemo, useState } from "react";
import type { BundledLanguage, TokensResult } from "shiki";

import type { DiffDisplayLine } from "./diff-display-lines.js";
import { plainHighlightResult } from "./spirit-message-code-highlight.js";
import { spiritShikiCodePlugin } from "./spirit-shiki-code-plugin.js";
import { SPIRIT_SHIKI_PLUS_THEMES } from "./spirit-shiki-themes.js";
import { shikiLanguageForMonacoId } from "./shiki-language-for-monaco.js";

export type DiffLineHighlightTokens = TokensResult["tokens"][number];

const DIFF_HIGHLIGHT_THEMES = [...SPIRIT_SHIKI_PLUS_THEMES] as ["light-plus", "dark-plus"];

function plainTokensForLine(content: string): DiffLineHighlightTokens {
  return plainHighlightResult(content).tokens[0] ?? [];
}

export function plainDiffLineTokens(lines: DiffDisplayLine[]): DiffLineHighlightTokens[] {
  return lines.map((line) => plainTokensForLine(line.content));
}

function highlightDiffLine(
  content: string,
  language: BundledLanguage,
): Promise<DiffLineHighlightTokens> {
  return new Promise((resolve) => {
    const syncResult = spiritShikiCodePlugin.highlight(
      { code: content, language, themes: DIFF_HIGHLIGHT_THEMES },
      (highlighted) => {
        resolve((highlighted as TokensResult).tokens[0] ?? plainTokensForLine(content));
      },
    );

    if (syncResult) {
      resolve((syncResult as TokensResult).tokens[0] ?? plainTokensForLine(content));
    }
  });
}

export function useDiffLineHighlight(
  lines: DiffDisplayLine[],
  languageId: string,
): DiffLineHighlightTokens[] {
  const plainTokens = useMemo(() => plainDiffLineTokens(lines), [lines]);
  const [highlighted, setHighlighted] = useState<{
    input: DiffDisplayLine[];
    tokens: DiffLineHighlightTokens[];
  } | null>(null);
  const shikiLanguage = useMemo(() => shikiLanguageForMonacoId(languageId), [languageId]);

  useEffect(() => {
    if (!shikiLanguage) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      const results = await Promise.all(
        lines.map((line) => highlightDiffLine(line.content, shikiLanguage)),
      );
      if (!cancelled) {
        setHighlighted({ input: lines, tokens: results });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lines, shikiLanguage]);

  return highlighted?.input === lines ? highlighted.tokens : plainTokens;
}
