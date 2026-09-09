import assert from "node:assert/strict";
import { test } from "vitest";

import {
  dismissOpenExtensionView,
  getOpenExtensionView,
  openExtensionView,
  resolveOpenExtensionView,
} from "../../src/lib/extension-view-runtime.ts";

test("openExtensionView stays pending until resolve", async () => {
  const opened = openExtensionView({
    requestId: "req-1",
    extensionId: "built-in/demo",
    viewId: "main",
    viewUrl: "spirit://extension-ui/view?extensionId=built-in%2Fdemo&viewId=main",
    title: "Demo",
    params: { ok: true },
  });
  assert.equal(getOpenExtensionView()?.requestId, "req-1");
  resolveOpenExtensionView("req-1", { enabled: true });
  assert.deepEqual(await opened, { enabled: true });
  assert.equal(getOpenExtensionView(), null);
});

test("dismiss reports dismissed without throwing", async () => {
  const opened = openExtensionView({
    requestId: "req-2",
    extensionId: "built-in/demo",
    viewId: "main",
    viewUrl: "spirit://extension-ui/view?extensionId=built-in%2Fdemo&viewId=main",
  });
  dismissOpenExtensionView("req-2");
  assert.deepEqual(await opened, { dismissed: true });
});
