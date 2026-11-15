import assert from "node:assert/strict";
import { test } from "vitest";

import {
  assertHostExtensionJsonValue,
  HOST_EXTENSION_TAB_IMAGE_MAX_BYTES,
  parseHostExtensionTabRuntimeIcon,
} from "./extension-tab-values.js";

test("runtime icons accept Spirit names and bounded image data", () => {
  assert.deepEqual(parseHostExtensionTabRuntimeIcon({ type: "spirit", name: "globe" }), {
    type: "spirit",
    name: "globe",
  });
  assert.throws(
    () => parseHostExtensionTabRuntimeIcon({ type: "spirit", name: "FileText" }),
    /Unknown Spirit Icon/,
  );
  assert.throws(
    () => parseHostExtensionTabRuntimeIcon({ type: "file", path: "../icon.svg" }),
    /escapes/,
  );
  assert.throws(
    () =>
      parseHostExtensionTabRuntimeIcon({ type: "image", dataUrl: "data:image/gif;base64,AA==" }),
    /PNG, JPEG, WebP, or SVG/,
  );
  assert.throws(
    () =>
      parseHostExtensionTabRuntimeIcon({
        type: "image",
        dataUrl: `data:image/png;base64,${Buffer.alloc(HOST_EXTENSION_TAB_IMAGE_MAX_BYTES + 1).toString("base64")}`,
      }),
    /between 1 and/,
  );
});

test("initial params accept JSON values and reject cyclic or non-plain values", () => {
  const shared = { value: 1 };
  assert.doesNotThrow(() =>
    assertHostExtensionJsonValue(
      { text: "hello", items: [1, true, null], first: shared, second: shared },
      "params",
    ),
  );
  assert.throws(() => assertHostExtensionJsonValue(new Date(), "params"), /plain JSON objects/);
  assert.throws(
    () => assertHostExtensionJsonValue({ value: Number.NaN }, "params"),
    /finite number/,
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => assertHostExtensionJsonValue(cyclic, "params"), /circular/);
});
