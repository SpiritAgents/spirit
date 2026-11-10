import { followChipNavigateMetaQuoteSessionPaths } from "./composer-chip-navigate-meta.js";
import { normalizeSessionPathKey } from "./session-path-kind.js";
import type {
  ConversationMessageSnapshot,
  ConversationSnapshot,
  DesktopSnapshot,
} from "../types.js";

export const SESSION_PATH_ALIAS_STORAGE_KEY = "spirit-desktop-session-path-aliases-v1";

type SessionPathAliasStoreFile = {
  version: 1;
  aliases: Record<string, string>;
};

export type SessionPathAliasStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function defaultStorage(): SessionPathAliasStorage | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }
  return localStorage;
}

function readAliasFile(storage: SessionPathAliasStorage | undefined): SessionPathAliasStoreFile {
  if (!storage) {
    return { version: 1, aliases: {} };
  }
  try {
    const raw = storage.getItem(SESSION_PATH_ALIAS_STORAGE_KEY);
    if (!raw) {
      return { version: 1, aliases: {} };
    }
    const parsed = JSON.parse(raw) as Partial<SessionPathAliasStoreFile>;
    if (parsed.version !== 1 || typeof parsed.aliases !== "object" || !parsed.aliases) {
      return { version: 1, aliases: {} };
    }
    return { version: 1, aliases: parsed.aliases };
  } catch {
    return { version: 1, aliases: {} };
  }
}

function writeAliasFile(
  storage: SessionPathAliasStorage | undefined,
  file: SessionPathAliasStoreFile,
): void {
  if (!storage) {
    return;
  }
  storage.setItem(SESSION_PATH_ALIAS_STORAGE_KEY, JSON.stringify(file));
}

function followAliases(sessionPath: string, aliases: Record<string, string>): string {
  let current = sessionPath.trim();
  if (!current) {
    return current;
  }
  const seen = new Set<string>();
  for (;;) {
    const key = normalizeSessionPathKey(current);
    if (!key || seen.has(key)) {
      return current;
    }
    seen.add(key);
    const next = aliases[key]?.trim();
    if (!next) {
      return current;
    }
    current = next;
  }
}

/** Follow oldPath → newPath aliases; stops on cycles and missing entries. */
export function followSessionPathAlias(
  sessionPath: string,
  storage: SessionPathAliasStorage | undefined = defaultStorage(),
): string {
  return followAliases(sessionPath, readAliasFile(storage).aliases);
}

/** Record a promotion alias. Chains are collapsed so lookups resolve in one hop when possible. */
export function recordSessionPathAlias(
  fromPath: string,
  toPath: string,
  storage: SessionPathAliasStorage | undefined = defaultStorage(),
): void {
  const fromKey = normalizeSessionPathKey(fromPath);
  const toNormalized = toPath.trim();
  if (!fromKey || !toNormalized || fromKey === normalizeSessionPathKey(toNormalized)) {
    return;
  }
  const file = readAliasFile(storage);
  const resolvedTo = followAliases(toNormalized, file.aliases);
  file.aliases[fromKey] = resolvedTo;
  for (const [key, value] of Object.entries(file.aliases)) {
    if (normalizeSessionPathKey(value) === fromKey) {
      file.aliases[key] = resolvedTo;
    }
  }
  writeAliasFile(storage, file);
}

function followQuotePathsInMessages(
  messages: ConversationMessageSnapshot[],
  follow: (path: string) => string,
): ConversationMessageSnapshot[] {
  let changed = false;
  const next = messages.map((message) => {
    const remapped = followChipNavigateMetaQuoteSessionPaths(message.chipNavigateMeta, follow);
    if (remapped === message.chipNavigateMeta) {
      return message;
    }
    changed = true;
    return remapped?.length
      ? { ...message, chipNavigateMeta: remapped }
      : { ...message, chipNavigateMeta: undefined };
  });
  return changed ? next : messages;
}

function followQuotePathsInConversation(
  conversation: ConversationSnapshot,
  follow: (path: string) => string,
): ConversationSnapshot {
  const messages = followQuotePathsInMessages(conversation.messages, follow);
  return messages === conversation.messages ? conversation : { ...conversation, messages };
}

/** Rewrite quote sessionPath on currently loaded snapshot messages by following promotion aliases. */
export function applySessionPathAliasesToSnapshot(
  snapshot: DesktopSnapshot,
  follow: (path: string) => string = followSessionPathAlias,
): DesktopSnapshot {
  const conversation = followQuotePathsInConversation(snapshot.conversation, follow);
  let paneSessions = snapshot.paneSessions;
  let panesChanged = false;
  if (paneSessions) {
    const nextPanes: Record<string, NonNullable<DesktopSnapshot["paneSessions"]>[string]> = {};
    for (const [path, slice] of Object.entries(paneSessions)) {
      const nextConversation = followQuotePathsInConversation(slice.conversation, follow);
      if (nextConversation === slice.conversation) {
        nextPanes[path] = slice;
        continue;
      }
      panesChanged = true;
      nextPanes[path] = { ...slice, conversation: nextConversation };
    }
    if (panesChanged) {
      paneSessions = nextPanes;
    }
  }
  if (conversation === snapshot.conversation && !panesChanged) {
    return snapshot;
  }
  return {
    ...snapshot,
    conversation,
    ...(paneSessions !== snapshot.paneSessions ? { paneSessions } : {}),
  };
}
