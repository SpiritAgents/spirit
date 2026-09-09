import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import {
  buildExtensionViewSrcdoc,
  extensionViewFileUrl,
  SPIRIT_EXTENSION_UI_RUNTIME_URL,
  SPIRIT_EXTENSION_VIEW_CLOSE_MESSAGE,
} from "../../src/lib/extension-view-frame.ts";
import {
  assertResolvedViewFilePath,
  parseExtensionUiUrl,
} from "../../electron/extension-ui-protocol.ts";

test("srcdoc injects live cssText and the View default-export contract", () => {
  const html = buildExtensionViewSrcdoc({
    cssText: ":root { --foreground: black; } .text-muted-foreground { color: gray; }",
    chrome: { htmlClassName: "dark", htmlStyle: "font-family: Geist" },
    viewUrl: extensionViewFileUrl("built-in/demo", "main"),
    params: { step: 1 },
  });

  assert.match(html, /--foreground: black/);
  assert.match(html, /class="dark"/);
  assert.match(html, /default-export function View\(\{ params, close \}\)/);
  assert.match(html, new RegExp(SPIRIT_EXTENSION_VIEW_CLOSE_MESSAGE));
  assert.match(html, new RegExp(SPIRIT_EXTENSION_UI_RUNTIME_URL.replaceAll("/", "\\/")));
  assert.doesNotMatch(html, /token-stylesheet\.css/);
});

test("protocol only serves runtime.js and a declared view identity", () => {
  assert.deepEqual(parseExtensionUiUrl(new URL("spirit://extension-ui/runtime.js")), {
    kind: "runtime",
  });
  assert.deepEqual(
    parseExtensionUiUrl(new URL("spirit://extension-ui/view?extensionId=built-in%2Fdemo&viewId=main")),
    { kind: "view", extensionId: "built-in/demo", viewId: "main" },
  );
  assert.equal(parseExtensionUiUrl(new URL("spirit://extension-ui/chunk.js")).kind, "invalid");
  assert.equal(
    parseExtensionUiUrl(new URL("spirit://extension-ui/view?extensionId=../x&viewId=main")).kind,
    "invalid",
  );
});

test("fixture view uses the same default-export View contract", () => {
  const fixture = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/extension-view/view.mjs"),
    "utf8",
  );
  assert.match(fixture, /export default function View\(\{ params, close \}\)/);
});

test("resolved view files cannot escape the extension root", () => {
  assert.equal(
    assertResolvedViewFilePath("/tmp/ext/ui/view.mjs", "/tmp/ext"),
    "/tmp/ext/ui/view.mjs",
  );
  assert.throws(
    () => assertResolvedViewFilePath("/tmp/other/secret.mjs", "/tmp/ext"),
    /escapes the extension directory/,
  );
});
