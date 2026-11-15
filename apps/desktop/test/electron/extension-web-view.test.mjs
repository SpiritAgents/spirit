import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isExtensionWebViewUrlAllowed,
  requireExtensionWebViewCapability,
} from "../../electron/extension-web-view.ts";

test("native web views allow web pages but reject privileged and local-file URLs", () => {
  assert.equal(isExtensionWebViewUrlAllowed("about:blank"), true);
  assert.equal(isExtensionWebViewUrlAllowed("http://127.0.0.1:4173"), true);
  assert.equal(isExtensionWebViewUrlAllowed("https://example.com"), true);
  for (const url of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hello",
    "spirit://extension-ui/runtime.js",
    "chrome://settings",
  ]) {
    assert.equal(isExtensionWebViewUrlAllowed(url), false);
  }
});

test("native capabilities gate display, control, and script independently", () => {
  const owner = (capabilities) => ({ capabilities: new Set(capabilities) });
  assert.doesNotThrow(() =>
    requireExtensionWebViewCapability(
      owner(["desktop-webview-display"]),
      "desktop-webview-display",
    ),
  );
  assert.throws(
    () => requireExtensionWebViewCapability(owner([]), "desktop-webview-display"),
    /desktop-webview-display/,
  );
  assert.throws(
    () =>
      requireExtensionWebViewCapability(
        owner(["desktop-webview-script"]),
        "desktop-webview-script",
      ),
    /also requires desktop-webview-control/,
  );
  assert.doesNotThrow(() =>
    requireExtensionWebViewCapability(
      owner(["desktop-webview-control", "desktop-webview-script"]),
      "desktop-webview-script",
    ),
  );
});
