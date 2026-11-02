import { open } from "node:fs/promises";
import path from "node:path";

import { resolveTranscriptsDir } from "@spiritagent/host-internal";

import {
  scanSessionReferenceWireBlocks,
  sessionReferenceContextText,
} from "@spiritagent/ui/composer";
import { spiritDataDir } from "./storage.js";

const TRANSCRIPT_UNAVAILABLE_BODY = "[session transcript unavailable: file missing or unreadable]";
/** Model-visible truncation marker when a referenced transcript exceeds the budget. */
const TRANSCRIPT_TRUNCATED_SUFFIX = "\n\n[session transcript truncated]";
/** Cap injected transcript body so one @session turn cannot blow the model context. */
const SESSION_REFERENCE_TRANSCRIPT_MAX_BYTES = 64 * 1024;

function isPathInsideTranscriptsRoot(candidatePath: string): boolean {
  const transcriptsRoot = path.resolve(resolveTranscriptsDir(spiritDataDir()));
  const resolved = path.resolve(candidatePath);
  const relative = path.relative(transcriptsRoot, resolved);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function readTranscriptBody(transcriptPath: string): Promise<string> {
  if (!isPathInsideTranscriptsRoot(transcriptPath)) {
    return TRANSCRIPT_UNAVAILABLE_BODY;
  }
  try {
    const resolved = path.resolve(transcriptPath);
    const handle = await open(resolved, "r");
    try {
      const { size } = await handle.stat();
      if (size <= 0) {
        return TRANSCRIPT_UNAVAILABLE_BODY;
      }
      const readLength = Math.min(size, SESSION_REFERENCE_TRANSCRIPT_MAX_BYTES);
      const buffer = Buffer.alloc(readLength);
      const { bytesRead } = await handle.read(buffer, 0, readLength, 0);
      let raw = buffer.subarray(0, bytesRead).toString("utf8");
      if (size > SESSION_REFERENCE_TRANSCRIPT_MAX_BYTES) {
        // Truncation may split a UTF-8 sequence; drop a trailing replacement char if present.
        return `${raw.replace(/\uFFFD$/u, "").trimEnd()}${TRANSCRIPT_TRUNCATED_SUFFIX}`;
      }
      return raw.trim().length > 0 ? raw : TRANSCRIPT_UNAVAILABLE_BODY;
    } finally {
      await handle.close();
    }
  } catch {
    return TRANSCRIPT_UNAVAILABLE_BODY;
  }
}

/**
 * Expand ```session:...``` fences in user text so the agent receives transcript
 * body in-message (same shape as git/terminal chip wires).
 */
export async function hydrateSessionReferenceWiresInUserText(text: string): Promise<string> {
  const blocks = scanSessionReferenceWireBlocks(text);
  if (blocks.length === 0) {
    return text;
  }

  let result = text;
  for (const block of [...blocks].sort((left, right) => right.index - left.index)) {
    const content =
      block.content.trim().length > 0 ? block.content : await readTranscriptBody(block.path);
    const replacement = sessionReferenceContextText(block.path, block.title, content);
    const blockEnd = block.index + block.length;
    const originalEndsWithNewline = block.length > 0 && result[blockEnd - 1] === "\n";
    const replacementWithTrailing =
      originalEndsWithNewline && !replacement.endsWith("\n") ? `${replacement}\n` : replacement;
    result = result.slice(0, block.index) + replacementWithTrailing + result.slice(blockEnd);
  }
  return result;
}
