import assert from "node:assert/strict";
import { test } from "vitest";

import {
  readComposerDraft,
  remapComposerDraftQuoteSessionPaths,
  writeComposerDraft,
} from "../../src/lib/composer-draft-store.ts";

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("remapComposerDraftQuoteSessionPaths rewrites quote sessionPath in all drafts", () => {
  const storage = createMemoryStorage();
  writeComposerDraft(
    "pane:a",
    {
      localFilePaths: [],
      segments: [
        {
          kind: "messageQuote",
          attachment: {
            id: "quote-1",
            selectedText: "hello",
            sessionPath: "/tmp/chats/old.json",
            messageId: 7,
            origin: "session",
          },
        },
      ],
    },
    storage,
  );

  remapComposerDraftQuoteSessionPaths("/tmp/chats/old.json", "/tmp/chats/new.json", storage);

  const restored = readComposerDraft("pane:a", storage);
  assert.equal(restored.segments[0].attachment.sessionPath, "/tmp/chats/new.json");
});
