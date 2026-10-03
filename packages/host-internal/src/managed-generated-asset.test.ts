import assert from "node:assert/strict";
import { test } from "vitest";
import { product } from "@spiritagent/product";
import {
  buildManagedGeneratedAssetRef,
  normalizeManagedGeneratedAssetRef,
  parseManagedGeneratedAssetReference,
} from "./managed-generated-asset.js";

test("managed image and video references use only this build's protocol", () => {
  for (const kind of ["image", "video"] as const) {
    const reference = buildManagedGeneratedAssetRef(kind, "example media.bin");
    assert.equal(reference, `${product.urlProtocol}://generated/${kind}/example%20media.bin`);
    assert.deepEqual(parseManagedGeneratedAssetReference(reference), {
      kind,
      basename: "example media.bin",
      reference,
    });
    assert.equal(normalizeManagedGeneratedAssetRef(reference, kind), reference);
    assert.equal(
      parseManagedGeneratedAssetReference(`${product.urlProtocol}-other://generated/${kind}/file`),
      undefined,
    );
  }
  assert.throws(
    () => parseManagedGeneratedAssetReference(`${product.urlProtocol}://generated/image/%2Ffile`),
    /Invalid .* managed asset reference/,
  );
});
