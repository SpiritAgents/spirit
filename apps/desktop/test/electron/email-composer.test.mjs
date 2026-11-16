import assert from "node:assert/strict";
import { test } from "vitest";

import { emailComposerUrl } from "../../electron/email-composer.ts";

test("email composer URLs trim and percent-encode the complete recipient", () => {
  assert.equal(emailComposerUrl("  alice+tag@example.com  "), "mailto:alice%2Btag%40example.com");
  assert.equal(
    emailComposerUrl("作者@例子.公司"),
    "mailto:%E4%BD%9C%E8%80%85%40%E4%BE%8B%E5%AD%90.%E5%85%AC%E5%8F%B8",
  );
});

test("email composer URLs cannot inject headers or another protocol", () => {
  assert.equal(
    emailComposerUrl("alice@example.com?subject=hello\r\nBcc:other@example.com"),
    "mailto:alice%40example.com%3Fsubject%3Dhello%0D%0ABcc%3Aother%40example.com",
  );
  assert.equal(emailComposerUrl("https://example.com"), "mailto:https%3A%2F%2Fexample.com");
});

test("email composer URLs reject blank recipients", () => {
  for (const value of ["", "   ", "\r\n"]) {
    assert.throws(() => emailComposerUrl(value), /must not be empty/);
  }
});
