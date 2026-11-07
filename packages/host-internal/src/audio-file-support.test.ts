import assert from "node:assert/strict";

import { test } from "vitest";

import { detectSupportedAudioFile, hasSupportedAudioExtension } from "./audio-file-support.js";

test("audio detection validates supported signatures", () => {
  assert.equal(hasSupportedAudioExtension("VOICE.MP3"), true);
  assert.equal(detectSupportedAudioFile("voice.mp3", new TextEncoder().encode("ID3\u0004")), true);
  assert.equal(
    detectSupportedAudioFile(
      "voice.wav",
      new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WAVE"),
    ),
    true,
  );
  assert.equal(detectSupportedAudioFile("voice.ogg", new TextEncoder().encode("OggS")), true);
  assert.equal(detectSupportedAudioFile("voice.flac", new TextEncoder().encode("fLaC")), true);
  assert.equal(
    detectSupportedAudioFile("voice.m4a", new Uint8Array([0, 0, 0, 0, 102, 116, 121, 112])),
    true,
  );
  assert.equal(detectSupportedAudioFile("voice.mp3", new TextEncoder().encode("not audio")), false);
  assert.equal(detectSupportedAudioFile("voice.wav", new TextEncoder().encode("ID3")), false);
});
