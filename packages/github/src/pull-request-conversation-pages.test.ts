import { test } from "vitest";
import assert from "node:assert/strict";

import { appendPullRequestConversationPages } from "./pull-request-conversation-pages.js";

test("appendPullRequestConversationPages merges pages by id and keeps timeline order", () => {
  const existing = [
    {
      kind: "issueComment" as const,
      id: "issue-comment-1",
      authorLogin: "octocat",
      avatarUrl: "https://github.com/octocat.png",
      body: "First",
      createdAt: "2024-01-01T00:00:00Z",
      url: "https://example.com/#issuecomment-1",
    },
  ];
  const incoming = [
    {
      kind: "issueComment" as const,
      id: "issue-comment-2",
      authorLogin: "hubot",
      avatarUrl: "https://github.com/hubot.png",
      body: "Second",
      createdAt: "2024-01-02T00:00:00Z",
      url: "https://example.com/#issuecomment-2",
    },
    {
      kind: "issueComment" as const,
      id: "issue-comment-1",
      authorLogin: "octocat",
      avatarUrl: "https://github.com/octocat.png",
      body: "Duplicate",
      createdAt: "2024-01-01T00:00:00Z",
      url: "https://example.com/#issuecomment-1",
    },
  ];

  const merged = appendPullRequestConversationPages(existing, incoming);
  assert.deepEqual(
    merged.map((item) => item.id),
    ["issue-comment-1", "issue-comment-2"],
  );
});
