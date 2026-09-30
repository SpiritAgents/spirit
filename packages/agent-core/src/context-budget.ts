// Shared budget for one-shot context injection (tool outputs, workspace file attachments).
// Bytes track tokens far more uniformly across languages than chars do
// (English ≈4 B/token, Chinese UTF-8 ≈3–4.5 B/token), so one byte threshold
// keeps both near ~8–9k tokens without a tokenizer.
export const CONTEXT_INJECTION_MAX_BYTES = 32 * 1024;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8");

export function encodeUtf8(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

export function utf8ByteLength(text: string): number {
  return encodeUtf8(text).length;
}

// Continuation bytes match 0b10xxxxxx; a cut point is valid iff the byte at the
// cut index is not a continuation byte, so slices never split a multi-byte char.
function isUtf8ContinuationByte(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

/** Longest head slice of `bytes` fitting in `maxBytes` without splitting a UTF-8 character. */
export function sliceUtf8Head(bytes: Uint8Array, maxBytes: number): Uint8Array {
  let end = Math.min(Math.max(maxBytes, 0), bytes.length);
  while (end > 0 && isUtf8ContinuationByte(bytes[end])) {
    end -= 1;
  }
  return bytes.subarray(0, end);
}

/** Longest tail slice of `bytes` fitting in `maxBytes` without splitting a UTF-8 character. */
export function sliceUtf8Tail(bytes: Uint8Array, maxBytes: number): Uint8Array {
  let start = Math.max(bytes.length - Math.max(maxBytes, 0), 0);
  while (start < bytes.length && isUtf8ContinuationByte(bytes[start])) {
    start += 1;
  }
  return bytes.subarray(start);
}
