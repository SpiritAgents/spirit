import assert from "node:assert/strict";
import { test } from "vitest";

import { uploadOnlyLocalFileAttachmentSnapshots } from "@spiritagent/ui/composer";

test("uploadOnlyLocalFileAttachmentSnapshots returns undefined for missing snapshots", () => {
  assert.equal(uploadOnlyLocalFileAttachmentSnapshots(undefined, new Set(["a/b.ts"])), undefined);
});

test("uploadOnlyLocalFileAttachmentSnapshots keeps all snapshots without referenced paths", () => {
  const snapshots = [{ path: "/abs/upload.png", name: "upload.png", isImage: true }];
  const result = uploadOnlyLocalFileAttachmentSnapshots(snapshots, new Set());
  assert.deepEqual(result, snapshots);
});

test("uploadOnlyLocalFileAttachmentSnapshots drops snapshots matching a referenced chip path", () => {
  const snapshots = [
    { path: "src/lib/foo.ts", name: "foo.ts", isImage: false },
    { path: "/abs/upload.png", name: "upload.png", isImage: true },
  ];
  const result = uploadOnlyLocalFileAttachmentSnapshots(snapshots, new Set(["src/lib/foo.ts"]));
  assert.deepEqual(result, [{ path: "/abs/upload.png", name: "upload.png", isImage: true }]);
});

test("uploadOnlyLocalFileAttachmentSnapshots normalizes backslashes before matching", () => {
  const snapshots = [{ path: "src\\lib\\foo.ts", name: "foo.ts", isImage: false }];
  const result = uploadOnlyLocalFileAttachmentSnapshots(snapshots, new Set(["src/lib/foo.ts"]));
  assert.deepEqual(result, []);
});
