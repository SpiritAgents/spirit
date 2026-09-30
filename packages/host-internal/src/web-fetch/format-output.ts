import type { ExtractedWebContent } from "./extract-markdown.js";
import {
  CONTEXT_INJECTION_MAX_BYTES,
  decodeUtf8,
  encodeUtf8,
  sliceUtf8Head,
  utf8ByteLength,
} from "@spiritagent/agent-core";
import {
  WEB_FETCH_MAX_LINKS,
  WEB_FETCH_META_VALUE_MAX_BYTES,
  WEB_FETCH_USER_AGENT,
} from "./constants.js";

export interface WebFetchOutputMeta {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  siteName?: string;
  excerpt?: string;
  extraction: ExtractedWebContent["extraction"];
  jsonKeys?: string;
  truncated: boolean;
  /** Present (and rendered as a header line) whenever the page supplied any links. */
  linksTruncated?: boolean;
  /** Byte size of the full extracted markdown, before any truncation. */
  contentBytes: number;
}

export interface TruncateMarkdownResult {
  text: string;
  truncated: boolean;
}

export function sanitizeWebFetchMetaValue(value: string): string {
  return value
    .replace(/[\r\n\u2028\u2029]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

// Header values carry externally supplied text (page title, redirect target, link URLs, …)
// with no upstream length bound; cap each so the header alone can never exhaust the budget.
function capWebFetchMetaValue(value: string): string {
  const bytes = encodeUtf8(value);
  return bytes.length <= WEB_FETCH_META_VALUE_MAX_BYTES
    ? value
    : decodeUtf8(sliceUtf8Head(bytes, WEB_FETCH_META_VALUE_MAX_BYTES));
}

function formatMetaLine(key: string, value: string): string {
  return `${key}: ${capWebFetchMetaValue(sanitizeWebFetchMetaValue(value))}`;
}

export function escapeMarkdownLinkLabel(text: string): string {
  return text.replace(/\\/gu, "\\\\").replace(/\[/gu, "\\[").replace(/\]/gu, "\\]");
}

export function truncateMarkdownAtHeadingBoundary(
  markdown: string,
  maxBytes: number,
): TruncateMarkdownResult {
  const bytes = encodeUtf8(markdown);
  if (bytes.length <= maxBytes) {
    return { text: markdown, truncated: false };
  }

  const slice = decodeUtf8(sliceUtf8Head(bytes, maxBytes));
  const headingPattern = /\n#{1,6} /gu;
  let lastHeadingIndex = -1;
  for (const match of slice.matchAll(headingPattern)) {
    const index = match.index;
    if (index !== undefined && index > 0) {
      lastHeadingIndex = index;
    }
  }

  if (lastHeadingIndex > 0) {
    return {
      text: slice.slice(0, lastHeadingIndex).trimEnd(),
      truncated: true,
    };
  }

  const paragraphBreak = slice.lastIndexOf("\n\n");
  if (paragraphBreak > 0 && utf8ByteLength(slice.slice(0, paragraphBreak)) > maxBytes * 0.5) {
    return {
      text: slice.slice(0, paragraphBreak).trimEnd(),
      truncated: true,
    };
  }

  return {
    text: slice.trimEnd(),
    truncated: true,
  };
}

function formatLinkLine(link: { text: string; url: string }): string {
  return `- [${escapeMarkdownLinkLabel(link.text)}](${link.url})`;
}

function formatLinksSectionWithinBudget(
  links: ReadonlyArray<{ text: string; url: string }>,
  maxBytes: number,
): { section: string; truncated: boolean } {
  if (links.length === 0) {
    return { section: "", truncated: false };
  }

  const prefix = "## links\n";
  const lines = links.slice(0, WEB_FETCH_MAX_LINKS).map(formatLinkLine);
  const markerFor = (omitted: number): string => `- … (${omitted} more links omitted)`;

  let usedBytes = utf8ByteLength(prefix);
  let kept = 0;
  for (const line of lines) {
    const separatorBytes = kept > 0 ? 1 : 0;
    const remainingAfter = links.length - (kept + 1);
    const markerReserve = remainingAfter > 0 ? utf8ByteLength(`\n${markerFor(remainingAfter)}`) : 0;
    if (usedBytes + separatorBytes + utf8ByteLength(line) + markerReserve > maxBytes) {
      break;
    }
    usedBytes += separatorBytes + utf8ByteLength(line);
    kept += 1;
  }

  const omitted = links.length - kept;
  if (kept === 0 && omitted > 0) {
    // A degenerate budget may not even fit one link; fall back to the omission
    // marker alone, and drop the section entirely if even that does not fit.
    const markerOnly = `${prefix}${markerFor(omitted)}`;
    return utf8ByteLength(markerOnly) <= maxBytes
      ? { section: markerOnly, truncated: true }
      : { section: "", truncated: true };
  }

  return {
    section: `${prefix}${lines.slice(0, kept).join("\n")}${omitted > 0 ? `\n${markerFor(omitted)}` : ""}`,
    truncated: omitted > 0,
  };
}

export function formatWebFetchToolOutput(input: {
  meta: WebFetchOutputMeta;
  contentMarkdown: string;
  linksSection: string;
}): string {
  const { meta, contentMarkdown, linksSection } = input;

  const headerLines = [
    "[web]",
    formatMetaLine("url", meta.url),
    formatMetaLine("final_url", meta.finalUrl),
    `status: ${meta.status}`,
    formatMetaLine("content_type", meta.contentType),
    `user_agent: ${WEB_FETCH_USER_AGENT}`,
    `extraction: ${meta.extraction}`,
    ...(meta.title ? [formatMetaLine("title", meta.title)] : []),
    ...(meta.siteName ? [formatMetaLine("site_name", meta.siteName)] : []),
    ...(meta.excerpt ? [formatMetaLine("excerpt", meta.excerpt)] : []),
    ...(meta.jsonKeys ? [formatMetaLine("json_keys", meta.jsonKeys)] : []),
    `content_bytes: ${meta.contentBytes}`,
    `truncated: ${meta.truncated}`,
    ...(meta.linksTruncated !== undefined ? [`links_truncated: ${meta.linksTruncated}`] : []),
  ];

  const parts = [`${headerLines.join("\n")}\n\n## content\n${contentMarkdown}`];
  if (linksSection.length > 0) {
    parts.push("", linksSection);
  }

  return parts.join("\n");
}

export function buildWebFetchOutput(input: {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  extracted: ExtractedWebContent;
  links: ReadonlyArray<{ text: string; url: string }>;
  maxOutputBytes?: number;
}): string {
  const maxBytes = input.maxOutputBytes ?? CONTEXT_INJECTION_MAX_BYTES;
  const fullMarkdown = input.extracted.markdown;
  const contentBytes = utf8ByteLength(fullMarkdown);

  const baseMeta = {
    url: input.url,
    finalUrl: input.finalUrl,
    status: input.status,
    contentType: input.contentType,
    extraction: input.extracted.extraction,
    contentBytes,
    ...(input.extracted.title ? { title: input.extracted.title } : {}),
    ...(input.extracted.siteName ? { siteName: input.extracted.siteName } : {}),
    ...(input.extracted.jsonKeys ? { jsonKeys: input.extracted.jsonKeys } : {}),
  };
  const hasLinks = input.links.length > 0;

  // Fast path: full content, count-capped links, excerpt included.
  const eagerLinks = formatLinksSectionWithinBudget(input.links, Number.POSITIVE_INFINITY);
  const eager = formatWebFetchToolOutput({
    meta: {
      ...baseMeta,
      ...(input.extracted.excerpt ? { excerpt: input.extracted.excerpt } : {}),
      truncated: false,
      ...(hasLinks ? { linksTruncated: eagerLinks.truncated } : {}),
    },
    contentMarkdown: fullMarkdown,
    linksSection: eagerLinks.section,
  });
  if (utf8ByteLength(eager) <= maxBytes) {
    return eager;
  }

  // Tight path: the excerpt duplicates the content head, so it is the first thing
  // dropped; content keeps priority over links for the remaining budget.
  // Boolean header values are measured at their worst-case width ("false") so the
  // final assembly can only come in under the measured size.
  const skeletonMeta = {
    ...baseMeta,
    truncated: false,
    ...(hasLinks ? { linksTruncated: false } : {}),
  };
  const skeletonBytes = utf8ByteLength(
    formatWebFetchToolOutput({ meta: skeletonMeta, contentMarkdown: "", linksSection: "" }),
  );
  const contentResult = truncateMarkdownAtHeadingBoundary(
    fullMarkdown,
    Math.max(maxBytes - skeletonBytes, 0),
  );

  const contentMeta = { ...skeletonMeta, truncated: contentResult.truncated };
  const linksBudget = Math.max(
    maxBytes -
      utf8ByteLength(
        formatWebFetchToolOutput({
          meta: contentMeta,
          contentMarkdown: contentResult.text,
          linksSection: "",
        }),
      ),
    0,
  );
  const linksResult = formatLinksSectionWithinBudget(input.links, linksBudget);

  return formatWebFetchToolOutput({
    meta: {
      ...contentMeta,
      ...(hasLinks ? { linksTruncated: linksResult.truncated } : {}),
    },
    contentMarkdown: contentResult.text,
    linksSection: linksResult.section,
  });
}
