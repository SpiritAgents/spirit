import assert from "node:assert/strict";
import { test } from "vitest";

import {
  FILE_DIFF_TOOL_NAMES,
  resolveFileToolDiffSource,
} from "../../src/lib/file-tool-diff-source.ts";

test("FILE_DIFF_TOOL_NAMES includes the file/plan tools and apply_patch", () => {
  assert.equal(FILE_DIFF_TOOL_NAMES.size, 5);
  assert.ok(FILE_DIFF_TOOL_NAMES.has("create_file"));
  assert.ok(FILE_DIFF_TOOL_NAMES.has("create_plan"));
  assert.ok(FILE_DIFF_TOOL_NAMES.has("edit_file"));
  assert.ok(FILE_DIFF_TOOL_NAMES.has("delete_file"));
  assert.ok(FILE_DIFF_TOOL_NAMES.has("apply_patch"));
});

test("resolveFileToolDiffSource returns undefined when collapsed", () => {
  const tool = {
    toolName: "create_file",
    phase: "preview",
    headline: "Create",
    detailLines: [],
    streamingArgumentsJson: '{"path":"a.ts","content":"hello"}',
  };
  assert.equal(resolveFileToolDiffSource(tool, { open: false }), undefined);
});

test("resolveFileToolDiffSource parses streaming create_file content", () => {
  const tool = {
    toolName: "create_file",
    phase: "preview",
    headline: "Create",
    detailLines: [],
    streamingArgumentsJson: '{"path":"src/a.ts","content":"line1\\nline2',
  };
  const result = resolveFileToolDiffSource(tool, { open: true });
  assert.ok(result && typeof result === "object" && "modified" in result);
  assert.equal(result.original, "");
  assert.equal(result.modified, "line1\nline2");
  assert.equal(result.relativePath, "src/a.ts");
  assert.equal(result.languageId, "typescript");
});

test("resolveFileToolDiffSource parses complete edit_file from argsExcerpt", () => {
  const request = {
    path: "m.ts",
    old_text: "a\nb",
    new_text: "a\nc",
  };
  const tool = {
    toolName: "edit_file",
    phase: "succeeded",
    headline: "Edit",
    detailLines: [],
    argsExcerpt: JSON.stringify(request, null, 2),
  };
  const result = resolveFileToolDiffSource(tool, { open: true });
  assert.deepEqual(result, {
    relativePath: "m.ts",
    languageId: "typescript",
    original: "a\nb",
    modified: "a\nc",
  });
});

test("resolveFileToolDiffSource uses delete baseline", () => {
  const tool = {
    toolName: "delete_file",
    phase: "succeeded",
    headline: "Delete",
    detailLines: [],
    deleteFileBaselineText: "gone\nsoon",
    argsExcerpt: JSON.stringify({ path: "x.txt" }, null, 2),
  };
  const result = resolveFileToolDiffSource(tool, { open: true });
  assert.equal(result.original, "gone\nsoon");
  assert.equal(result.modified, "");
});

test("resolveFileToolDiffSource maps create_plan name to plans path", () => {
  const tool = {
    toolName: "create_plan",
    phase: "preview",
    headline: "Plan",
    detailLines: [],
    streamingArgumentsJson: '{"name":"my-plan","content":"# Plan"}',
  };
  const result = resolveFileToolDiffSource(tool, { open: true });
  assert.equal(result.relativePath, "plans/my-plan.md");
  assert.equal(result.modified, "# Plan");
});

test("resolveFileToolDiffSource reconstructs an apply_patch update diff from its args", () => {
  const tool = {
    toolName: "apply_patch",
    phase: "succeeded",
    headline: "Edited",
    detailLines: [],
    argsExcerpt: JSON.stringify({
      operation: {
        type: "update_file",
        path: "m.ts",
        diff: "@@ \n const a = 1;\n-const b = 2;\n+const b = 3;\n*** End Patch",
      },
    }),
  };
  const result = resolveFileToolDiffSource(tool, { open: true });
  assert.deepEqual(result, {
    relativePath: "m.ts",
    languageId: "typescript",
    original: "const a = 1;\nconst b = 2;",
    modified: "const a = 1;\nconst b = 3;",
  });
});

test("resolveFileToolDiffSource renders an apply_patch create as all-new content", () => {
  const tool = {
    toolName: "apply_patch",
    phase: "succeeded",
    headline: "Created",
    detailLines: [],
    argsExcerpt: JSON.stringify({
      operation: { type: "create_file", path: "new.md", diff: "+# Hi\n+there\n*** End Patch" },
    }),
  };
  const result = resolveFileToolDiffSource(tool, { open: true });
  assert.deepEqual(result, {
    relativePath: "new.md",
    languageId: "markdown",
    original: "",
    modified: "# Hi\nthere",
  });
});

test("resolveFileToolDiffSource renders an apply_patch delete from the frozen baseline", () => {
  const tool = {
    toolName: "apply_patch",
    phase: "succeeded",
    headline: "Deleted",
    detailLines: [],
    argsExcerpt: JSON.stringify({ operation: { type: "delete_file", path: "gone.txt" } }),
    deleteFileBaselineText: "doomed\ncontent",
  };
  assert.deepEqual(resolveFileToolDiffSource(tool, { open: true }), {
    relativePath: "gone.txt",
    languageId: "plaintext",
    original: "doomed\ncontent",
    modified: "",
  });
});

test("resolveFileToolDiffSource renders an apply_patch delete even without a baseline", () => {
  // No preview ran (e.g. old persisted timeline): same shape as a delete_file card.
  const tool = {
    toolName: "apply_patch",
    phase: "succeeded",
    headline: "Deleted",
    detailLines: [],
    argsExcerpt: JSON.stringify({ operation: { type: "delete_file", path: "gone.txt" } }),
    outputExcerpt: "[write]\naction: apply_patch\noperation: delete_file\npath: gone.txt",
  };
  assert.deepEqual(resolveFileToolDiffSource(tool, { open: true }), {
    relativePath: "gone.txt",
    languageId: "plaintext",
    original: "",
    modified: "",
  });
});

test("resolveFileToolDiffSource prefers the executor fileChangeDiff pair over the patch snippet", () => {
  const tool = {
    toolName: "apply_patch",
    phase: "succeeded",
    headline: "Edited",
    detailLines: [],
    argsExcerpt: JSON.stringify({
      operation: { type: "update_file", path: "m.ts", diff: "@@ \n-a\n+b\n*** End Patch" },
    }),
    fileChangeDiff: { path: "m.ts", before: "x\na\ny", after: "x\nb\ny" },
  };
  assert.deepEqual(resolveFileToolDiffSource(tool, { open: true }), {
    relativePath: "m.ts",
    languageId: "typescript",
    original: "x\na\ny",
    modified: "x\nb\ny",
  });
});

test("resolveFileToolDiffSource renders an executor delete diff for apply_patch", () => {
  const tool = {
    toolName: "apply_patch",
    phase: "succeeded",
    headline: "Deleted",
    detailLines: [],
    argsExcerpt: JSON.stringify({ operation: { type: "delete_file", path: "gone.txt" } }),
    fileChangeDiff: { path: "gone.txt", before: "doomed\ncontent", after: "" },
  };
  assert.deepEqual(resolveFileToolDiffSource(tool, { open: true }), {
    relativePath: "gone.txt",
    languageId: "plaintext",
    original: "doomed\ncontent",
    modified: "",
  });
});

test("resolveFileToolDiffSource uses planBaselineText for create_plan overwrite", () => {
  const tool = {
    toolName: "create_plan",
    phase: "preview",
    headline: "Plan",
    detailLines: [],
    streamingArgumentsJson: '{"name":"my-plan","content":"# New"}',
  };
  const result = resolveFileToolDiffSource(tool, {
    open: true,
    planBaselineText: "# Old\n",
  });
  assert.equal(result.original, "# Old\n");
  assert.equal(result.modified, "# New");
});

test("resolveFileToolDiffSource reports truncated argsExcerpt", () => {
  const tool = {
    toolName: "create_file",
    phase: "succeeded",
    headline: "Create",
    detailLines: [],
    argsExcerpt: '{"path":"big.ts","content":"unclosed',
  };
  assert.equal(resolveFileToolDiffSource(tool, { open: true }), "truncated");
});

test("resolveFileToolDiffSource uses fileToolDiffArgumentsJson when argsExcerpt truncated", () => {
  const content = "x".repeat(5000);
  const request = { path: "test-messy.txt", content };
  const tool = {
    toolName: "create_file",
    phase: "succeeded",
    headline: "Create",
    detailLines: [],
    argsExcerpt: `${JSON.stringify(request).slice(0, 4000)}...<truncated>`,
    fileToolDiffArgumentsJson: JSON.stringify(request),
  };
  const result = resolveFileToolDiffSource(tool, { open: true });
  assert.ok(result && typeof result === "object" && "modified" in result);
  assert.equal(result.modified, content);
  assert.equal(result.relativePath, "test-messy.txt");
});

test("resolveFileToolDiffSource resolves create_plan from host request plan_name", () => {
  const request = {
    name: "create_plan",
    plan_name: "my-plan",
    content: "# Plan body",
  };
  const tool = {
    toolName: "create_plan",
    phase: "pending-approval",
    headline: "Plan",
    detailLines: [],
    argsExcerpt: '{"name":"create_plan","plan_name":"my-plan"...<truncated>',
    fileToolDiffArgumentsJson: JSON.stringify(request),
  };
  const result = resolveFileToolDiffSource(tool, { open: true });
  assert.ok(result && typeof result === "object" && "modified" in result);
  assert.equal(result.relativePath, "plans/my-plan.md");
  assert.equal(result.modified, "# Plan body");
});

test("resolveFileToolDiffSource keeps diff during pending-approval via streamingArgumentsJson fallback", () => {
  const tool = {
    toolName: "create_plan",
    phase: "pending-approval",
    headline: "Plan",
    detailLines: [],
    argsExcerpt: '{"name":"debug-diagnostics-subsystem","content":"# Plan"...<truncated>',
    streamingArgumentsJson: JSON.stringify({
      name: "debug-diagnostics-subsystem",
      content: "# Plan\n\nLong body",
    }),
  };
  const result = resolveFileToolDiffSource(tool, { open: true });
  assert.ok(result && typeof result === "object" && "modified" in result);
  assert.equal(result.relativePath, "plans/debug-diagnostics-subsystem.md");
  assert.equal(result.modified, "# Plan\n\nLong body");
});
