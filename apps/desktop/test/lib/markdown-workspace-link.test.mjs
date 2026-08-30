import assert from "node:assert/strict";
import { test } from "vitest";

import {
  inferMarkdownWorkspaceLinkKind,
  resolveMarkdownWorkspaceLink,
  tryHandleMarkdownWorkspaceLink,
} from "../../src/lib/markdown-workspace-link.ts";

const workspaceRoot = "/Users/demo/spirit";
const docsDir = "/Users/demo/spirit/docs";

test("resolveMarkdownWorkspaceLink maps bare and parent-relative paths under workspace", () => {
  assert.deepEqual(
    resolveMarkdownWorkspaceLink("docs/README_zh-CN.md", { baseDir: workspaceRoot, workspaceRoot }),
    {
      absolutePath: "/Users/demo/spirit/docs/README_zh-CN.md",
      relativePath: "docs/README_zh-CN.md",
      trailingSlash: false,
    },
  );
  assert.deepEqual(
    resolveMarkdownWorkspaceLink("packages/agent-core", { baseDir: workspaceRoot, workspaceRoot }),
    {
      absolutePath: "/Users/demo/spirit/packages/agent-core",
      relativePath: "packages/agent-core",
      trailingSlash: false,
    },
  );
  assert.deepEqual(
    resolveMarkdownWorkspaceLink("../packages/agent-core", { baseDir: docsDir, workspaceRoot }),
    {
      absolutePath: "/Users/demo/spirit/packages/agent-core",
      relativePath: "packages/agent-core",
      trailingSlash: false,
    },
  );
});

test("resolveMarkdownWorkspaceLink ignores http fragments and javascript", () => {
  assert.equal(
    resolveMarkdownWorkspaceLink("https://example.com/a.md", {
      baseDir: workspaceRoot,
      workspaceRoot,
    }),
    null,
  );
  assert.equal(
    resolveMarkdownWorkspaceLink("#desktop", { baseDir: workspaceRoot, workspaceRoot }),
    null,
  );
  assert.equal(
    resolveMarkdownWorkspaceLink("javascript:alert(1)", { baseDir: workspaceRoot, workspaceRoot }),
    null,
  );
});

test("resolveMarkdownWorkspaceLink rejects paths that escape the workspace", () => {
  assert.equal(
    resolveMarkdownWorkspaceLink("../../etc/passwd", { baseDir: docsDir, workspaceRoot }),
    null,
  );
  assert.equal(
    resolveMarkdownWorkspaceLink("/etc/passwd", { baseDir: docsDir, workspaceRoot }),
    null,
  );
  assert.equal(
    resolveMarkdownWorkspaceLink("/Users/demo/outside/secret.md", {
      baseDir: workspaceRoot,
      workspaceRoot,
    }),
    null,
  );
});

test("inferMarkdownWorkspaceLinkKind prefers stat then slash then extension", () => {
  assert.equal(
    inferMarkdownWorkspaceLinkKind(
      { relativePath: "LICENSE", trailingSlash: false },
      { exists: true, isFile: true },
    ),
    "file",
  );
  assert.equal(
    inferMarkdownWorkspaceLinkKind(
      { relativePath: "packages/agent-core", trailingSlash: false },
      { exists: true, isFile: false },
    ),
    "directory",
  );
  assert.equal(
    inferMarkdownWorkspaceLinkKind({ relativePath: "docs/README_zh-CN.md", trailingSlash: false }),
    "file",
  );
  assert.equal(
    inferMarkdownWorkspaceLinkKind({ relativePath: "packages/agent-core", trailingSlash: false }),
    "directory",
  );
  assert.equal(
    inferMarkdownWorkspaceLinkKind({ relativePath: "", trailingSlash: false }),
    "directory",
  );
});

test("tryHandleMarkdownWorkspaceLink opens files in a new tab and reveals directories", async () => {
  const opened = [];
  const revealed = [];
  const openedReady = Promise.withResolvers();
  const revealedReady = Promise.withResolvers();
  assert.equal(
    tryHandleMarkdownWorkspaceLink(
      "docs/README_zh-CN.md",
      {
        openWorkspaceFileInNewTab: (relativePath, options) => {
          opened.push({ relativePath, options });
          openedReady.resolve();
        },
        revealWorkspaceDirectory: (relativePath) => revealed.push(relativePath),
        statHostTextFile: async () => ({ exists: true, isFile: true }),
      },
      { baseDir: workspaceRoot, workspaceRoot },
    ),
    true,
  );
  assert.equal(
    tryHandleMarkdownWorkspaceLink(
      "packages/agent-core",
      {
        openWorkspaceFileInNewTab: (relativePath, options) =>
          opened.push({ relativePath, options }),
        revealWorkspaceDirectory: (relativePath) => {
          revealed.push(relativePath);
          revealedReady.resolve();
        },
        statHostTextFile: async () => ({ exists: true, isFile: false }),
      },
      { baseDir: workspaceRoot, workspaceRoot },
    ),
    true,
  );
  await Promise.all([openedReady.promise, revealedReady.promise]);
  assert.deepEqual(opened, [
    { relativePath: "docs/README_zh-CN.md", options: { viewMode: "preview" } },
  ]);
  assert.deepEqual(revealed, ["packages/agent-core"]);
});

test("tryHandleMarkdownWorkspaceLink falls back when stat rejects", async () => {
  const opened = [];
  const revealed = [];
  const openedReady = Promise.withResolvers();
  const revealedReady = Promise.withResolvers();
  assert.equal(
    tryHandleMarkdownWorkspaceLink(
      "docs/README_zh-CN.md",
      {
        openWorkspaceFileInNewTab: (relativePath, options) => {
          opened.push({ relativePath, options });
          openedReady.resolve();
        },
        revealWorkspaceDirectory: () => {},
        statHostTextFile: async () => {
          throw new Error("host unavailable");
        },
      },
      { baseDir: workspaceRoot, workspaceRoot },
    ),
    true,
  );
  assert.equal(
    tryHandleMarkdownWorkspaceLink(
      "packages/agent-core",
      {
        openWorkspaceFileInNewTab: () => {},
        revealWorkspaceDirectory: (relativePath) => {
          revealed.push(relativePath);
          revealedReady.resolve();
        },
        statHostTextFile: async () => {
          throw new Error("host unavailable");
        },
      },
      { baseDir: workspaceRoot, workspaceRoot },
    ),
    true,
  );
  await Promise.all([openedReady.promise, revealedReady.promise]);
  assert.deepEqual(opened, [
    { relativePath: "docs/README_zh-CN.md", options: { viewMode: "preview" } },
  ]);
  assert.deepEqual(revealed, ["packages/agent-core"]);
});
