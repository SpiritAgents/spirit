import assert from "node:assert/strict";
import { test } from "vitest";
import { tryHandleDesktopWorkspaceLink } from "../../src/lib/workspace-navigation-link.ts";

test("Desktop links enter the generic extension-aware URL dispatcher", () => {
  const opened = [];
  const handlers = { openUrl: (url) => opened.push(url) };
  assert.equal(
    tryHandleDesktopWorkspaceLink("https://example.test/events/42", handlers, {
      hostKind: "electron",
    }),
    true,
  );
  assert.deepEqual(opened, ["https://example.test/events/42"]);
  for (const href of ["#heading", "file:///private/data", "javascript:alert(1)"]) {
    assert.equal(tryHandleDesktopWorkspaceLink(href, handlers, { hostKind: "electron" }), false);
  }
  assert.equal(
    tryHandleDesktopWorkspaceLink("https://example.test", handlers, { hostKind: "web" }),
    false,
  );
});
