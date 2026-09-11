import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import {
  buildJumpListNewSessionLaunchArgs,
  buildJumpListSessionLaunchArgs,
  jumpListSessionFileNameFromPath,
  parseJumpListSessionFileName,
  parseWindowsLaunchArgv,
  resolveJumpListSessionPath,
} from "../../src/lib/windows-launch-argv.ts";

test("parseWindowsLaunchArgv reads --new-session", () => {
  assert.deepEqual(parseWindowsLaunchArgv(["Spirit.exe", "--new-session"]), {
    kind: "new-session",
  });
});

test("parseWindowsLaunchArgv reads --session followed by a chat file name", () => {
  assert.deepEqual(parseWindowsLaunchArgv(["Spirit.exe", "--session", "chat-1700000000.json"]), {
    kind: "open-session",
    fileName: "chat-1700000000.json",
  });
});

test("parseWindowsLaunchArgv rejects --session=", () => {
  assert.equal(parseWindowsLaunchArgv(["Spirit.exe", "--session=chat-1700000000.json"]), null);
  assert.equal(parseWindowsLaunchArgv(["Spirit.exe", "--session="]), null);
});

test("parseWindowsLaunchArgv rejects --open-session", () => {
  assert.equal(
    parseWindowsLaunchArgv(["Spirit.exe", "--open-session", "chat-1700000000.json"]),
    null,
  );
});

test("parseWindowsLaunchArgv rejects traversal and absolute session values", () => {
  assert.equal(
    parseWindowsLaunchArgv(["Spirit.exe", "--session", "../chat-1700000000.json"]),
    null,
  );
  assert.equal(
    parseWindowsLaunchArgv(["Spirit.exe", "--session", "C:\\Users\\me\\chat-1700000000.json"]),
    null,
  );
  assert.equal(
    parseWindowsLaunchArgv(["Spirit.exe", "--session", "chats/chat-1700000000.json"]),
    null,
  );
  assert.equal(
    parseWindowsLaunchArgv(["Spirit.exe", "--session", "__provisional__/chat-1700000000.json"]),
    null,
  );
});

test("parseJumpListSessionFileName accepts only chat-<digits>.json", () => {
  assert.equal(parseJumpListSessionFileName("chat-1700000000.json"), "chat-1700000000.json");
  assert.equal(parseJumpListSessionFileName("chat-abc.json"), null);
  assert.equal(parseJumpListSessionFileName("side-chat-1.json"), null);
});

test("jumpListSessionFileNameFromPath reads a stable chat basename", () => {
  assert.equal(
    jumpListSessionFileNameFromPath("C:\\Users\\me\\Spirit\\chats\\chat-1700000000.json"),
    "chat-1700000000.json",
  );
  assert.equal(
    jumpListSessionFileNameFromPath("/Users/me/Spirit/chats/__provisional__/abc.json"),
    null,
  );
});

test("resolveJumpListSessionPath stays inside the chats directory", () => {
  const chatsDir = path.resolve("/Users/me/Spirit/chats");
  assert.equal(
    resolveJumpListSessionPath(chatsDir, "chat-1700000000.json"),
    path.resolve(chatsDir, "chat-1700000000.json"),
  );
  assert.equal(resolveJumpListSessionPath(chatsDir, "../chat-1700000000.json"), null);
  assert.equal(resolveJumpListSessionPath(chatsDir, "/tmp/chat-1700000000.json"), null);
  assert.equal(resolveJumpListSessionPath(chatsDir, "chat-abc.json"), null);
});

test("buildJumpList launch args use a spaced --session flag", () => {
  assert.equal(buildJumpListNewSessionLaunchArgs(), "--new-session");
  assert.equal(
    buildJumpListSessionLaunchArgs("chat-1700000000.json"),
    '--session "chat-1700000000.json"',
  );
});
