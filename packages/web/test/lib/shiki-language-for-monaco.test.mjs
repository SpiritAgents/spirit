import assert from "node:assert/strict";
import { test } from "vitest";

import { resolveShikiLanguageAlias } from "../../src/lib/shiki-language-aliases.ts";

test("resolveShikiLanguageAlias maps aliases and plaintext", () => {
  assert.equal(resolveShikiLanguageAlias("typescript"), "typescript");
  assert.equal(resolveShikiLanguageAlias("jsonc"), "json");
  assert.equal(resolveShikiLanguageAlias("shell"), "shell");
  assert.equal(resolveShikiLanguageAlias("plaintext"), undefined);
  assert.equal(resolveShikiLanguageAlias("unknown-lang-xyz"), "unknown-lang-xyz");
});
