import { useEffect, useMemo, useState } from "react";
import type { TokensResult } from "shiki";

import {
  plainHighlightResult,
  renderHighlightedCodeLines,
  trimTrailingNewlines,
} from "@/lib/spirit-message-code-highlight";
import { spiritShikiCodePlugin } from "@/lib/spirit-shiki-code-plugin";
import { SPIRIT_SHIKI_PLUS_THEMES } from "@/lib/spirit-shiki-themes";
import { cn } from "@/lib/utils";

const SHELL_HIGHLIGHT_LANGUAGE = "shell";
const SHELL_HIGHLIGHT_THEMES = [...SPIRIT_SHIKI_PLUS_THEMES] as ["light-plus", "dark-plus"];

export function ShellToolCommandHighlight({ command }: { command: string }) {
  const normalizedCode = useMemo(() => trimTrailingNewlines(command), [command]);
  const plainResult = useMemo(() => plainHighlightResult(normalizedCode), [normalizedCode]);
  const [result, setResult] = useState<TokensResult>(plainResult);
  const supportsShell = spiritShikiCodePlugin.supportsLanguage(SHELL_HIGHLIGHT_LANGUAGE);

  useEffect(() => {
    setResult(plainResult);
    if (!supportsShell) {
      return;
    }

    const syncResult = spiritShikiCodePlugin.highlight(
      { code: normalizedCode, language: SHELL_HIGHLIGHT_LANGUAGE, themes: SHELL_HIGHLIGHT_THEMES },
      (highlighted) => {
        setResult(highlighted as TokensResult);
      },
    );
    if (syncResult) {
      setResult(syncResult as TokensResult);
    }
  }, [normalizedCode, plainResult, supportsShell]);

  return (
    <pre
      data-spirit-selectable="text"
      className={cn(
        "min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed",
        "bg-transparent p-0 text-muted-foreground",
      )}
    >
      <code>
        <span className="select-none text-muted-foreground/75">$ </span>
        {renderHighlightedCodeLines(result)}
      </code>
    </pre>
  );
}
