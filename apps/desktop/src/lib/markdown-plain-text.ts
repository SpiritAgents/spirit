import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse);

/** mdast leaf types whose `value` is user-visible text; the parser has already stripped the markers (`` ` ``, fences) from these values. */
const TEXT_VALUE_NODE_TYPES = new Set(["text", "inlineCode", "code"]);

/** Block-level nodes: each boundary collapses to a single space, so adjacent blocks never glue together. */
const BLOCK_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "code",
  "html",
  "thematicBreak",
  "definition",
  "footnoteDefinition",
]);

function collectTextValues(node: Nodes, parts: string[]): void {
  if (BLOCK_NODE_TYPES.has(node.type)) {
    parts.push(" ");
  }
  if (TEXT_VALUE_NODE_TYPES.has(node.type) && "value" in node && typeof node.value === "string") {
    parts.push(node.value);
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      collectTextValues(child, parts);
    }
  }
}

/**
 * Single-line plain-text overview of a Markdown document. AST-based (not regex) so that
 * inputs the parser considers identical — e.g. `## 你好\n你好` vs `## 你好\n\n` — normalize
 * the same way, and formatting markers (`#`, `**`, `` ` ``) never leak into the output.
 */
export function markdownToPlainText(markdown: string): string {
  if (!markdown.trim()) {
    return "";
  }
  const parts: string[] = [];
  collectTextValues(parser.parse(markdown), parts);
  return parts.join("").replace(/\s+/g, " ").trim();
}
