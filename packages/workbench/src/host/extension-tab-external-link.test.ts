import assert from "node:assert/strict";
import { test } from "vitest";
import { DesktopHostService } from "./service.js";

function fixture() {
  const opened: string[] = [];
  const tab = {
    kind: "extension",
    id: "tab",
    instanceId: "instance",
    extensionId: "personal/demo",
    contributionId: "notes",
  };
  const host = {
    ensureInitialized: async () => {},
    workspaceToolTabs: { getSnapshot: async () => ({ tabs: [tab] }) },
    requireExtensionTabContribution: async () => ({}),
    requireExtensionHostAdapter: () => ({
      forExtension: (extensionId: string, windowId: string) => {
        assert.equal(extensionId, tab.extensionId);
        assert.equal(windowId, "window");
        return {
          openExternal: async (url: string) => {
            opened.push(url);
          },
        };
      },
    }),
    runExtensionPageRequest: () =>
      assert.fail("Host external links must not enter the extension backend"),
    extensionManager: () =>
      assert.fail("Host external links must not activate an extension backend"),
  } as unknown as DesktopHostService;
  const request = {
    windowId: "window",
    extensionId: tab.extensionId,
    contributionId: tab.contributionId,
    instanceId: tab.instanceId,
    method: "host.openExternal",
    params: { url: "https://example.test/review" },
  };
  return { opened, host, request };
}

test("Tab external links use the Host opener rather than a vendor request handler", async () => {
  const { host, request, opened } = fixture();
  await DesktopHostService.prototype.invokeExtensionTabRequest.call(host, request);
  assert.deepEqual(opened, [request.params.url]);
});

test("Tab external links retain live identity and URL input validation", async () => {
  const { host, request, opened } = fixture();
  await assert.rejects(
    DesktopHostService.prototype.invokeExtensionTabRequest.call(host, {
      ...request,
      instanceId: "forged",
    }),
    /identity/,
  );
  await assert.rejects(
    DesktopHostService.prototype.invokeExtensionTabRequest.call(host, {
      ...request,
      params: { url: 12 },
    }),
    /URL/,
  );
  assert.deepEqual(opened, []);
});
