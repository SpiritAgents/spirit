import assert from "node:assert/strict";
import { test } from "vitest";

import {
  JUMP_LIST_RECENT_LIMIT,
  TRAY_MORE_LIMIT,
  buildJumpListLaunchArgs,
  buildWindowsJumpListCategories,
  pickRecentSessions,
  pickRecentSessionsForJumpList,
  truncateJumpListTitle,
} from "../../src/lib/windows-jump-list-build.ts";

function session(path, displayName, modifiedAtUnixMs) {
  return {
    path,
    displayName,
    modifiedAtUnixMs,
    workspaceRoot: "/workspace",
  };
}

test("pickRecentSessionsForJumpList sorts by modifiedAt desc and caps at five", () => {
  const sessions = [
    session("/chats/chat-100.json", "A", 100),
    session("/chats/chat-300.json", "B", 300),
    session("/chats/chat-200.json", "C", 200),
    session("/chats/chat-500.json", "D", 500),
    session("/chats/chat-400.json", "E", 400),
    session("/chats/chat-600.json", "F", 600),
    session("/chats/chat-50.json", "G", 50),
  ];
  const picked = pickRecentSessionsForJumpList(sessions);
  assert.equal(picked.length, JUMP_LIST_RECENT_LIMIT);
  assert.deepEqual(
    picked.map((item) => item.path),
    [
      "/chats/chat-600.json",
      "/chats/chat-500.json",
      "/chats/chat-400.json",
      "/chats/chat-300.json",
      "/chats/chat-200.json",
    ],
  );
});

test("pickRecentSessionsForJumpList skips ephemeral and provisional paths", () => {
  const picked = pickRecentSessionsForJumpList([
    session("/chats/__provisional__/draft.json", "Draft", 300),
    session("/chats/chat-1700000000.json", "Stable", 200),
    session("ephemeral:debug", "Debug", 400),
  ]);
  assert.deepEqual(
    picked.map((item) => item.path),
    ["/chats/chat-1700000000.json"],
  );
});

test("pickRecentSessions respects custom limit for tray more menu", () => {
  const sessions = Array.from({ length: 12 }, (_, index) =>
    session(`s${index}`, `S${index}`, index + 1),
  );
  const picked = pickRecentSessions(sessions, TRAY_MORE_LIMIT);
  assert.equal(picked.length, TRAY_MORE_LIMIT);
  assert.equal(picked[0]?.path, "s11");
  assert.equal(picked[9]?.path, "s2");
});

test("buildJumpListLaunchArgs prefixes the dev main script", () => {
  assert.equal(buildJumpListLaunchArgs("--new-session"), "--new-session");
  assert.equal(
    buildJumpListLaunchArgs(
      '--session "chat-1700000000.json"',
      "D:\\Spirit\\apps\\desktop\\electron\\main.ts",
    ),
    '"D:\\Spirit\\apps\\desktop\\electron\\main.ts" --session "chat-1700000000.json"',
  );
});

test("buildWindowsJumpListCategories omits custom group when no sessions", () => {
  const categories = buildWindowsJumpListCategories({
    recentLabel: "Recent",
    newAgentLabel: "New Session",
    sessions: [],
    execPath: "C:\\Spirit.exe",
    iconPath: "C:\\Spirit.ico",
  });
  assert.equal(categories.length, 1);
  assert.equal(categories[0]?.type, "tasks");
  assert.equal(categories[0]?.items[0]?.title, "New Session");
  assert.equal(categories[0]?.items[0]?.args, "--new-session");
});

test("buildWindowsJumpListCategories builds recent custom group before tasks", () => {
  const categories = buildWindowsJumpListCategories({
    recentLabel: "Recent",
    newAgentLabel: "New Session",
    sessions: [
      session("C:\\Spirit\\chats\\chat-1.json", "Chat One", 10),
      session("C:\\Spirit\\chats\\chat-2.json", "Chat Two", 20),
    ],
    execPath: "C:\\Spirit.exe",
    iconPath: "C:\\Spirit.ico",
    devMainScript: "C:\\main.ts",
  });
  assert.equal(categories.length, 2);
  assert.equal(categories[0]?.type, "custom");
  assert.equal(categories[0]?.name, "Recent");
  assert.equal(categories[0]?.items.length, 2);
  assert.equal(categories[0]?.items[0]?.args, '"C:\\main.ts" --session "chat-2.json"');
  assert.equal(categories[0]?.items[1]?.args, '"C:\\main.ts" --session "chat-1.json"');
  assert.equal(categories[1]?.type, "tasks");
  assert.equal(categories[1]?.items[0]?.title, "New Session");
  assert.equal(categories[1]?.items[0]?.args, '"C:\\main.ts" --new-session');
});

test("truncateJumpListTitle shortens long display names", () => {
  const long = "x".repeat(300);
  const truncated = truncateJumpListTitle(long, 20);
  assert.equal(truncated.length, 20);
  assert.match(truncated, /…$/u);
});

test("truncateJumpListTitle truncates by code points without splitting surrogate pairs", () => {
  const truncated = truncateJumpListTitle("🎉".repeat(30), 10);
  assert.equal(truncated, `${"🎉".repeat(9)}…`);
  assert.equal(truncated.isWellFormed(), true);
});
