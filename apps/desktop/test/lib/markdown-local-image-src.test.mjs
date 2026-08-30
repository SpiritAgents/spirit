import assert from "node:assert/strict";
import { test } from "vitest";

import {
  classifyMarkdownImageSrc,
  dirnameLocalPath,
  isBlockedRemoteMarkdownMediaSrc,
  resolveMarkdownLocalImageFilePath,
} from "../../src/lib/markdown-local-image-src.ts";

test("isBlockedRemoteMarkdownMediaSrc detects clear-text http and protocol-relative urls", () => {
  assert.equal(isBlockedRemoteMarkdownMediaSrc("https://example.com/a.png"), false);
  assert.equal(isBlockedRemoteMarkdownMediaSrc("http://example.com/a.png"), true);
  assert.equal(isBlockedRemoteMarkdownMediaSrc("//cdn.example.com/a.png"), true);
  assert.equal(isBlockedRemoteMarkdownMediaSrc("./docs/a.png"), false);
  assert.equal(isBlockedRemoteMarkdownMediaSrc("spirit://generated/image/a.png"), false);
});

test("classifyMarkdownImageSrc classifies managed remote local and invalid", () => {
  assert.equal(classifyMarkdownImageSrc("spirit://generated/image/abc.png"), "managed");
  assert.equal(classifyMarkdownImageSrc("spirit://generated/video/abc.mp4"), "managed");
  assert.equal(classifyMarkdownImageSrc("https://example.com/a.png"), "remote");
  assert.equal(classifyMarkdownImageSrc("http://example.com/a.png"), "invalid");
  assert.equal(classifyMarkdownImageSrc("//cdn.example.com/a.png"), "invalid");
  assert.equal(classifyMarkdownImageSrc("./docs/a.png"), "local");
  assert.equal(classifyMarkdownImageSrc("/Users/demo/a.png"), "local");
  assert.equal(classifyMarkdownImageSrc("C:\\Users\\demo\\a.png"), "local");
  assert.equal(classifyMarkdownImageSrc("file:///tmp/a.png"), "invalid");
  assert.equal(classifyMarkdownImageSrc("data:image/png;base64,xx"), "invalid");
  assert.equal(classifyMarkdownImageSrc(""), "invalid");
});

test("resolveMarkdownLocalImageFilePath joins relative paths and folds parent segments", () => {
  assert.equal(
    resolveMarkdownLocalImageFilePath("./docs/a.png", "/Users/demo/project"),
    "/Users/demo/project/docs/a.png",
  );
  assert.equal(
    resolveMarkdownLocalImageFilePath("../assets/a.png", "/Users/demo/project/docs"),
    "/Users/demo/project/assets/a.png",
  );
  assert.equal(
    resolveMarkdownLocalImageFilePath("/Users/demo/abs.png", "/Users/demo/project"),
    "/Users/demo/abs.png",
  );
  assert.equal(
    resolveMarkdownLocalImageFilePath("C:\\Users\\demo\\abs.png", "C:\\workspace"),
    "C:\\Users\\demo\\abs.png",
  );
});

test("resolveMarkdownLocalImageFilePath rejects remote and requires base for relative", () => {
  assert.equal(resolveMarkdownLocalImageFilePath("https://example.com/a.png", "/tmp"), null);
  assert.equal(resolveMarkdownLocalImageFilePath("//cdn.example.com/a.png", "/tmp"), null);
  assert.equal(resolveMarkdownLocalImageFilePath("spirit://generated/image/a.png", "/tmp"), null);
  assert.equal(resolveMarkdownLocalImageFilePath("./docs/a.png"), null);
  assert.equal(resolveMarkdownLocalImageFilePath("./docs/a.png", "  "), null);
});

test("resolveMarkdownLocalImageFilePath enforces allowedRootDir containment", () => {
  const root = "/Users/demo/project";
  assert.equal(
    resolveMarkdownLocalImageFilePath("../assets/a.png", `${root}/docs`, root),
    `${root}/assets/a.png`,
  );
  assert.equal(
    resolveMarkdownLocalImageFilePath("../../outside/a.png", `${root}/docs`, root),
    null,
  );
  assert.equal(
    resolveMarkdownLocalImageFilePath("/Users/demo/outside/secret.png", root, root),
    null,
  );
  assert.equal(
    resolveMarkdownLocalImageFilePath(`${root}/docs/a.png`, root, root),
    `${root}/docs/a.png`,
  );
});

test("dirnameLocalPath returns parent directory", () => {
  assert.equal(dirnameLocalPath("/Users/demo/project/README.md"), "/Users/demo/project");
  assert.equal(dirnameLocalPath("C:\\Users\\demo\\README.md"), "C:\\Users\\demo");
  assert.equal(dirnameLocalPath("/README.md"), "/");
});
