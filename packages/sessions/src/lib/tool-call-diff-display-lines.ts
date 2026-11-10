import type { DiffDisplayLine } from "@/lib/diff-display-lines";

/** Tool card diff display lines: non-followTail uses lines synchronously; followTail shows in the same frame when going empty → non-empty, otherwise uses debounced. */
export function resolveToolCallDisplayLines(
  lines: DiffDisplayLine[],
  debouncedLines: DiffDisplayLine[],
  followTail: boolean,
): DiffDisplayLine[] {
  if (!followTail) {
    return lines;
  }
  if (lines.length === 0) {
    return [];
  }
  return debouncedLines.length === 0 ? lines : debouncedLines;
}
