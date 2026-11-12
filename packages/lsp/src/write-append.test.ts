import assert from "node:assert/strict";
import { test } from "vitest";

import { createToolExecutionTextOutput } from "@spiritagent/agent-core";
import { DEFAULT_LSP_TIMING } from "./config.js";
import { LspDisabledError, LspTimeoutError } from "./errors.js";
import { appendLspDiagnosticsAfterWriteIfNeeded } from "./write-append.js";
import type { LspService } from "./service.js";

type WriteAppendLspMock = Pick<
  LspService,
  "enabled" | "workspaceRoot" | "hasReadyProviderForPath" | "getDiagnosticsForPath"
>;

function writeAppendLspMock(
  mock: Omit<WriteAppendLspMock, "hasReadyProviderForPath"> & {
    hasReadyProviderForPath?: WriteAppendLspMock["hasReadyProviderForPath"];
  },
): LspService {
  return {
    hasReadyProviderForPath: () => true,
    ...mock,
  } as unknown as LspService;
}

test("appendLspDiagnosticsAfterWriteIfNeeded leaves non-write tools unchanged", async () => {
  const output = createToolExecutionTextOutput("ok");
  const result = await appendLspDiagnosticsAfterWriteIfNeeded(
    undefined,
    { name: "read_file", path: "a.py" },
    output,
  );
  assert.equal(result.summaryText, "ok");
});

test("appendLspDiagnosticsAfterWriteIfNeeded attaches hostUi for write tools", async () => {
  const lsp = writeAppendLspMock({
    enabled: true,
    workspaceRoot: "D:\\Spirit",
    getDiagnosticsForPath: async () => ({
      relativePath: "packages/agent-core/src/a.py",
      diagnostics: [
        {
          severity: 1,
          message: "Type mismatch",
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } },
          source: "pyright",
          code: "reportAssignmentType",
        },
        {
          severity: 2,
          message: "Unused",
          range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } },
        },
      ],
      formatted: "ignored",
    }),
  });

  const output = createToolExecutionTextOutput("[write]\naction: edit_file");
  const result = await appendLspDiagnosticsAfterWriteIfNeeded(
    lsp,
    { name: "edit_file", path: "packages/agent-core/src/a.py" },
    output,
  );

  assert.match(result.summaryText, /\[lsp\]/);
  assert.equal(result.hostUi?.lspWriteDiagnostics?.relativePath, "packages/agent-core/src/a.py");
  assert.equal(result.hostUi?.lspWriteDiagnostics?.items.length, 2);
  assert.equal(result.hostUi?.lspWriteDiagnostics?.items[0]?.severity, "error");
  assert.equal(result.hostUi?.lspWriteDiagnostics?.items[0]?.line, 1);
});

test("appendLspDiagnosticsAfterWriteIfNeeded skips unsupported extensions", async () => {
  let called = false;
  const lsp = writeAppendLspMock({
    enabled: true,
    workspaceRoot: "D:\\Spirit",
    hasReadyProviderForPath: () => false,
    getDiagnosticsForPath: async () => {
      called = true;
      return {
        relativePath: "index.html",
        diagnostics: [],
        formatted: "",
      };
    },
  });

  const output = createToolExecutionTextOutput("ok");
  const result = await appendLspDiagnosticsAfterWriteIfNeeded(
    lsp,
    { name: "edit_file", path: "index.html" },
    output,
  );
  assert.equal(called, false);
  assert.equal(result.summaryText, "ok");
});

test("appendLspDiagnosticsAfterWriteIfNeeded skips in-scope paths when provider is not ready", async () => {
  let called = false;
  const lsp = writeAppendLspMock({
    enabled: true,
    workspaceRoot: "D:\\Spirit",
    hasReadyProviderForPath: () => false,
    getDiagnosticsForPath: async () => {
      called = true;
      return {
        relativePath: "main.py",
        diagnostics: [],
        formatted: "",
      };
    },
  });

  const result = await appendLspDiagnosticsAfterWriteIfNeeded(
    lsp,
    { name: "edit_file", path: "main.py" },
    createToolExecutionTextOutput("ok"),
  );
  assert.equal(called, false);
  assert.equal(result.summaryText, "ok");
});

test("appendLspDiagnosticsAfterWriteIfNeeded routes Python writes when provider is ready", async () => {
  let called = false;
  const lsp = writeAppendLspMock({
    enabled: true,
    workspaceRoot: "D:\\Spirit",
    hasReadyProviderForPath: () => true,
    getDiagnosticsForPath: async () => {
      called = true;
      return {
        relativePath: "main.py",
        diagnostics: [],
        formatted: "",
      };
    },
  });

  await appendLspDiagnosticsAfterWriteIfNeeded(
    lsp,
    { name: "edit_file", path: "main.py" },
    createToolExecutionTextOutput("ok"),
  );
  assert.equal(called, true);
});

test("appendLspDiagnosticsAfterWriteIfNeeded waits with writeAppendDiagnosticsWaitMs", async () => {
  let waitMs: number | undefined;
  const lsp = writeAppendLspMock({
    enabled: true,
    workspaceRoot: "D:\\Spirit",
    getDiagnosticsForPath: async (_path: string, timeoutMs?: number) => {
      waitMs = timeoutMs;
      return {
        relativePath: "packages/agent-core/src/a.py",
        diagnostics: [],
        formatted: "",
      };
    },
  });

  await appendLspDiagnosticsAfterWriteIfNeeded(
    lsp,
    { name: "edit_file", path: "packages/agent-core/src/a.py" },
    createToolExecutionTextOutput("ok"),
  );

  assert.equal(waitMs, DEFAULT_LSP_TIMING.writeAppendDiagnosticsWaitMs);
});

test("appendLspDiagnosticsAfterWriteIfNeeded appends pending note only on timeout", async () => {
  const lsp = writeAppendLspMock({
    enabled: true,
    workspaceRoot: "D:\\Spirit",
    getDiagnosticsForPath: async () => {
      throw new LspTimeoutError("diagnostics timed out");
    },
  });

  const result = await appendLspDiagnosticsAfterWriteIfNeeded(
    lsp,
    { name: "edit_file", path: "packages/agent-core/src/a.py" },
    createToolExecutionTextOutput("ok"),
  );
  assert.match(result.summaryText, /diagnostics pending or timed out/);
});

test("appendLspDiagnosticsAfterWriteIfNeeded leaves output unchanged on disabled provider errors", async () => {
  const lsp = writeAppendLspMock({
    enabled: true,
    workspaceRoot: "D:\\Spirit",
    getDiagnosticsForPath: async () => {
      throw new LspDisabledError("no language server is available for .py files");
    },
  });

  const result = await appendLspDiagnosticsAfterWriteIfNeeded(
    lsp,
    { name: "edit_file", path: "main.py" },
    createToolExecutionTextOutput("ok"),
  );
  assert.equal(result.summaryText, "ok");
});

test("appendLspDiagnosticsAfterWriteIfNeeded merges into an existing hostUi payload", async () => {
  const lsp = writeAppendLspMock({
    enabled: true,
    workspaceRoot: "D:\\Spirit",
    getDiagnosticsForPath: async () => ({
      relativePath: "packages/agent-core/src/a.py",
      diagnostics: [
        {
          severity: 1,
          message: "Type mismatch",
          range: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } },
          source: "pyright",
          code: "reportAssignmentType",
        },
      ],
      formatted: "ignored",
    }),
  });

  const fileChangeDiff = { path: "packages/agent-core/src/a.py", before: "a", after: "b" };
  const output = {
    ...createToolExecutionTextOutput("[write]\naction: apply_patch"),
    hostUi: { fileChangeDiff },
  };
  const result = await appendLspDiagnosticsAfterWriteIfNeeded(
    lsp,
    {
      name: "apply_patch",
      operation: { type: "update_file", path: "packages/agent-core/src/a.py" },
    },
    output,
  );

  // The executor's fileChangeDiff survives; the diagnostics badge joins alongside.
  assert.deepEqual(result.hostUi?.fileChangeDiff, fileChangeDiff);
  assert.equal(result.hostUi?.lspWriteDiagnostics?.relativePath, "packages/agent-core/src/a.py");
});
