import assert from "node:assert/strict";
import { test } from "vitest";

import { applyPatchSnippetPair } from "../../src/lib/apply-patch-snippet.ts";

test("applyPatchSnippetPair reconstructs a single-hunk update pair", () => {
  const pair = applyPatchSnippetPair({
    type: "update_file",
    diff: "@@ \n const a = 1;\n-const b = 2;\n+const b = 3;\n const c = 4;\n*** End Patch",
  });

  assert.equal(pair?.original, "const a = 1;\nconst b = 2;\nconst c = 4;");
  assert.equal(pair?.modified, "const a = 1;\nconst b = 3;\nconst c = 4;");
});

test("applyPatchSnippetPair keeps both hunks of a multi-hunk update in order", () => {
  const pair = applyPatchSnippetPair({
    type: "update_file",
    diff: '@@ \n-import a from "a";\n+import a from "a2";\n@@ keep\n-return 1;\n+return 2;\n*** End Patch',
  });

  assert.equal(pair?.original, 'import a from "a";\nreturn 1;');
  assert.equal(pair?.modified, 'import a from "a2";\nreturn 2;');
});

test("applyPatchSnippetPair treats a bare empty line as an empty context line", () => {
  const pair = applyPatchSnippetPair({
    type: "update_file",
    diff: "@@ \n alpha\n\n-beta\n+BETA\n*** End Patch",
  });

  assert.equal(pair?.original, "alpha\n\nbeta");
  assert.equal(pair?.modified, "alpha\n\nBETA");
});

test("applyPatchSnippetPair renders create_file as an all-new pair", () => {
  const pair = applyPatchSnippetPair({
    type: "create_file",
    diff: "+one\n+two\n*** End Patch",
  });

  assert.equal(pair?.original, "");
  assert.equal(pair?.modified, "one\ntwo");
});

test("applyPatchSnippetPair returns undefined for delete_file or empty diffs", () => {
  assert.equal(applyPatchSnippetPair({ type: "delete_file" }), undefined);
  assert.equal(applyPatchSnippetPair({ type: "update_file", diff: "   " }), undefined);
  assert.equal(
    applyPatchSnippetPair({ type: "update_file", diff: "@@ \n*** End Patch" }),
    undefined,
  );
});
