import assert from "node:assert/strict";
import { test } from "vitest";
import { product } from "@spiritagent/product";

import {
  EXTENSION_TAB_PAGE_CSP,
  extensionAssetMimeType,
  injectExtensionTabRuntime,
  parseExtensionUiUrl,
  shouldBlockExtensionTabNavigation,
} from "../../electron/extension-ui-protocol.ts";

test("tab protocol resolves encoded identities and packaged assets", () => {
  assert.deepEqual(
    parseExtensionUiUrl(
      new URL("spirit://extension-ui/tab/personal%2Fdemo/notes/instance-1/assets/app.js"),
    ),
    {
      kind: "tab",
      extensionId: "personal/demo",
      contributionId: "notes",
      instanceId: "instance-1",
      assetPath: "assets/app.js",
    },
  );
  assert.deepEqual(
    parseExtensionUiUrl(new URL("spirit://extension-ui/tab-icon/personal%2Fdemo/assets/icon.svg")),
    { kind: "tab-icon", extensionId: "personal/demo", iconPath: "assets/icon.svg" },
  );
  assert.equal(
    parseExtensionUiUrl(new URL("spirit://extension-ui/tab-runtime.js")).kind,
    "tab-runtime",
  );
});

test("tab protocol rejects traversal and malformed identities", () => {
  assert.equal(
    parseExtensionUiUrl(
      new URL("spirit://extension-ui/tab/personal%2Fdemo/notes/instance-1/%2E%2E/secret"),
    ).kind,
    "invalid",
  );
  assert.equal(
    parseExtensionUiUrl(
      new URL("spirit://extension-ui/tab/not-an-extension/notes/instance-1/index.html"),
    ).kind,
    "invalid",
  );
  assert.equal(
    parseExtensionUiUrl(new URL("spirit://extension-ui/tab-icon/personal%2Fdemo/%2E%2E/secret.svg"))
      .kind,
    "invalid",
  );
});

test("HTML receives the external runtime without inline host privileges", () => {
  assert.equal(
    injectExtensionTabRuntime(
      "<!doctype html><html><head><title>Demo</title></head><body></body></html>",
    ),
    `<!doctype html><html><head><script src="${product.urlProtocol}://extension-ui/tab-runtime.js"></script><title>Demo</title></head><body></body></html>`,
  );
  assert.match(EXTENSION_TAB_PAGE_CSP, /default-src 'none'/);
  assert.match(EXTENSION_TAB_PAGE_CSP, /frame-src 'none'/);
  assert.doesNotMatch(EXTENSION_TAB_PAGE_CSP, /allow-same-origin/);
  assert.equal(extensionAssetMimeType("app.mjs"), "text/javascript; charset=utf-8");
  assert.equal(extensionAssetMimeType("icon.svg"), "image/svg+xml");
});

test("extension documents cannot navigate away to a remote or different local document", () => {
  const current = `${product.urlProtocol}://extension-ui/tab/personal%2Fdemo/notes/instance-1/index.html`;
  assert.equal(shouldBlockExtensionTabNavigation(current, "http://127.0.0.1:4173"), true);
  assert.equal(shouldBlockExtensionTabNavigation(current, `${current}#section`), true);
  assert.equal(shouldBlockExtensionTabNavigation(current, current), false);
  assert.equal(
    shouldBlockExtensionTabNavigation("http://127.0.0.1:1420", "http://127.0.0.1:4173"),
    false,
  );
});
