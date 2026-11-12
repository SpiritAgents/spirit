type SupportedImageExtension = ".bmp" | ".gif" | ".ico" | ".jpeg" | ".jpg" | ".png" | ".webp";

export interface SupportedImageFile {
  extension: SupportedImageExtension;
  mimeType: string;
}

const SUPPORTED_IMAGE_MIME_TYPES: Record<SupportedImageExtension, string> = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function fileExtensionFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  if (dot < 0) {
    return "";
  }
  return basename.slice(dot).toLowerCase();
}

export function hasSupportedImageExtension(filePath: string): boolean {
  return supportedImageExtension(filePath) !== undefined;
}

type PreviewableImageExtension = SupportedImageExtension | ".svg";

export interface PreviewableImageFile {
  extension: PreviewableImageExtension;
  mimeType: string;
}

const SVG_PREVIEW_MIME_TYPE = "image/svg+xml";
const SVG_SNIFF_BYTES = 8192;
// SVG has no magic bytes; sniff the text prolog (BOM, <?xml?>, comments, DOCTYPE) for a root <svg> tag.
const SVG_TEXT_PATTERN =
  /^\uFEFF?\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:(?:<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\][^>[]*)?>)\s*)*<svg[\s>]/iu;

/**
 * Image detection for host-side preview surfaces (e.g. Desktop Markdown / file preview), where the
 * bytes stay local as a data URL. Unlike detectSupportedImageFile this also accepts SVG, which must
 * not be sent to model transports but renders fine in an <img> element.
 */
export function detectPreviewableImageFile(
  filePath: string,
  bytes: Uint8Array,
): PreviewableImageFile | undefined {
  if (fileExtensionFromPath(filePath) !== ".svg") {
    return detectSupportedImageFile(filePath, bytes);
  }
  const text = new TextDecoder().decode(bytes.subarray(0, SVG_SNIFF_BYTES));
  if (!SVG_TEXT_PATTERN.test(text)) {
    return undefined;
  }
  return { extension: ".svg", mimeType: SVG_PREVIEW_MIME_TYPE };
}

export function detectSupportedImageFile(
  filePath: string,
  bytes: Uint8Array,
): SupportedImageFile | undefined {
  const extension = supportedImageExtension(filePath);
  if (!extension) {
    return undefined;
  }

  if (!matchesImageSignature(extension, bytes)) {
    return undefined;
  }

  return {
    extension,
    mimeType: SUPPORTED_IMAGE_MIME_TYPES[extension],
  };
}

function supportedImageExtension(filePath: string): SupportedImageExtension | undefined {
  const extension = fileExtensionFromPath(filePath);
  switch (extension) {
    case ".bmp":
    case ".gif":
    case ".ico":
    case ".jpeg":
    case ".jpg":
    case ".png":
    case ".webp":
      return extension;
    default:
      return undefined;
  }
}

function matchesImageSignature(extension: SupportedImageExtension, bytes: Uint8Array): boolean {
  switch (extension) {
    case ".bmp":
      return hasAsciiPrefix(bytes, "BM");
    case ".png":
      return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".jpg":
    case ".jpeg":
      return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
    case ".gif":
      return hasAsciiPrefix(bytes, "GIF87a") || hasAsciiPrefix(bytes, "GIF89a");
    case ".ico":
      return hasPrefix(bytes, [0x00, 0x00, 0x01, 0x00]);
    case ".webp":
      return hasAsciiPrefix(bytes, "RIFF") && hasAsciiPrefix(bytes.slice(8), "WEBP");
  }
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }

  return prefix.every((value, index) => bytes[index] === value);
}

function hasAsciiPrefix(bytes: Uint8Array, prefix: string): boolean {
  const expected = Array.from(prefix, (char) => char.charCodeAt(0));
  return hasPrefix(bytes, expected);
}
