import type { MessageContentPart, RichSegment } from "./composer-segment-model.js";
import type { QuoteChipOrigin } from "./message-quote-attachment.js";
import { normalizeSessionPathKey } from "./session-path-kind.js";

export type { QuoteChipOrigin };

export const NAVIGABLE_COMPOSER_CHIP_KINDS = [
  "skill",
  "workspaceFile",
  "fileSnippet",
  "sessionReference",
  "element",
  "gitCommit",
  "terminalSnippet",
  "prDiff",
  "messageQuote",
] as const;

export type NavigableComposerChipKind = (typeof NAVIGABLE_COMPOSER_CHIP_KINDS)[number];

/** Host-only per-chip fields aligned to navigable chips in document order. Never sent to the agent. */
export type ComposerChipNavigateMeta = {
  kind: NavigableComposerChipKind;
  sourceTabId?: string;
  /** workspaceFile chips only: the reference is the session Plan file (render + navigate as Plan). */
  isPlan?: boolean;
  quoteSessionPath?: string;
  quoteMessageId?: number;
  quoteOrigin?: QuoteChipOrigin;
};

const NAVIGABLE_KIND_SET = new Set<string>(NAVIGABLE_COMPOSER_CHIP_KINDS);

export function isNavigableComposerChipKind(kind: string): kind is NavigableComposerChipKind {
  return NAVIGABLE_KIND_SET.has(kind);
}

export function isNavigableComposerChipSegment(
  segment: RichSegment,
): segment is Extract<RichSegment, { kind: NavigableComposerChipKind }> {
  return isNavigableComposerChipKind(segment.kind);
}

export function cloneChipNavigateMeta(
  meta: readonly ComposerChipNavigateMeta[],
): ComposerChipNavigateMeta[] {
  return meta.map((item) => ({ ...item }));
}

export function spreadChipNavigateMeta(
  meta: readonly ComposerChipNavigateMeta[] | undefined,
): { chipNavigateMeta: ComposerChipNavigateMeta[] } | Record<string, never> {
  if (!meta || meta.length === 0) {
    return {};
  }
  return { chipNavigateMeta: cloneChipNavigateMeta(meta) };
}

function sourceTabIdFromSegment(segment: RichSegment): string | undefined {
  if (segment.kind === "workspaceFile") {
    return segment.sourceTabId?.trim() || undefined;
  }
  if (
    segment.kind === "element" ||
    segment.kind === "prDiff" ||
    segment.kind === "gitCommit" ||
    segment.kind === "terminalSnippet" ||
    segment.kind === "fileSnippet"
  ) {
    return segment.attachment.sourceTabId?.trim() || undefined;
  }
  return undefined;
}

function quoteFieldsFromSegment(
  segment: Extract<RichSegment, { kind: "messageQuote" }>,
): Pick<ComposerChipNavigateMeta, "quoteSessionPath" | "quoteMessageId" | "quoteOrigin"> {
  const quoteSessionPath = segment.attachment.sessionPath?.trim() || undefined;
  const quoteMessageId =
    typeof segment.attachment.messageId === "number" &&
    Number.isFinite(segment.attachment.messageId)
      ? segment.attachment.messageId
      : undefined;
  const quoteOrigin =
    segment.attachment.origin === "session" || segment.attachment.origin === "side-chat"
      ? segment.attachment.origin
      : undefined;
  return {
    ...(quoteSessionPath ? { quoteSessionPath } : {}),
    ...(quoteMessageId !== undefined ? { quoteMessageId } : {}),
    ...(quoteOrigin ? { quoteOrigin } : {}),
  };
}

export function extractChipNavigateMeta(
  segments: readonly RichSegment[],
): ComposerChipNavigateMeta[] {
  const meta: ComposerChipNavigateMeta[] = [];
  for (const segment of segments) {
    if (!isNavigableComposerChipSegment(segment)) {
      continue;
    }
    const item: ComposerChipNavigateMeta = { kind: segment.kind };
    const sourceTabId = sourceTabIdFromSegment(segment);
    if (sourceTabId) {
      item.sourceTabId = sourceTabId;
    }
    if (segment.kind === "workspaceFile" && segment.isPlan === true) {
      item.isPlan = true;
    }
    if (segment.kind === "messageQuote") {
      Object.assign(item, quoteFieldsFromSegment(segment));
    }
    meta.push(item);
  }
  return meta;
}

function kindsAlign(
  chips: readonly { kind: string }[],
  meta: readonly ComposerChipNavigateMeta[],
): boolean {
  if (chips.length !== meta.length) {
    return false;
  }
  return chips.every((chip, index) => chip.kind === meta[index]?.kind);
}

export function applyChipNavigateMeta(
  segments: RichSegment[],
  meta: readonly ComposerChipNavigateMeta[] | undefined,
): RichSegment[] {
  if (!meta || meta.length === 0) {
    return segments;
  }
  const chips = segments.filter(isNavigableComposerChipSegment);
  if (!kindsAlign(chips, meta)) {
    return segments;
  }

  let chipIndex = 0;
  return segments.map((segment) => {
    if (!isNavigableComposerChipSegment(segment)) {
      return segment;
    }
    const item = meta[chipIndex++]!;
    return applyMetaToSegment(segment, item);
  });
}

function withTrackedAttachment<T extends { attachment: { sourceTabId?: string } }>(
  segment: T,
  sourceTabId: string | undefined,
): T {
  if (!sourceTabId) {
    return segment;
  }
  return {
    ...segment,
    attachment: { ...segment.attachment, sourceTabId },
  };
}

function applyMetaToSegment(
  segment: Extract<RichSegment, { kind: NavigableComposerChipKind }>,
  item: ComposerChipNavigateMeta,
): RichSegment {
  switch (segment.kind) {
    case "workspaceFile":
      return item.sourceTabId || item.isPlan === true
        ? {
            ...segment,
            ...(item.sourceTabId ? { sourceTabId: item.sourceTabId } : {}),
            ...(item.isPlan === true ? { isPlan: true } : {}),
          }
        : segment;
    case "messageQuote":
      return {
        ...segment,
        attachment: {
          ...segment.attachment,
          ...(item.quoteSessionPath ? { sessionPath: item.quoteSessionPath } : {}),
          ...(item.quoteMessageId !== undefined ? { messageId: item.quoteMessageId } : {}),
          ...(item.quoteOrigin ? { origin: item.quoteOrigin } : {}),
        },
      };
    case "element":
    case "prDiff":
    case "gitCommit":
    case "terminalSnippet":
    case "fileSnippet":
      return withTrackedAttachment(segment, item.sourceTabId);
    default:
      return segment;
  }
}

export function navigablePartsFromMessageContent(
  parts: readonly MessageContentPart[],
): MessageContentPart[] {
  return parts.filter((part) => isNavigableComposerChipKind(part.kind));
}

export function alignChipNavigateMetaToParts(
  parts: readonly MessageContentPart[],
  meta: readonly ComposerChipNavigateMeta[] | undefined,
): ComposerChipNavigateMeta[] | undefined {
  if (!meta || meta.length === 0) {
    return undefined;
  }
  const chips = navigablePartsFromMessageContent(parts);
  if (!kindsAlign(chips, meta)) {
    return undefined;
  }
  return cloneChipNavigateMeta(meta);
}

export function parseChipNavigateMeta(value: unknown): ComposerChipNavigateMeta[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const parsed: ComposerChipNavigateMeta[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return undefined;
    }
    const kind = (item as { kind?: unknown }).kind;
    if (typeof kind !== "string" || !isNavigableComposerChipKind(kind)) {
      return undefined;
    }
    const next: ComposerChipNavigateMeta = { kind };
    const sourceTabId = (item as { sourceTabId?: unknown }).sourceTabId;
    if (typeof sourceTabId === "string" && sourceTabId.trim()) {
      next.sourceTabId = sourceTabId.trim();
    }
    if (kind === "workspaceFile" && (item as { isPlan?: unknown }).isPlan === true) {
      next.isPlan = true;
    }
    const quoteSessionPath = (item as { quoteSessionPath?: unknown }).quoteSessionPath;
    if (typeof quoteSessionPath === "string" && quoteSessionPath.trim()) {
      next.quoteSessionPath = quoteSessionPath.trim();
    }
    const quoteMessageId = (item as { quoteMessageId?: unknown }).quoteMessageId;
    if (typeof quoteMessageId === "number" && Number.isFinite(quoteMessageId)) {
      next.quoteMessageId = quoteMessageId;
    }
    const quoteOrigin = (item as { quoteOrigin?: unknown }).quoteOrigin;
    if (quoteOrigin === "session" || quoteOrigin === "side-chat") {
      next.quoteOrigin = quoteOrigin;
    }
    parsed.push(next);
  }
  return parsed;
}

export function followChipNavigateMetaQuoteSessionPaths(
  meta: readonly ComposerChipNavigateMeta[] | undefined,
  follow: (path: string) => string,
): ComposerChipNavigateMeta[] | undefined {
  if (!meta || meta.length === 0) {
    return meta as ComposerChipNavigateMeta[] | undefined;
  }
  let changed = false;
  const next = meta.map((item) => {
    const current = item.quoteSessionPath?.trim();
    if (!current) {
      return item;
    }
    const followed = follow(current).trim();
    if (!followed || followed === current) {
      return item;
    }
    changed = true;
    return { ...item, quoteSessionPath: followed };
  });
  return changed ? next : (meta as ComposerChipNavigateMeta[]);
}

export function remapChipNavigateMetaQuoteSessionPath(
  meta: readonly ComposerChipNavigateMeta[] | undefined,
  fromPath: string,
  toPath: string,
): ComposerChipNavigateMeta[] | undefined {
  const fromKey = normalizeSessionPathKey(fromPath);
  const toNormalized = toPath.trim();
  if (!fromKey || !toNormalized || fromKey === normalizeSessionPathKey(toNormalized)) {
    return meta as ComposerChipNavigateMeta[] | undefined;
  }
  return followChipNavigateMetaQuoteSessionPaths(meta, (path) =>
    normalizeSessionPathKey(path) === fromKey ? toNormalized : path,
  );
}

export function followQuoteSessionPathsInSegments(
  segments: readonly RichSegment[],
  follow: (path: string) => string,
): RichSegment[] {
  let changed = false;
  const next = segments.map((segment) => {
    if (segment.kind !== "messageQuote") {
      return segment;
    }
    const current = segment.attachment.sessionPath?.trim();
    if (!current) {
      return segment;
    }
    const followed = follow(current).trim();
    if (!followed || followed === current) {
      return segment;
    }
    changed = true;
    return {
      ...segment,
      attachment: { ...segment.attachment, sessionPath: followed },
    };
  });
  return changed ? next : (segments as RichSegment[]);
}
