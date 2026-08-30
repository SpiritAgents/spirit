import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isManagedGeneratedImageRef,
  isManagedGeneratedVideoRef,
} from "../../src/lib/managed-generated-asset.ts";
import { streamdownUrlTransform } from "../../src/lib/markdown-url-transform.ts";

test("isManagedGeneratedImageRef detects spirit image protocol", () => {
  assert.equal(isManagedGeneratedImageRef("spirit://generated/image/abc.png"), true);
  assert.equal(isManagedGeneratedImageRef("spirit://generated/video/abc.mp4"), false);
  assert.equal(isManagedGeneratedImageRef("https://example.com/a.png"), false);
});

test("isManagedGeneratedVideoRef detects spirit video protocol", () => {
  assert.equal(isManagedGeneratedVideoRef("spirit://generated/video/abc.mp4"), true);
  assert.equal(isManagedGeneratedVideoRef("spirit://generated/image/abc.png"), false);
});

test("streamdownUrlTransform keeps https media src and blanks http", () => {
  assert.equal(
    streamdownUrlTransform("https://example.com/a.png", "src", {}),
    "https://example.com/a.png",
  );
  assert.equal(streamdownUrlTransform("http://example.com/a.png", "src", {}), "");
  assert.equal(streamdownUrlTransform("//cdn.example.com/a.png", "src", {}), "");
  assert.equal(streamdownUrlTransform("./docs/a.png", "src", {}), "./docs/a.png");
});
