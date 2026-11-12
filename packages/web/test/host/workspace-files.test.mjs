import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isBinaryTextFileBuffer,
  workspaceTextFileResultFromBuffer,
} from "../../../../packages/sessions/dist/host/workspace-files.js";

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff]);

const GIF_HEADER = Buffer.from("GIF89a", "ascii");

const WEBP_HEADER = Buffer.from([
  ...Buffer.from("RIFF", "ascii"),
  0x00,
  0x00,
  0x00,
  0x00,
  ...Buffer.from("WEBP", "ascii"),
]);

test("workspaceTextFileResultFromBuffer returns image for validated gif and webp", () => {
  const gif = workspaceTextFileResultFromBuffer(GIF_HEADER, "anim.gif");
  assert.equal(gif.image?.mimeType, "image/gif");
  assert.equal(gif.binary, undefined);

  const webp = workspaceTextFileResultFromBuffer(WEBP_HEADER, "photo.webp");
  assert.equal(webp.image?.mimeType, "image/webp");
  assert.equal(webp.binary, undefined);
});

test("workspaceTextFileResultFromBuffer returns binary when image extension mismatches signature", () => {
  const result = workspaceTextFileResultFromBuffer(Buffer.from("not a png", "utf8"), "icon.png");
  assert.equal(result.binary, true);
  assert.equal(result.image, undefined);
  assert.equal(result.text, "");
});

test("workspaceTextFileResultFromBuffer does not treat svg as image", () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8");
  const result = workspaceTextFileResultFromBuffer(svg, "vector.svg");
  assert.equal(result.image, undefined);
  assert.equal(result.binary, undefined);
  assert.equal(result.text.includes("<svg"), true);
});

const ICO_HEADER = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);

test("workspaceTextFileResultFromBuffer returns image for validated ico", () => {
  const result = workspaceTextFileResultFromBuffer(ICO_HEADER, "favicon.ico");
  assert.equal(result.image?.mimeType, "image/x-icon");
  assert.equal(result.binary, undefined);
  assert.equal(result.text, "");
});

test("workspaceTextFileResultFromBuffer returns image for validated png", () => {
  const result = workspaceTextFileResultFromBuffer(PNG_HEADER, "icon.png");
  assert.equal(result.image?.mimeType, "image/png");
  assert.equal(result.binary, undefined);
  assert.equal(result.text, "");
});

test("isBinaryTextFileBuffer tolerates multi-byte UTF-8 cut at the 8192-byte scan boundary", () => {
  // The first 8191 bytes are ASCII; byte 8192 starts "中" (3 bytes): the scan window cuts it in half
  const text = `${"a".repeat(8191)}${"中文文本".repeat(64)}`;
  const buffer = Buffer.from(text, "utf8");
  assert.ok(buffer.length > 8192);
  assert.equal(buffer.subarray(0, 8192).toString("utf8").includes("\uFFFD"), true);

  assert.equal(isBinaryTextFileBuffer(buffer), false);
  const result = workspaceTextFileResultFromBuffer(buffer, "notes.txt");
  assert.equal(result.binary, undefined);
  assert.equal(result.text, text);
});

test("isBinaryTextFileBuffer still flags invalid UTF-8 and truncated whole files", () => {
  // Invalid bytes in the middle of the file are still treated as binary
  assert.equal(isBinaryTextFileBuffer(Buffer.from([0x61, 0xff, 0xfe, 0x62])), true);
  // The whole file is truncated in the middle of a multi-byte sequence (below the scan window): decoding must fail completely, treated as binary
  const truncated = Buffer.from("中", "utf8").subarray(0, 2);
  assert.equal(isBinaryTextFileBuffer(truncated), true);
});
