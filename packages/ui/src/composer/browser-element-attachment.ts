const OUTER_HTML_MAX_BYTES = 4096;

export interface BrowserElementAttachment {
  id: string;
  tagName: string;
  outerHtml: string;
  screenshotDataUrl: string;
  pageUrl: string;
  /** Host-only: workspace tool tab that produced this chip. Never sent to the agent. */
  sourceTabId?: string;
}

export function truncateOuterHtml(html: string): string {
  if (html.length <= OUTER_HTML_MAX_BYTES) return html;
  // Truncate by code point to avoid splitting surrogate pairs; take a 2x-limit code-unit prefix
  // first, then expand, to avoid expanding the entire oversized outerHTML string (the first N
  // code points always fall within the first 2N code units).
  const points = Array.from(html.slice(0, OUTER_HTML_MAX_BYTES * 2));
  return points.slice(0, OUTER_HTML_MAX_BYTES).join("") + "…";
}

export { browserElementContextText } from "./browser-element-wire-text.js";
