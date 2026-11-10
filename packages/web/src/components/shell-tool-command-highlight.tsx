import { useEffect, useMemo, useState } from "react";
import type { BundledLanguage, TokensResult } from "shiki";

import {
  plainHighlightResult,
  renderHighlightedCodeLines,
  trimTrailingNewlines,
} from "@/lib/spirit-message-code-highlight";
import { spiritShikiCodePlugin } from "@/lib/spirit-shiki-code-plugin";
import { SPIRIT_SHIKI_PLUS_THEMES } from "@/lib/spirit-shiki-themes";
import { cn } from "@/lib/utils";

const SHIKI_HIGHLIGHT_THEMES = [...SPIRIT_SHIKI_PLUS_THEMES] as ["light-plus", "dark-plus"];

function useShikiToolCodeHighlight(code: string, language: BundledLanguage): TokensResult {
  const normalizedCode = useMemo(() => trimTrailingNewlines(code), [code]);
  const plainResult = useMemo(() => plainHighlightResult(normalizedCode), [normalizedCode]);
  const [result, setResult] = useState<TokensResult>(plainResult);
  const supportsLanguage = spiritShikiCodePlugin.supportsLanguage(language);

  useEffect(() => {
    setResult(plainResult);
    if (!supportsLanguage) {
      return;
    }

    const syncResult = spiritShikiCodePlugin.highlight(
      { code: normalizedCode, language, themes: SHIKI_HIGHLIGHT_THEMES },
      (highlighted) => {
        setResult(highlighted as TokensResult);
      },
    );
    if (syncResult) {
      setResult(syncResult as TokensResult);
    }
  }, [normalizedCode, plainResult, supportsLanguage, language]);

  return result;
}

export function ShellToolCommandHighlight({ command }: { command: string }) {
  const result = useShikiToolCodeHighlight(command, "shell");
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

/** MCP tool_call approval arguments: same command-card treatment as shell, JSON language, no prompt prefix. */
export function JsonToolArgumentsHighlight({ argumentsJson }: { argumentsJson: string }) {
  const result = useShikiToolCodeHighlight(argumentsJson, "json");
  return (
    <pre
      data-spirit-selectable="text"
      className={cn(
        "min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed",
        "bg-transparent p-0 text-muted-foreground",
      )}
    >
      <code>{renderHighlightedCodeLines(result)}</code>
    </pre>
  );
}
