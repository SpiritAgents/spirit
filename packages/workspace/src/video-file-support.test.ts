import assert from "node:assert/strict";
import { test } from "vitest";

import { detectSupportedVideoFile, hasSupportedVideoExtension } from "./video-file-support.js";

const MINIMAL_MP4_HEADER = Uint8Array.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test("hasSupportedVideoExtension recognizes Moonshot-documented extensions", () => {
  assert.equal(hasSupportedVideoExtension("clip.mp4"), true);
  assert.equal(hasSupportedVideoExtension("clip.MOV"), true);
  assert.equal(hasSupportedVideoExtension("clip.webm"), true);
  assert.equal(hasSupportedVideoExtension("notes.txt"), false);
});

test("detectSupportedVideoFile validates mp4 ftyp signature", () => {
  const detected = detectSupportedVideoFile("sample.mp4", MINIMAL_MP4_HEADER);
  assert.deepEqual(detected, {
    extension: ".mp4",
    mimeType: "video/mp4",
  });
});

test("detectSupportedVideoFile rejects mismatched extension and signature", () => {
  assert.equal(detectSupportedVideoFile("sample.mp4", Uint8Array.from([0, 1, 2, 3])), undefined);
});
