import assert from "node:assert/strict";
import { test } from "vitest";

import { openDesktopHostExtensionUiSession } from "./service.js";

test("view sessions dismiss superseded requests and close only their own request", async () => {
  const first = openDesktopHostExtensionUiSession({
    extensionId: "personal/first",
    viewId: "authorize",
  });
  const second = openDesktopHostExtensionUiSession({
    extensionId: "personal/second",
    viewId: "authorize",
  });

  assert.deepEqual(await first.result, { dismissed: true });
  first.close({ stale: true });
  second.close({ connected: true });
  assert.deepEqual(await second.result, { connected: true });
  assert.notEqual(first.requestId, second.requestId);
});

test("closing a settled view session is a no-op", async () => {
  const session = openDesktopHostExtensionUiSession({
    extensionId: "personal/demo",
    viewId: "authorize",
  });
  session.close({ dismissed: true });
  assert.deepEqual(await session.result, { dismissed: true });
  session.close({ connected: true });
  assert.deepEqual(await session.result, { dismissed: true });
});
