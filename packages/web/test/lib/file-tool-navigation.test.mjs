import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveFileDiffToolEditorTarget } from "../../src/lib/file-tool-navigation.ts";

test("resolveFileDiffToolEditorTarget: create_file relative path", () => {
  assert.deepEqual(
    resolveFileDiffToolEditorTarget(
      {
        toolName: "create_file",
        phase: "succeeded",
        argsExcerpt: '{"path":"src/foo.ts","content":"export const x = 1;\\n"}',
      },
      "/proj",
    ),
    {
      scope: "workspace",
      relativePath: "src/foo.ts",
      viewMode: "edit",
    },
  );
});

test("resolveFileDiffToolEditorTarget: edit_file markdown uses preview", () => {
  assert.deepEqual(
    resolveFileDiffToolEditorTarget(
      {
        toolName: "edit_file",
        phase: "succeeded",
        argsExcerpt: '{"path":"README.md","old_text":"a","new_text":"b"}',
      },
      "/proj",
    ),
    {
      scope: "workspace",
      relativePath: "README.md",
      viewMode: "preview",
    },
  );
});

test("resolveFileDiffToolEditorTarget: absolute path under workspace becomes relative", () => {
  assert.deepEqual(
    resolveFileDiffToolEditorTarget(
      {
        toolName: "edit_file",
        phase: "succeeded",
        argsExcerpt: '{"path":"D:\\\\Spirit\\\\README.md","old_text":"a","new_text":"b"}',
      },
      "D:\\Spirit",
    ),
    {
      scope: "workspace",
      relativePath: "README.md",
      viewMode: "preview",
    },
  );
});

test("resolveFileDiffToolEditorTarget: path outside workspace uses external scope", () => {
  assert.deepEqual(
    resolveFileDiffToolEditorTarget(
      {
        toolName: "edit_file",
        phase: "succeeded",
        argsExcerpt: '{"path":"C:\\\\outside\\\\note.txt","old_text":"a","new_text":"b"}',
      },
      "D:\\Spirit",
    ),
    {
      scope: "external",
      absolutePath: "C:\\outside\\note.txt",
      viewMode: "edit",
    },
  );
});

test("resolveFileDiffToolEditorTarget: missing path returns null", () => {
  assert.equal(
    resolveFileDiffToolEditorTarget(
      {
        toolName: "create_file",
        phase: "failed",
        argsExcerpt: '{"content":"hello"}',
      },
      "/proj",
    ),
    null,
  );
});

test("resolveFileDiffToolEditorTarget: create_plan is not handled", () => {
  assert.equal(
    resolveFileDiffToolEditorTarget(
      {
        toolName: "create_plan",
        phase: "succeeded",
        argsExcerpt: '{"name":"my-plan","content":"# Plan"}',
      },
      "/proj",
    ),
    null,
  );
});
