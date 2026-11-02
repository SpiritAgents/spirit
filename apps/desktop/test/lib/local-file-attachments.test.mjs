import assert from "node:assert/strict";
import { test } from "vitest";

import {
  LOCAL_FILE_PREVIEW_CACHE_MAX_ENTRIES,
  canPreviewComposerLocalFileAttachment,
  isPreviewableImagePath,
  readCachedLocalFilePreviewDataUrl,
  rememberLocalFilePreviewDataUrl,
} from "@spiritagent/ui/composer";

test("isPreviewableImagePath accepts common image extensions", () => {
  assert.equal(isPreviewableImagePath("/tmp/element-1739.png"), true);
  assert.equal(isPreviewableImagePath("paste-1739.jpeg"), true);
  assert.equal(isPreviewableImagePath("notes.txt"), false);
});

test("canPreviewComposerLocalFileAttachment requires image flag, extension, and preview data", () => {
  assert.equal(
    canPreviewComposerLocalFileAttachment({
      id: "a",
      path: "/tmp/element-1.png",
      name: "element-1.png",
      isImage: true,
      previewDataUrl: "data:image/png;base64,abc",
    }),
    true,
  );
  assert.equal(
    canPreviewComposerLocalFileAttachment({
      id: "b",
      path: "/tmp/element-1.png",
      name: "element-1.png",
      isImage: true,
      previewDataUrl: null,
    }),
    false,
  );
  assert.equal(
    canPreviewComposerLocalFileAttachment({
      id: "c",
      path: "/tmp/readme.md",
      name: "readme.md",
      isImage: false,
      previewDataUrl: "data:text/plain;base64,abc",
    }),
    false,
  );
});

test("preview data url cache evicts least recently used entry beyond the cap", () => {
  const cap = LOCAL_FILE_PREVIEW_CACHE_MAX_ENTRIES;
  for (let index = 0; index < cap; index += 1) {
    rememberLocalFilePreviewDataUrl(`/tmp/lru-${index}.png`, `data:image/png;base64,${index}`);
  }
  assert.equal(readCachedLocalFilePreviewDataUrl("/tmp/lru-0.png"), "data:image/png;base64,0");

  // After reading lru-0 it becomes most recently used; inserting one more should evict lru-1, not lru-0
  rememberLocalFilePreviewDataUrl("/tmp/lru-extra.png", "data:image/png;base64,extra");
  assert.equal(readCachedLocalFilePreviewDataUrl("/tmp/lru-0.png"), "data:image/png;base64,0");
  assert.equal(readCachedLocalFilePreviewDataUrl("/tmp/lru-1.png"), undefined);
  assert.equal(
    readCachedLocalFilePreviewDataUrl("/tmp/lru-extra.png"),
    "data:image/png;base64,extra",
  );
});

test("remembering an existing path refreshes recency instead of duplicating", () => {
  const cap = LOCAL_FILE_PREVIEW_CACHE_MAX_ENTRIES;
  for (let index = 0; index < cap; index += 1) {
    rememberLocalFilePreviewDataUrl(`/tmp/refresh-${index}.png`, `data:image/png;base64,${index}`);
  }
  rememberLocalFilePreviewDataUrl("/tmp/refresh-0.png", "data:image/png;base64,updated");
  rememberLocalFilePreviewDataUrl("/tmp/refresh-extra.png", "data:image/png;base64,extra");

  assert.equal(
    readCachedLocalFilePreviewDataUrl("/tmp/refresh-0.png"),
    "data:image/png;base64,updated",
  );
  assert.equal(readCachedLocalFilePreviewDataUrl("/tmp/refresh-1.png"), undefined);
});
