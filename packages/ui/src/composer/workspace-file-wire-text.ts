import { formatChipWireBlock, scanChipWireBlocks } from "./chip-wire-block.js";

export type ParsedWorkspaceFileWireBlock = {
  index: number;
  length: number;
  path: string;
};

/** Wire-format workspace file chip (inline, explicit composer insertion only). */
export function workspaceFileContextText(path: string): string {
  const normalized = path.replace(/\\/gu, "/");
  return formatChipWireBlock(`file:${normalized}`);
}

/** Scan wire text for explicit workspace file chip blocks. */
export function scanWorkspaceFileWireBlocks(content: string): ParsedWorkspaceFileWireBlock[] {
  return scanChipWireBlocks(content)
    .filter((block) => block.infoLine.startsWith("file:") && block.body.length === 0)
    .map((block) => ({
      index: block.index,
      length: block.length,
      path: block.infoLine.slice("file:".length).replace(/\\/gu, "/"),
    }))
    .filter((block) => block.path.length > 0);
}
