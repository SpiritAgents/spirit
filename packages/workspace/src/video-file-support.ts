import path from "node:path";

type SupportedVideoExtension =
  | ".3gp"
  | ".3gpp"
  | ".avi"
  | ".flv"
  | ".mov"
  | ".mp4"
  | ".mpeg"
  | ".mpg"
  | ".webm"
  | ".wmv";

export interface SupportedVideoFile {
  extension: SupportedVideoExtension;
  mimeType: string;
}

const SUPPORTED_VIDEO_MIME_TYPES: Record<SupportedVideoExtension, string> = {
  ".3gp": "video/3gpp",
  ".3gpp": "video/3gpp",
  ".avi": "video/x-msvideo",
  ".flv": "video/x-flv",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".webm": "video/webm",
  ".wmv": "video/x-ms-wmv",
};

export function hasSupportedVideoExtension(filePath: string): boolean {
  return supportedVideoExtension(filePath) !== undefined;
}

export function detectSupportedVideoFile(
  filePath: string,
  bytes: Uint8Array,
): SupportedVideoFile | undefined {
  const extension = supportedVideoExtension(filePath);
  if (!extension) {
    return undefined;
  }

  if (!matchesVideoSignature(extension, bytes)) {
    return undefined;
  }

  return {
    extension,
    mimeType: SUPPORTED_VIDEO_MIME_TYPES[extension],
  };
}

function supportedVideoExtension(filePath: string): SupportedVideoExtension | undefined {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".3gp":
    case ".3gpp":
    case ".avi":
    case ".flv":
    case ".mov":
    case ".mp4":
    case ".mpeg":
    case ".mpg":
    case ".webm":
    case ".wmv":
      return extension;
    default:
      return undefined;
  }
}

function matchesVideoSignature(extension: SupportedVideoExtension, bytes: Uint8Array): boolean {
  if (bytes.length < 4) {
    return false;
  }

  switch (extension) {
    case ".mp4":
    case ".mov":
    case ".3gp":
    case ".3gpp":
      return hasAsciiPrefix(bytes, "ftyp", 4);
    case ".webm":
      return hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    case ".avi":
      return hasAsciiPrefix(bytes, "RIFF") && hasAsciiPrefix(bytes.slice(8), "AVI ");
    case ".wmv":
      return hasPrefix(bytes, [0x30, 0x26, 0xb2, 0x75]);
    case ".mpeg":
    case ".mpg":
      return (
        hasPrefix(bytes, [0x00, 0x00, 0x01, 0xba]) || hasPrefix(bytes, [0x00, 0x00, 0x01, 0xb3])
      );
    case ".flv":
      return hasAsciiPrefix(bytes, "FLV");
    default:
      return true;
  }
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }

  return prefix.every((value, index) => bytes[index] === value);
}

function hasAsciiPrefix(bytes: Uint8Array, prefix: string, offset = 0): boolean {
  const expected = Array.from(prefix, (char) => char.charCodeAt(0));
  if (bytes.length < offset + expected.length) {
    return false;
  }

  return expected.every((value, index) => bytes[offset + index] === value);
}
