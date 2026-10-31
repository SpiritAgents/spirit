/**
 * Snippet-level before/after pair reconstructed from a headerless V4A patch (apply_patch).
 * The completed tool card uses this for its diff view: after execution the on-disk file is
 * already patched, so the pair comes from the patch's own context/insert/delete lines rather
 * than a file read. Line numbers in the rendered gutter are snippet-relative; the V4A anchors
 * carry no absolute positions.
 */
export type ApplyPatchSnippetOperation = {
  type: string;
  diff?: string;
};

export function applyPatchSnippetPair(
  operation: ApplyPatchSnippetOperation,
): { original: string; modified: string } | undefined {
  const diff = operation.diff;
  if (diff === undefined || diff.trim().length === 0) {
    return undefined;
  }

  const original: string[] = [];
  const modified: string[] = [];
  for (const rawLine of diff.split(/\r?\n/)) {
    // V4A quirk (same as the executor's apply-diff): a bare empty line is an empty context line.
    const line = rawLine === "" ? " " : rawLine;
    const marker = line[0];
    const content = line.slice(1);
    if (marker === "+") {
      modified.push(content);
    } else if (marker === "-") {
      original.push(content);
    } else if (marker === " ") {
      original.push(content);
      modified.push(content);
    }
    // "@@" anchors and "***" markers carry no file content.
  }

  if (original.length === 0 && modified.length === 0) {
    return undefined;
  }
  return { original: original.join("\n"), modified: modified.join("\n") };
}
