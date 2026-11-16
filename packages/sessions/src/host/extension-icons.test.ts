import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";
import type { HostExtensionManager } from "@spiritagent/extensions";
import { resolveEnabledExtensionIconFile } from "./extensions.js";

test("only declared Tab and Automation icons from enabled extensions are served", async () => {
  const item = {
    id: "personal/demo",
    enabled: true,
    directoryPath: path.resolve("fixture"),
    manifest: {
      contributes: {
        desktop: { tabs: [{ icon: { type: "file", path: "icons/tab.svg" } }] },
        automationTriggers: [{ icon: { type: "file", path: "icons/activity.svg" } }],
      },
    },
  };
  const manager = { list: async () => [item] } as unknown as HostExtensionManager;
  for (const iconPath of ["icons/tab.svg", "icons/activity.svg"]) {
    assert.deepEqual(await resolveEnabledExtensionIconFile(manager, item.id, iconPath), {
      filePath: path.join(item.directoryPath, iconPath),
      extensionRoot: item.directoryPath,
    });
  }
  assert.equal(await resolveEnabledExtensionIconFile(manager, item.id, "private.svg"), null);
  assert.equal(
    await resolveEnabledExtensionIconFile(manager, "personal/other", "icons/tab.svg"),
    null,
  );
  item.enabled = false;
  assert.equal(await resolveEnabledExtensionIconFile(manager, item.id, "icons/activity.svg"), null);
});
