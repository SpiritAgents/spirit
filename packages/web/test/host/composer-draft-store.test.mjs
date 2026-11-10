import assert from "node:assert/strict";
import { test } from "vitest";

import {
  COMPOSER_DRAFT_STORAGE_KEY,
  clearComposerDraft,
  normalizeComposerSessionKey,
  readComposerDraft,
  writeComposerDraft,
} from "../../../../packages/sessions/dist/lib/composer-draft-store.js";

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    values,
  };
}

test("normalizeComposerSessionKey normalizes Windows-style paths", () => {
  assert.equal(normalizeComposerSessionKey("D:\\Spirit\\Chats\\A.json"), "d:/spirit/chats/a.json");
});

test("writeComposerDraft and readComposerDraft round-trip text attachments and segments", () => {
  const storage = createMemoryStorage();
  const sessionKey = "D:/Spirit/chats/session-a.json";
  const segments = [
    { kind: "text", value: "fix " },
    { kind: "workspaceFile", path: "src/App.tsx" },
    { kind: "skill", alias: "/git-commit" },
  ];

  writeComposerDraft(
    sessionKey,
    {
      localFilePaths: ["D:\\tmp\\note.png", "D:/tmp/note.png"],
      segments,
    },
    storage,
  );

  const restored = readComposerDraft(sessionKey, storage);
  assert.deepEqual(restored, {
    text: "fix @src/App.tsx",
    localFilePaths: ["D:/tmp/note.png"],
    segments,
    updatedAt: restored.updatedAt,
  });
  assert.equal(typeof restored.updatedAt, "number");
});

test("writeComposerDraft preserves host-only chip navigate fields", () => {
  const storage = createMemoryStorage();
  const sessionKey = "D:/Spirit/chats/session-nav.json";
  const segments = [
    { kind: "text", value: "see " },
    { kind: "workspaceFile", path: "src/App.tsx", sourceTabId: "tab-files-1" },
    {
      kind: "messageQuote",
      attachment: {
        id: "quote-1",
        selectedText: "hello",
        sessionPath: "/tmp/chats/chat-1.json",
        messageId: 7,
        origin: "side-chat",
      },
    },
  ];

  writeComposerDraft(sessionKey, { localFilePaths: [], segments }, storage);

  const restored = readComposerDraft(sessionKey, storage);
  assert.deepEqual(restored.segments, segments);
});

test("writeComposerDraft deletes empty drafts", () => {
  const storage = createMemoryStorage();
  const sessionKey = "session-empty";

  writeComposerDraft(
    sessionKey,
    { localFilePaths: [], segments: [{ kind: "text", value: "temp" }] },
    storage,
  );
  writeComposerDraft(
    sessionKey,
    { localFilePaths: [], segments: [{ kind: "text", value: "   " }] },
    storage,
  );

  assert.equal(readComposerDraft(sessionKey, storage), undefined);
  const raw = JSON.parse(storage.getItem(COMPOSER_DRAFT_STORAGE_KEY));
  assert.equal(raw.drafts["session-empty"], undefined);
});

test("readComposerDraft discards v1 drafts without migration", () => {
  const storage = createMemoryStorage();
  storage.setItem(
    COMPOSER_DRAFT_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      drafts: {
        "legacy-session": {
          text: "@README.md hello",
          localFilePaths: [],
          updatedAt: 1,
        },
      },
    }),
  );

  assert.equal(readComposerDraft("legacy-session", storage), undefined);
});

test("clearComposerDraft removes a stored draft", () => {
  const storage = createMemoryStorage();
  const sessionKey = "session-clear";

  writeComposerDraft(
    sessionKey,
    { localFilePaths: [], segments: [{ kind: "text", value: "keep me briefly" }] },
    storage,
  );
  clearComposerDraft(sessionKey, storage);

  assert.equal(readComposerDraft(sessionKey, storage), undefined);
});

test("readComposerDraft returns undefined for corrupted storage", () => {
  const storage = createMemoryStorage();
  storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, "{not-json");

  assert.equal(readComposerDraft("any-session", storage), undefined);
});
