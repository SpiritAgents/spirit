export const MAX_INLINE_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_INPUTS = 50;
export const MAX_PDF_PAGES_PER_DOCUMENT = 50;

const IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/x-icon",
]);

const AUDIO_MEDIA_TYPES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/ogg",
  "audio/flac",
]);

export interface DecodedDataUrl {
  mediaType: string;
  bytes: Uint8Array;
}

export function decodeDataUrl(value: string): DecodedDataUrl | undefined {
  const match = /^data:([^;]+);base64,(.+)$/is.exec(value.trim());
  const mediaType = match?.[1]?.trim().toLowerCase();
  const data = match?.[2]?.trim();
  if (!mediaType || !data) {
    return undefined;
  }
  try {
    return { mediaType, bytes: Buffer.from(data, "base64") };
  } catch {
    return undefined;
  }
}

export function validateImageDataUrl(value: string): DecodedDataUrl {
  const decoded = decodeDataUrl(value);
  if (!decoded || !IMAGE_MEDIA_TYPES.has(decoded.mediaType)) {
    throw new Error("Image input must be a JPEG, PNG, GIF, WebP, or X-Icon data URL.");
  }
  if (decoded.bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
    throw new Error("Inline image input exceeds the 50 MB limit.");
  }
  return decoded;
}

export function validateAudioBytes(mediaType: string, bytes: Uint8Array): void {
  if (!AUDIO_MEDIA_TYPES.has(mediaType.toLowerCase())) {
    throw new Error(`Unsupported audio input media type ${JSON.stringify(mediaType)}.`);
  }
  const validSignature =
    mediaType === "audio/mpeg"
      ? hasAscii(bytes, "ID3") || (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0)
      : mediaType === "audio/wav" || mediaType === "audio/x-wav"
        ? hasAscii(bytes, "RIFF") && hasAscii(bytes, "WAVE", 8)
        : mediaType === "audio/mp4"
          ? hasAscii(bytes, "ftyp", 4)
          : mediaType === "audio/ogg"
            ? hasAscii(bytes, "OggS")
            : hasAscii(bytes, "fLaC");
  if (!validSignature) {
    throw new Error("Audio input bytes do not match the declared media type.");
  }
}

export function validateMp4Bytes(bytes: Uint8Array): void {
  if (!hasAscii(bytes, "ftyp", 4)) {
    throw new Error("Video input must be a valid MP4 file.");
  }
}

export function pdfPageCount(bytes: Uint8Array): number {
  if (!hasAscii(bytes, "%PDF-")) {
    throw new Error("Document input must be a valid PDF file.");
  }
  const source = Buffer.from(bytes).toString("latin1");
  const pageObjects = source.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  let treeCount = 0;
  for (const match of source.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,200}?\/Count\s+(\d+)/g)) {
    treeCount = Math.max(treeCount, Number(match[1]));
  }
  const pages = Math.max(pageObjects, treeCount);
  if (!Number.isSafeInteger(pages) || pages < 1) {
    throw new Error("PDF input must contain at least one readable page.");
  }
  return pages;
}

function hasAscii(bytes: Uint8Array, value: string, offset = 0): boolean {
  return Array.from(value).every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}
