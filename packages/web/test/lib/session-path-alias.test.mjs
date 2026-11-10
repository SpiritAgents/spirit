import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applySessionPathAliasesToSnapshot,
  followSessionPathAlias,
  recordSessionPathAlias,
} from "../../src/lib/session-path-alias.ts";

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

test("recordSessionPathAlias follows and collapses promotion chains", () => {
  const storage = createMemoryStorage();
  recordSessionPathAlias("/tmp/chats/a.json", "/tmp/chats/b.json", storage);
  recordSessionPathAlias("/tmp/chats/b.json", "/tmp/chats/c.json", storage);
  assert.equal(followSessionPathAlias("/tmp/chats/a.json", storage), "/tmp/chats/c.json");
  assert.equal(followSessionPathAlias("/tmp/chats/b.json", storage), "/tmp/chats/c.json");
  assert.equal(followSessionPathAlias("/tmp/chats/c.json", storage), "/tmp/chats/c.json");
});

test("applySessionPathAliasesToSnapshot remaps loaded and pane-bundle quote meta", () => {
  const snapshot = {
    conversation: {
      messages: [
        {
          id: 1,
          role: "user",
          content: "quote",
          pending: false,
          chipNavigateMeta: [
            { kind: "messageQuote", quoteSessionPath: "/tmp/chats/old.json", quoteMessageId: 2 },
          ],
        },
      ],
    },
    paneSessions: {
      "/tmp/chats/other.json": {
        conversation: {
          messages: [
            {
              id: 3,
              role: "user",
              content: "pane",
              pending: false,
              chipNavigateMeta: [
                {
                  kind: "messageQuote",
                  quoteSessionPath: "/tmp/chats/old.json",
                  quoteMessageId: 4,
                },
              ],
            },
          ],
        },
      },
    },
  };
  const next = applySessionPathAliasesToSnapshot(snapshot, (path) =>
    path === "/tmp/chats/old.json" ? "/tmp/chats/new.json" : path,
  );
  assert.equal(
    next.conversation.messages[0].chipNavigateMeta[0].quoteSessionPath,
    "/tmp/chats/new.json",
  );
  assert.equal(
    next.paneSessions["/tmp/chats/other.json"].conversation.messages[0].chipNavigateMeta[0]
      .quoteSessionPath,
    "/tmp/chats/new.json",
  );
});
