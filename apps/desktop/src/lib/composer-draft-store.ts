import type { RichSegment } from "@spiritagent/ui/composer";
import { normalizeComposerPlain, segmentsToPlainText } from "@spiritagent/ui/composer";
import { normalizeSessionPathKey } from "./session-path-kind.js";

export const COMPOSER_DRAFT_STORAGE_KEY = "spirit-desktop-composer-drafts";

const STORE_VERSION = 2;
const MAX_DRAFT_ENTRIES = 200;

export interface ComposerDraftEntry {
  text: string;
  localFilePaths: string[];
  segments: RichSegment[];
  updatedAt: number;
}

interface ComposerDraftStoreFile {
  version: number;
  drafts: Record<string, ComposerDraftEntry>;
}

export interface ComposerDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function normalizeComposerSessionKey(key: string): string {
  return key.trim().replace(/\\/g, "/").toLowerCase();
}

function normalizeLocalFilePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const filePath of paths) {
    const trimmed = filePath.trim();
    if (!trimmed) {
      continue;
    }
    const slashPath = trimmed.replace(/\\/g, "/");
    const dedupeKey = slashPath.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalized.push(slashPath);
  }
  return normalized;
}

function isPersistedRichSegment(value: unknown): value is RichSegment {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "text") {
    return typeof (value as { value?: unknown }).value === "string";
  }
  if (kind === "workspaceFile") {
    return typeof (value as { path?: unknown }).path === "string";
  }
  if (kind === "sessionReference") {
    return (
      typeof (value as { path?: unknown }).path === "string" &&
      typeof (value as { title?: unknown }).title === "string"
    );
  }
  if (kind === "skill") {
    return typeof (value as { alias?: unknown }).alias === "string";
  }
  if (kind === "loop" || kind === "plan" || kind === "ask" || kind === "debug") {
    return true;
  }
  if (
    kind === "element" ||
    kind === "prDiff" ||
    kind === "gitCommit" ||
    kind === "terminalSnippet" ||
    kind === "fileSnippet" ||
    kind === "messageQuote"
  ) {
    return (
      typeof (value as { attachment?: unknown }).attachment === "object" &&
      (value as { attachment?: unknown }).attachment !== null
    );
  }
  return false;
}

function normalizeDraftSegments(segments: unknown): RichSegment[] {
  if (!Array.isArray(segments)) {
    return [];
  }
  return segments.filter(isPersistedRichSegment);
}

function hasMeaningfulDraftSegments(segments: readonly RichSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.kind === "text") {
      return segment.value.trim().length > 0;
    }
    return true;
  });
}

function draftPlainText(segments: readonly RichSegment[]): string {
  return normalizeComposerPlain(segmentsToPlainText([...segments]));
}

function isComposerDraftEmpty(
  entry: Pick<ComposerDraftEntry, "localFilePaths" | "segments">,
): boolean {
  return (
    entry.localFilePaths.length === 0 &&
    !hasMeaningfulDraftSegments(entry.segments) &&
    !draftPlainText(entry.segments).trim()
  );
}

function isComposerDraftEntryEmpty(
  entry: Pick<ComposerDraftEntry, "localFilePaths" | "segments"> | undefined,
): boolean {
  return !entry || isComposerDraftEmpty(entry);
}

/** Prefer non-empty pane draft; fall back to composerSessionKey when pane draft is empty. */
export function resolvePaneComposerDraft(
  paneComposerDraftKey: string,
  composerSessionKey: string,
  storage: ComposerDraftStorage | undefined = defaultStorage(),
): ComposerDraftEntry | undefined {
  const paneDraft = paneComposerDraftKey.trim()
    ? readComposerDraft(paneComposerDraftKey, storage)
    : undefined;
  if (!isComposerDraftEntryEmpty(paneDraft)) {
    return paneDraft;
  }
  const sessionDraft = composerSessionKey.trim()
    ? readComposerDraft(composerSessionKey, storage)
    : undefined;
  if (!isComposerDraftEntryEmpty(sessionDraft)) {
    return sessionDraft;
  }
  return paneDraft ?? sessionDraft;
}

export function buildPaneComposerDraftKey(sessionPath: string): string {
  const normalized = normalizeSessionPathKey(sessionPath.trim());
  return normalized ? `pane:${normalized}` : "";
}

function readStoreFile(storage: ComposerDraftStorage): ComposerDraftStoreFile {
  try {
    const raw = storage.getItem(COMPOSER_DRAFT_STORAGE_KEY);
    if (!raw) {
      return { version: STORE_VERSION, drafts: {} };
    }
    const parsed = JSON.parse(raw) as Partial<ComposerDraftStoreFile>;
    if (parsed.version !== STORE_VERSION || typeof parsed.drafts !== "object" || !parsed.drafts) {
      return { version: STORE_VERSION, drafts: {} };
    }
    return { version: STORE_VERSION, drafts: parsed.drafts };
  } catch {
    return { version: STORE_VERSION, drafts: {} };
  }
}

function writeStoreFile(storage: ComposerDraftStorage, file: ComposerDraftStoreFile): void {
  storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, JSON.stringify(file));
}

function pruneDraftEntries(
  drafts: Record<string, ComposerDraftEntry>,
): Record<string, ComposerDraftEntry> {
  const entries = Object.entries(drafts);
  if (entries.length <= MAX_DRAFT_ENTRIES) {
    return drafts;
  }
  entries.sort((left, right) => right[1].updatedAt - left[1].updatedAt);
  return Object.fromEntries(entries.slice(0, MAX_DRAFT_ENTRIES));
}

function defaultStorage(): ComposerDraftStorage | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }
  return localStorage;
}

export function readComposerDraft(
  sessionKey: string,
  storage: ComposerDraftStorage | undefined = defaultStorage(),
): ComposerDraftEntry | undefined {
  const normalizedKey = normalizeComposerSessionKey(sessionKey);
  if (!normalizedKey || !storage) {
    return undefined;
  }
  const entry = readStoreFile(storage).drafts[normalizedKey];
  if (!entry || typeof entry.text !== "string" || !Array.isArray(entry.localFilePaths)) {
    return undefined;
  }
  const segments = normalizeDraftSegments(entry.segments);
  const text = draftPlainText(segments) || entry.text;
  return {
    text,
    localFilePaths: normalizeLocalFilePaths(entry.localFilePaths),
    segments,
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
  };
}

export function writeComposerDraft(
  sessionKey: string,
  payload: Pick<ComposerDraftEntry, "localFilePaths" | "segments">,
  storage: ComposerDraftStorage | undefined = defaultStorage(),
): void {
  const normalizedKey = normalizeComposerSessionKey(sessionKey);
  if (!normalizedKey || !storage) {
    return;
  }

  const file = readStoreFile(storage);
  const segments = normalizeDraftSegments(payload.segments);
  const nextEntry: ComposerDraftEntry = {
    text: draftPlainText(segments),
    localFilePaths: normalizeLocalFilePaths(payload.localFilePaths),
    segments,
    updatedAt: Date.now(),
  };

  if (isComposerDraftEmpty(nextEntry)) {
    if (normalizedKey in file.drafts) {
      delete file.drafts[normalizedKey];
      writeStoreFile(storage, file);
    }
    return;
  }

  file.drafts[normalizedKey] = nextEntry;
  file.drafts = pruneDraftEntries(file.drafts);
  writeStoreFile(storage, file);
}

export function clearComposerDraft(
  sessionKey: string,
  storage: ComposerDraftStorage | undefined = defaultStorage(),
): void {
  const normalizedKey = normalizeComposerSessionKey(sessionKey);
  if (!normalizedKey || !storage) {
    return;
  }
  const file = readStoreFile(storage);
  if (!(normalizedKey in file.drafts)) {
    return;
  }
  delete file.drafts[normalizedKey];
  writeStoreFile(storage, file);
}

function remapQuoteSessionPathInSegments(
  segments: RichSegment[],
  fromKey: string,
  toPath: string,
): { segments: RichSegment[]; changed: boolean } {
  let changed = false;
  const next = segments.map((segment) => {
    if (segment.kind !== "messageQuote") {
      return segment;
    }
    const current = segment.attachment.sessionPath?.trim();
    if (!current || normalizeSessionPathKey(current) !== fromKey) {
      return segment;
    }
    changed = true;
    return {
      ...segment,
      attachment: { ...segment.attachment, sessionPath: toPath },
    };
  });
  return { segments: next, changed };
}

/** Rewrite quote chip sessionPath in every persisted composer draft after a session path promotion. */
export function remapComposerDraftQuoteSessionPaths(
  fromPath: string,
  toPath: string,
  storage: ComposerDraftStorage | undefined = defaultStorage(),
): void {
  const fromKey = normalizeSessionPathKey(fromPath);
  const toNormalized = toPath.trim();
  if (!fromKey || !toNormalized || fromKey === normalizeSessionPathKey(toNormalized) || !storage) {
    return;
  }
  const file = readStoreFile(storage);
  let changed = false;
  const drafts: Record<string, ComposerDraftEntry> = {};
  for (const [key, entry] of Object.entries(file.drafts)) {
    const remapped = remapQuoteSessionPathInSegments(entry.segments, fromKey, toNormalized);
    if (!remapped.changed) {
      drafts[key] = entry;
      continue;
    }
    changed = true;
    drafts[key] = {
      ...entry,
      segments: remapped.segments,
      text: draftPlainText(remapped.segments),
      updatedAt: Date.now(),
    };
  }
  if (changed) {
    writeStoreFile(storage, { version: STORE_VERSION, drafts });
  }
}
