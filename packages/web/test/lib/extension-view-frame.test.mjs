import { product } from "@spiritagent/product";
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  extensionPageUrl,
  matchesExtensionPageIdentity,
} from "../../src/lib/extension-page-frame.ts";
import {
  assertResolvedViewFilePath,
  parseExtensionUiUrl,
} from "../../../../apps/desktop/electron/extension-ui-protocol.ts";
const identity = {
  extensionId: "built-in/demo",
  contributionId: "authorize",
  instanceId: "request-1",
  channelId: "channel-1",
};

test("View and Tab use the same packaged document identity and resource tree", () => {
  for (const kind of ["view", "tab"]) {
    const url = new URL(extensionPageUrl(kind, identity));
    assert.deepEqual(parseExtensionUiUrl(url), {
      kind,
      extensionId: identity.extensionId,
      contributionId: identity.contributionId,
      instanceId: identity.instanceId,
      assetPath: "index.html",
    });
    assert.equal(url.searchParams.get("channelId"), "channel-1");
    assert.equal(parseExtensionUiUrl(new URL("./assets/page.js", url)).assetPath, "assets/page.js");
  }
});
test("component-only view and React runtime URLs are no longer served", () => {
  for (const path of [
    "runtime.js",
    "tab-runtime.js",
    "view?extensionId=built-in%2Fdemo&viewId=authorize",
  ]) {
    assert.equal(
      parseExtensionUiUrl(new URL(`${product.urlProtocol}://extension-ui/${path}`)).kind,
      "invalid",
    );
  }
});
test("page messages require every identity field", () => {
  assert.ok(matchesExtensionPageIdentity(identity, identity));
  for (const key of Object.keys(identity))
    assert.equal(matchesExtensionPageIdentity({ ...identity, [key]: "another" }, identity), false);
  assert.equal(matchesExtensionPageIdentity(null, identity), false);
});
test("packaged asset paths cannot escape their root", () => {
  assert.equal(
    assertResolvedViewFilePath("/extension/ui/page.html", "/extension"),
    "/extension/ui/page.html",
  );
  assert.throws(() => assertResolvedViewFilePath("/other/page.html", "/extension"), /escapes/);
});
