import assert from "node:assert/strict";
import { test } from "vitest";

import {
  composerChipNavigateTargetFromMeta,
  pointerMovedBeyondChipNavigateThreshold,
  resolveComposerChipNavigate,
  resolveSessionChatPathFromTranscript,
  trackedTabOfKind,
} from "../../src/lib/composer-chip-navigation.ts";

function env(overrides = {}) {
  return {
    tabs: [],
    supportsBrowserTabs: true,
    supportsPrTabs: true,
    githubConnected: true,
    sessions: [],
    skills: [],
    workspaceRoot: "/tmp/workspace",
    ...overrides,
  };
}

test("untracked terminal chips are not navigable", () => {
  const tabs = [{ id: "term-1", kind: "terminal" }];
  assert.deepEqual(resolveComposerChipNavigate({ kind: "terminalSnippet" }, env({ tabs })), {
    navigable: false,
  });
  assert.deepEqual(
    resolveComposerChipNavigate({ kind: "terminalSnippet", sourceTabId: "gone" }, env({ tabs })),
    { navigable: false },
  );
});

test("tracked terminal tab still present is navigable", () => {
  const tabs = [{ id: "term-1", kind: "terminal" }];
  assert.deepEqual(
    resolveComposerChipNavigate({ kind: "terminalSnippet", sourceTabId: "term-1" }, env({ tabs })),
    { navigable: true, action: { type: "focus-tab", tabId: "term-1" } },
  );
});

test("closed tracked files tab falls back to same-path tab or new reveal", () => {
  const tabs = [{ id: "files-2", kind: "files", filesWorkspacePath: "src/a.ts" }];
  assert.deepEqual(
    resolveComposerChipNavigate(
      { kind: "workspaceFile", path: "src/a.ts", sourceTabId: "files-1" },
      env({ tabs }),
    ),
    {
      navigable: true,
      action: { type: "reveal-workspace-path", relativePath: "src/a.ts", tabId: "files-2" },
    },
  );
  assert.deepEqual(
    resolveComposerChipNavigate(
      { kind: "workspaceFile", path: "src/b.ts", sourceTabId: "files-1" },
      env({ tabs }),
    ),
    { navigable: true, action: { type: "reveal-workspace-path", relativePath: "src/b.ts" } },
  );
});

test("plan-flagged file chips open the Plan tab regardless of runtime plan state", () => {
  assert.deepEqual(
    resolveComposerChipNavigate(
      { kind: "workspaceFile", path: "plans/test.md", isPlan: true },
      env(),
    ),
    { navigable: true, action: { type: "open-plan" } },
  );
  // Without the flag the same path is an ordinary file reference.
  const decision = resolveComposerChipNavigate(
    { kind: "workspaceFile", path: "plans/test.md" },
    env(),
  );
  assert.deepEqual(decision, {
    navigable: true,
    action: { type: "reveal-workspace-path", relativePath: "plans/test.md" },
  });
});

test("composerChipNavigateTargetFromMeta carries isPlan for workspaceFile chips", () => {
  assert.deepEqual(
    composerChipNavigateTargetFromMeta("workspaceFile", {
      kind: "workspaceFile",
      isPlan: true,
      sourceTabId: "files-1",
    }),
    { isPlan: true, sourceTabId: "files-1" },
  );
  assert.deepEqual(
    composerChipNavigateTargetFromMeta("workspaceFile", { kind: "workspaceFile" }),
    {},
  );
  assert.deepEqual(
    composerChipNavigateTargetFromMeta("workspaceFile", { kind: "skill", isPlan: true }),
    {},
  );
});

test("PR chips are not navigable when GitHub is disconnected or host has no PR tab", () => {
  const target = {
    kind: "prDiff",
    prUrl: "https://github.com/SpiritAgents/spirit/pull/100",
  };
  assert.equal(
    resolveComposerChipNavigate(target, env({ githubConnected: false })).navigable,
    false,
  );
  assert.equal(
    resolveComposerChipNavigate(target, env({ supportsPrTabs: false })).navigable,
    false,
  );
  assert.equal(
    resolveComposerChipNavigate(
      { kind: "element", pageUrl: "https://example.com" },
      env({ supportsBrowserTabs: false }),
    ).navigable,
    false,
  );
});

test("session chips require a transcriptPath match in the session list", () => {
  const sessions = [
    { path: "/tmp/chats/chat-1.json", transcriptPath: "/tmp/transcripts/a/transcript.json" },
  ];
  assert.equal(
    resolveSessionChatPathFromTranscript(sessions, "/tmp/transcripts/a/transcript.json"),
    "/tmp/chats/chat-1.json",
  );
  assert.equal(
    resolveComposerChipNavigate(
      { kind: "sessionReference", transcriptPath: "/missing.json" },
      env(),
    ).navigable,
    false,
  );
  assert.deepEqual(
    resolveComposerChipNavigate(
      { kind: "sessionReference", transcriptPath: "/tmp/transcripts/a/transcript.json" },
      env({ sessions }),
    ),
    { navigable: true, action: { type: "open-session", chatPath: "/tmp/chats/chat-1.json" } },
  );
});

test("skill chips open workspace-relative SKILL.md or an external user path", () => {
  assert.equal(
    resolveComposerChipNavigate({ kind: "skill", alias: "/missing" }, env()).navigable,
    false,
  );
  assert.deepEqual(
    resolveComposerChipNavigate(
      { kind: "skill", alias: "/demo" },
      env({
        skills: [{ name: "demo", path: "/tmp/workspace/.spirit/skills/demo/SKILL.md" }],
      }),
    ),
    {
      navigable: true,
      action: {
        type: "reveal-workspace-path",
        relativePath: ".spirit/skills/demo/SKILL.md",
      },
    },
  );
  assert.deepEqual(
    resolveComposerChipNavigate(
      { kind: "skill", alias: "/home" },
      env({
        skills: [{ name: "home", path: "/Users/me/.spirit/skills/home/SKILL.md" }],
      }),
    ),
    {
      navigable: true,
      action: {
        type: "open-external-file",
        absolutePath: "/Users/me/.spirit/skills/home/SKILL.md",
      },
    },
  );
});

test("quote chips without sessionPath or messageId are not navigable", () => {
  assert.equal(
    resolveComposerChipNavigate({ kind: "messageQuote", quoteMessageId: 1 }, env()).navigable,
    false,
  );
  assert.deepEqual(
    resolveComposerChipNavigate(
      {
        kind: "messageQuote",
        quoteSessionPath: "/tmp/chats/chat-1.json",
        quoteMessageId: 7,
        quoteOrigin: "side-chat",
      },
      env(),
    ),
    {
      navigable: true,
      action: {
        type: "scroll-quote",
        sessionPath: "/tmp/chats/chat-1.json",
        messageId: 7,
        origin: "side-chat",
      },
    },
  );
});

test("ordinary session quotes are not navigable when the target session is unknown", () => {
  assert.equal(
    resolveComposerChipNavigate(
      {
        kind: "messageQuote",
        quoteSessionPath: "/tmp/chats/missing.json",
        quoteMessageId: 7,
        quoteOrigin: "session",
      },
      env({ knownSessionPathKeys: new Set(["/tmp/chats/other.json"]) }),
    ).navigable,
    false,
  );
});

test("closed side-chat quotes stay navigable so the pane can be reopened", () => {
  const sideChatPath = "/tmp/__provisional__/side-chat-pane-1.json";
  assert.deepEqual(
    resolveComposerChipNavigate(
      {
        kind: "messageQuote",
        quoteSessionPath: sideChatPath,
        quoteMessageId: 7,
        quoteOrigin: "side-chat",
      },
      env({ knownSessionPathKeys: new Set(["/tmp/chats/main.json"]) }),
    ),
    {
      navigable: true,
      action: {
        type: "scroll-quote",
        sessionPath: sideChatPath,
        messageId: 7,
        origin: "side-chat",
      },
    },
  );
});

test("quote chips are not navigable when the loaded session no longer has the message", () => {
  const pathKey = "/tmp/chats/chat-1.json";
  assert.equal(
    resolveComposerChipNavigate(
      { kind: "messageQuote", quoteSessionPath: pathKey, quoteMessageId: 99 },
      env({
        loadedMessageIdsBySessionPath: new Map([[pathKey, new Set([7])]]),
      }),
    ).navigable,
    false,
  );
});

test("quote chips follow session-path aliases before checking availability", () => {
  assert.deepEqual(
    resolveComposerChipNavigate(
      {
        kind: "messageQuote",
        quoteSessionPath: "/tmp/chats/old.json",
        quoteMessageId: 3,
      },
      env({
        followSessionPathAlias: (path) =>
          path === "/tmp/chats/old.json" ? "/tmp/chats/new.json" : path,
        knownSessionPathKeys: new Set(["/tmp/chats/new.json"]),
        loadedMessageIdsBySessionPath: new Map([["/tmp/chats/new.json", new Set([3])]]),
      }),
    ),
    {
      navigable: true,
      action: {
        type: "scroll-quote",
        sessionPath: "/tmp/chats/new.json",
        messageId: 3,
        origin: "session",
      },
    },
  );
});

test("trackedTabOfKind ignores surviving tabs of the wrong kind", () => {
  const tabs = [{ id: "tab-1", kind: "files" }];
  assert.equal(trackedTabOfKind(tabs, "tab-1", "terminal"), undefined);
  assert.equal(trackedTabOfKind(tabs, "tab-1", "files")?.id, "tab-1");
});

test("pointer movement below the threshold still counts as a click", () => {
  assert.equal(pointerMovedBeyondChipNavigateThreshold({ x: 0, y: 0 }, { x: 3, y: 0 }), false);
  assert.equal(pointerMovedBeyondChipNavigateThreshold({ x: 0, y: 0 }, { x: 4, y: 0 }), true);
});
