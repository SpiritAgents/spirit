import assert from "node:assert/strict";
import path from "node:path";
import { test } from "vitest";

import { resolveEnabledExtensionViewFile } from "../../src/host/extensions.ts";

function managerWith(item) {
  return { list: async () => [item] };
}

const enabled = {
  id: "built-in/demo",
  enabled: true,
  directoryPath: "/tmp/ext",
  manifest: {
    contributes: {
      desktop: {
        views: [{ id: "main", path: "ui/view.mjs" }],
      },
    },
  },
};

test("resolveEnabledExtensionViewFile serves only a declared view of an enabled extension", async () => {
  const resolved = await resolveEnabledExtensionViewFile(
    managerWith(enabled),
    "built-in/demo",
    "main",
  );
  assert.deepEqual(resolved, {
    filePath: path.join("/tmp/ext", "ui", "view.mjs"),
    extensionRoot: "/tmp/ext",
  });
});

test("resolveEnabledExtensionViewFile ignores disabled extensions and unknown views", async () => {
  assert.equal(
    await resolveEnabledExtensionViewFile(
      managerWith({ ...enabled, enabled: false }),
      "built-in/demo",
      "main",
    ),
    null,
  );
  assert.equal(
    await resolveEnabledExtensionViewFile(managerWith(enabled), "built-in/demo", "other"),
    null,
  );
});
