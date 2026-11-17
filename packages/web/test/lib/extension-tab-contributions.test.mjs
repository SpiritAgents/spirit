import assert from "node:assert/strict";
import { test } from "vitest";

import {
  collectExtensionTabContributions,
  extensionTabDisplayName,
  resolveExtensionTabScope,
} from "../../src/lib/extension-tab-contributions.ts";

const tab = (id, name = id) => ({
  id,
  name,
  path: `${id}.html`,
  icon: { type: "spirit", name: "globe" },
  defaultScope: "window-shared",
});

test("contribution titles use the host-localized declaration", () => {
  assert.equal(extensionTabDisplayName(tab("notes", "ノート")), "ノート");
  assert.equal(extensionTabDisplayName(tab("activity", "Activity")), "Activity");
});

test("collects only enabled Desktop tab contributions in display order", () => {
  const result = collectExtensionTabContributions([
    {
      id: "personal/zed",
      displayName: "Zed",
      version: "1",
      enabled: true,
      supportedHosts: ["desktop"],
      desktopTabs: [tab("zeta"), tab("alpha")],
    },
    {
      id: "personal/disabled",
      displayName: "AAA",
      version: "1",
      enabled: false,
      supportedHosts: ["desktop"],
      desktopTabs: [tab("hidden")],
    },
    {
      id: "personal/cli",
      displayName: "CLI",
      version: "1",
      enabled: true,
      supportedHosts: ["cli"],
      desktopTabs: [tab("hidden")],
    },
  ]);
  assert.deepEqual(
    result.map((entry) => entry.contribution.id),
    ["alpha", "zeta"],
  );
});

test("resolves all default ownership scopes", () => {
  assert.deepEqual(
    resolveExtensionTabScope({
      defaultScope: "window-shared",
      workspaceRoot: "/repo",
      sessionKey: "one",
    }),
    { kind: "window-shared" },
  );
  assert.deepEqual(
    resolveExtensionTabScope({
      defaultScope: "workspace",
      workspaceRoot: "/repo",
      sessionKey: "one",
    }),
    { kind: "workspace", workspaceRoot: "/repo" },
  );
  assert.deepEqual(
    resolveExtensionTabScope({
      defaultScope: "session",
      workspaceRoot: "/repo",
      sessionKey: "one",
    }),
    { kind: "session", sessionKey: "one" },
  );
  assert.throws(
    () =>
      resolveExtensionTabScope({ defaultScope: "session", workspaceRoot: "/repo", sessionKey: "" }),
    /active session/,
  );
});
