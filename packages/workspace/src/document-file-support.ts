import path from "node:path";

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

export function hasSupportedDocumentExtension(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".pdf";
}

export function detectSupportedDocumentFile(filePath: string, bytes: Uint8Array): boolean {
  return (
    hasSupportedDocumentExtension(filePath) &&
    PDF_SIGNATURE.every((value, index) => bytes[index] === value)
  );
}
