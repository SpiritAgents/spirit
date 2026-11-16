import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { writeChangedFile } from "./write-changed-file.mjs";

test("unchanged generated content does not touch the file", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "spirit-icons-write-"));
  try {
    const file = path.join(directory, "generated.ts");
    assert.equal(writeChangedFile(file, "export const value = 1;\n"), true);
    const initialMtime = statSync(file).mtimeMs;

    assert.equal(writeChangedFile(file, "export const value = 1;\n"), false);
    assert.equal(statSync(file).mtimeMs, initialMtime);

    assert.equal(writeChangedFile(file, "export const value = 2;\n"), true);
    assert.equal(readFileSync(file, "utf8"), "export const value = 2;\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
