import { formatChipWireBlock, scanChipWireBlocks } from "./chip-wire-block.js";

export type ParsedSkillWireBlock = {
  index: number;
  length: number;
  alias: string;
};

function parseSkillWireAlias(alias: string): string | null {
  const parsedAlias = alias.trim();
  if (!parsedAlias.startsWith("/")) {
    return null;
  }
  return parsedAlias;
}

/** Wire-format skill chip (inline, explicit composer insertion only). */
export function skillContextText(alias: string): string {
  const normalized = alias.trim();
  return formatChipWireBlock(`skill:${normalized}`);
}

/** Scan wire text for explicit skill chip blocks. */
export function scanSkillWireBlocks(content: string): ParsedSkillWireBlock[] {
  return scanChipWireBlocks(content)
    .filter((block) => block.infoLine.startsWith("skill:"))
    .map((block) => {
      const alias = block.infoLine.slice("skill:".length).trim();
      return {
        index: block.index,
        length: block.length,
        alias,
      };
    })
    .filter((block) => parseSkillWireAlias(block.alias) !== null);
}
