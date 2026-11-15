import assert from "node:assert/strict";
import { test } from "vitest";

import { assertExtensionExternalUrl } from "../../electron/extension-external-url.ts";

test("extension external URLs allow HTTPS and loopback HTTP", () => {
  assert.equal(
    assertExtensionExternalUrl("https://github.com/login/device").hostname,
    "github.com",
  );
  for (const value of [
    "http://localhost:4173/device",
    "http://127.0.0.1:4173/device",
    "http://[::1]:4173/device",
  ]) {
    assert.equal(assertExtensionExternalUrl(value).protocol, "http:");
  }
});

test("extension external URLs reject insecure remote and non-web protocols", () => {
  for (const value of [
    "http://example.com/device",
    "file:///tmp/device",
    "javascript:alert(1)",
    "spirit://extension-ui/view",
  ]) {
    assert.throws(() => assertExtensionExternalUrl(value), /HTTPS or loopback HTTP/);
  }
});
