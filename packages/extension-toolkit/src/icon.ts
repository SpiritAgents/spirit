/**
 * Registry icon rules: SVG only (no binary images in git registries), stored
 * under the registry root, rendered via <img> so scripts never execute.
 * CI rejects `<script>` content as defense in depth.
 */

import { assertRegistryRelativePath } from "./paths.js";

export function assertMarketplaceIconPath(value: unknown, fieldName: string): string {
  const normalized = assertRegistryRelativePath(value, fieldName);
  if (!normalized.toLowerCase().endsWith(".svg")) {
    throw new Error(`${fieldName} must point at an SVG file: ${normalized}`);
  }
  return normalized;
}

export function assertMarketplaceIconSvgContent(content: string, fieldName: string): void {
  if (/<script[\s>]/iu.test(content)) {
    throw new Error(`${fieldName} must not contain <script> elements.`);
  }
}
