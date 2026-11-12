import path from "node:path";

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".flac"]);

export function hasSupportedAudioExtension(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function detectSupportedAudioFile(filePath: string, bytes: Uint8Array): boolean {
  if (!hasSupportedAudioExtension(filePath)) {
    return false;
  }
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".mp3":
      return hasAsciiPrefix(bytes, "ID3") || (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0);
    case ".wav":
      return hasAsciiPrefix(bytes, "RIFF") && hasAsciiPrefix(bytes, "WAVE", 8);
    case ".m4a":
      return hasAsciiPrefix(bytes, "ftyp", 4);
    case ".ogg":
      return hasAsciiPrefix(bytes, "OggS");
    case ".flac":
      return hasAsciiPrefix(bytes, "fLaC");
    default:
      return false;
  }
}

function hasAsciiPrefix(bytes: Uint8Array, prefix: string, offset = 0): boolean {
  return Array.from(prefix).every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}
