/**
 * Shared fence-based wire format for composer chip attachments.
 *
 * Grammar:
 *   ```<info-line>
 *   <body>
 *   ```
 *
 * Closing fence must be on its own line. When body contains standalone fence
 * lines, the opener escalates to four backticks.
 */

export type ScannedChipWireBlock = {
  index: number;
  length: number;
  infoLine: string;
  body: string;
};

const OPEN_LINE_RE = /^(`{3,})(.*)$/u;

/** Choose fence depth that safely wraps body containing nested fences. */
export function chooseEscalatedFence(body: string): { open: string; close: string } {
  if (!/^\s*```/m.test(body)) {
    return { open: "```\n", close: "\n```" };
  }
  return { open: "````\n", close: "\n````" };
}

/** Serialize a chip wire block with typed info line and optional body. */
export function formatChipWireBlock(infoLine: string, body = ""): string {
  const needsEscalation = /^\s*```/m.test(body);
  const ticks = needsEscalation ? "````" : "```";
  return `${ticks}${infoLine}\n${body}\n${ticks}`;
}

/**
 * Scan content for chip wire blocks. Info line is the remainder of the opening
 * fence line after the backticks; body ends at a standalone closing fence line.
 */
export function scanChipWireBlocks(content: string): ScannedChipWireBlock[] {
  const blocks: ScannedChipWireBlock[] = [];
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const openIndex = content.indexOf("```", searchFrom);
    if (openIndex === -1) {
      break;
    }

    const lineEnd = content.indexOf("\n", openIndex);
    if (lineEnd === -1) {
      break;
    }

    const openLine = content.slice(openIndex, lineEnd);
    const parsedOpen = OPEN_LINE_RE.exec(openLine);
    if (!parsedOpen) {
      searchFrom = openIndex + 3;
      continue;
    }

    const closeFence = parsedOpen[1] ?? "```";
    const infoLine = parsedOpen[2] ?? "";
    if (!infoLine) {
      searchFrom = openIndex + 3;
      continue;
    }

    let cursor = lineEnd + 1;
    const bodyLines: string[] = [];
    let closed = false;
    while (cursor <= content.length) {
      const nextLineEnd = content.indexOf("\n", cursor);
      const lineEndPos = nextLineEnd === -1 ? content.length : nextLineEnd;
      const line = content.slice(cursor, lineEndPos);
      if (line === closeFence) {
        const blockEnd = nextLineEnd === -1 ? content.length : nextLineEnd + 1;
        blocks.push({
          index: openIndex,
          length: blockEnd - openIndex,
          infoLine,
          body: bodyLines.join("\n"),
        });
        searchFrom = blockEnd;
        closed = true;
        break;
      }
      bodyLines.push(line);
      if (nextLineEnd === -1) {
        break;
      }
      cursor = nextLineEnd + 1;
    }

    if (!closed) {
      searchFrom = openIndex + 3;
    }
  }

  return blocks;
}

/** Format 1-based line range suffix for file/terminal info lines. */
export function formatLineRange(lineStart: number, lineEnd: number): string {
  const hasLines = lineStart > 0 && lineEnd > 0;
  if (!hasLines) {
    return "";
  }
  if (lineStart === lineEnd) {
    return `:${lineStart}`;
  }
  return `:${lineStart}-${lineEnd}`;
}

/** Parse line range suffix (e.g. ":12-15" or ":42"). */
export function parseLineRangeSuffix(suffix: string): {
  lineStart: number;
  lineEnd: number;
} | null {
  const trimmed = suffix.trim();
  if (!trimmed) {
    return { lineStart: 0, lineEnd: 0 };
  }
  if (!trimmed.startsWith(":")) {
    return null;
  }
  const rangePart = trimmed.slice(1);
  const singleMatch = /^(\d+)$/u.exec(rangePart);
  if (singleMatch) {
    const line = Number(singleMatch[1]);
    return { lineStart: line, lineEnd: line };
  }
  const rangeMatch = /^(\d+)-(\d+)$/u.exec(rangePart);
  if (rangeMatch) {
    return {
      lineStart: Number(rangeMatch[1]),
      lineEnd: Number(rangeMatch[2]),
    };
  }
  return null;
}

/**
 * Split a typed info payload into base path/name and optional line range,
 * parsing the range suffix from the right.
 */
export function splitInfoPayloadAndLineRange(payload: string): {
  payload: string;
  lineStart: number;
  lineEnd: number;
} | null {
  const rangeMatch = /:(\d+)(?:-(\d+))?$/u.exec(payload);
  if (!rangeMatch) {
    return { payload, lineStart: 0, lineEnd: 0 };
  }
  const lineStart = Number(rangeMatch[1]);
  const lineEnd = rangeMatch[2] !== undefined ? Number(rangeMatch[2]) : lineStart;
  const base = payload.slice(0, rangeMatch.index);
  if (!base) {
    return null;
  }
  return { payload: base, lineStart, lineEnd };
}
