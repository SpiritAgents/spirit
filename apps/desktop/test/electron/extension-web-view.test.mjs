import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isExtensionWebViewUrlAllowed,
  requireExtensionWebViewCapability,
  scaleExtensionWebViewBounds,
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

test("renderer CSS bounds scale into native window coordinates", () => {
  assert.deepEqual(
    scaleExtensionWebViewBounds({ x: 10.4, y: 20.5, width: 300.2, height: 200.8 }, 1.25),
    { x: 13, y: 26, width: 375, height: 251 },
  );
  assert.deepEqual(scaleExtensionWebViewBounds({ x: 0, y: 0, width: -1, height: 100 }, 0), {
    x: 0,
    y: 0,
    width: 0,
    height: 100,
  });
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
