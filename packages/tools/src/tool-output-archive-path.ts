/**
 * Tool output archive path constants and pure path checks (no Node built-in dependencies; safe to import from the Desktop renderer).
 */

export const TOOL_OUTPUT_ARCHIVES_DIR_NAME = "tool-output-archives";

function normalizePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/");
}

export function isToolOutputArchivePath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (!normalized) {
    return false;
  }
  const segment = TOOL_OUTPUT_ARCHIVES_DIR_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|/)${segment}(?:/|$)`, "u").test(normalized);
}
