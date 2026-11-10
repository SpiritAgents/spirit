export {
  buildCodeCompletionTaskPrompt,
  buildCodeCompletionSystemSections,
} from "@spiritagent/agent-core";

import { buildCodeCompletionContextSlices } from "./context.js";
import type { CodeCompletionRequestContext } from "./types.js";

export function buildCodeCompletionUserPrompt(input: {
  context: CodeCompletionRequestContext;
  recentEditsText: string;
  recentEditsTruncated?: boolean;
}): string {
  const { context, recentEditsText, recentEditsTruncated = false } = input;
  const slices = buildCodeCompletionContextSlices({
    documentText: context.documentText,
    cursorLine: context.cursorLine,
    cursorColumn: context.cursorColumn,
  });

  const blocks = [
    "[file]",
    `relativePath: ${context.relativePath}`,
    `languageId: ${context.languageId}`,
    "",
    "[cursor]",
    `line: ${context.cursorLine}`,
    `column: ${context.cursorColumn}`,
    "",
    "[prefix]",
    slices.prefixTruncated ? "(truncated)\n" + slices.prefix : slices.prefix,
    "",
    "[suffix]",
    slices.suffixTruncated ? slices.suffix + "\n(truncated)" : slices.suffix,
    "",
    "[recent_edits]",
    recentEditsTruncated ? `${recentEditsText}\ntruncated: true` : recentEditsText,
  ];

  const related = context.relatedSnippets ?? [];
  if (related.length > 0) {
    blocks.push("", "[related]");
    for (const snippet of related) {
      blocks.push(`--- ${snippet.relativePath} ---`, snippet.content, "");
    }
  }

  return blocks.join("\n");
}
