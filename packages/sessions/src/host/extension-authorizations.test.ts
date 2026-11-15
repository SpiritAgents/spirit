import assert from "node:assert/strict";
import { test } from "vitest";

import type { HostExtensionManager, HostInstalledExtension } from "@spiritagent/extensions";
import { buildDesktopExtensionListItems } from "./extensions.js";

test("desktop authorization projection exposes configuration without secret declarations", async () => {
  const extension: HostInstalledExtension = {
    id: "personal/demo",
    sourceId: "personal",
    relativePath: "personal/demo",
    directoryPath: "/tmp/demo",
    manifestPath: "/tmp/demo/.spirit/extension.json",
    installedAtUnixMs: 0,
    enabled: true,
    installSource: "archive",
    manifest: {
      schemaVersion: 1,
      id: "personal/demo",
      sourceId: "personal",
      name: "demo",
      displayName: "Demo",
      version: "1.0.0",
      supportedHosts: ["desktop"],
      secretSlots: ["oauthAccessToken"],
      contributes: {
        authorizations: [{ id: "oauth", action: "authorize", secretSlots: ["oauthAccessToken"] }],
      },
    },
  };
  const manager = {
    async getAuthorizationConfigurations(id: string) {
      assert.equal(id, extension.id);
      return { oauth: true };
    },
  } as unknown as HostExtensionManager;

  const [item] = await buildDesktopExtensionListItems(manager, [extension]);
  assert.deepEqual(item?.authorizations, [{ id: "oauth", action: "authorize", configured: true }]);
  assert.equal(JSON.stringify(item).includes("oauthAccessToken"), false);
});
