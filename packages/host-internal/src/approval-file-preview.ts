import { readFile, readdir } from "node:fs/promises";

import type {
  ToolApprovalFileContentPreview,
  ToolApprovalFileDiffPreview,
} from "@spiritagent/agent-core";

import { applyDiff } from "./apply-diff.js";

/**
 * Builds the previews attached to file approval requests (see `ToolApprovalRequest` in
 * agent-core): `fileDiffPreview` for file-change tools, `fileContentPreview` for
 * out-of-workspace reads. Previews are produced at authorization time so every host (Desktop,
 * CLI, ACP) renders the same content; hosts fall back to the plain text prompt when no preview
 * is attached.
 */

/** Mirrors the desktop diff viewer budget (`FILE_TOOL_DIFF_MAX_BYTES`); over-sized content drops the preview instead of shipping megabytes over the host bridge. */
export const APPROVAL_FILE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

export type ApprovalFileDiffPreviewSource =
  | { kind: "create_file"; path: string; content: string }
  | { kind: "create_plan"; planName: string; content: string }
  | { kind: "edit_file"; path: string; oldText: string; newText: string }
  | { kind: "delete_file"; path: string }
  | {
      kind: "apply_patch";
      operation: {
        type: "create_file" | "update_file" | "delete_file";
        path: string;
        diff?: string;
      };
    };

/** Same display convention as the conversation tool cards: plans render as `plans/{name}.md`. */
function planPreviewPath(planName: string): string {
  const trimmed = planName.trim();
  return `plans/${trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`}`;
}

function capped(preview: ToolApprovalFileDiffPreview): ToolApprovalFileDiffPreview | undefined {
  const encoder = new TextEncoder();
  if (
    encoder.encode(preview.original).length > APPROVAL_FILE_PREVIEW_MAX_BYTES ||
    encoder.encode(preview.modified).length > APPROVAL_FILE_PREVIEW_MAX_BYTES
  ) {
    return undefined;
  }
  return preview;
}

async function deletePreview(
  path: string,
  resolveWriteTarget: (inputPath: string) => string,
): Promise<ToolApprovalFileDiffPreview | undefined> {
  const original = await readFile(resolveWriteTarget(path), "utf8");
  return capped({ path, original, modified: "", operation: "delete" });
}

async function applyPatchPreview(
  operation: { type: "create_file" | "update_file" | "delete_file"; path: string; diff?: string },
  resolveWriteTarget: (inputPath: string) => string,
): Promise<ToolApprovalFileDiffPreview | undefined> {
  switch (operation.type) {
    case "create_file": {
      if (operation.diff === undefined || operation.diff.trim().length === 0) {
        return undefined;
      }
      // Same entry point as execution, so the preview shows exactly what would be written.
      const modified = applyDiff("", operation.diff, "create");
      return capped({ path: operation.path, original: "", modified, operation: "create" });
    }
    case "update_file": {
      if (operation.diff === undefined || operation.diff.trim().length === 0) {
        return undefined;
      }
      const original = await readFile(resolveWriteTarget(operation.path), "utf8");
      const modified = applyDiff(original, operation.diff);
      return capped({ path: operation.path, original, modified, operation: "update" });
    }
    case "delete_file":
      return deletePreview(operation.path, resolveWriteTarget);
  }
}

/**
 * Resolves the preview for one approval source, or `undefined` when there is nothing meaningful
 * to show (empty edit, empty patch diff, over-sized content). Throws on unreadable targets or
 * inapplicable patches; the caller treats that as "no preview".
 */
export async function buildApprovalFileDiffPreview(
  source: ApprovalFileDiffPreviewSource,
  resolveWriteTarget: (inputPath: string) => string,
): Promise<ToolApprovalFileDiffPreview | undefined> {
  switch (source.kind) {
    case "create_file":
      return capped({
        path: source.path,
        original: "",
        modified: source.content,
        operation: "create",
      });
    case "create_plan":
      return capped({
        path: planPreviewPath(source.planName),
        original: "",
        modified: source.content,
        operation: "create",
      });
    case "edit_file":
      // Snippet-level pair (old_text vs new_text), mirroring the conversation tool diff.
      if (source.oldText.length === 0) {
        return undefined;
      }
      return capped({
        path: source.path,
        original: source.oldText,
        modified: source.newText,
        operation: "update",
      });
    case "delete_file":
      return deletePreview(source.path, resolveWriteTarget);
    case "apply_patch":
      return applyPatchPreview(source.operation, resolveWriteTarget);
  }
}

/**
 * Content preview for an out-of-workspace read approval. `canonical` is already the realpath'd
 * absolute target produced by the authorize flow. Returns `undefined` for binaries (a text
 * frame of replacement characters helps no one) and over-sized content; throws on unreadable
 * targets, which the caller treats as "no preview".
 */
export async function buildApprovalFileContentPreview(
  canonical: string,
  operation: "read_file" | "ls",
): Promise<ToolApprovalFileContentPreview | undefined> {
  const content =
    operation === "ls"
      ? await listDirectoryPreviewLines(canonical)
      : await readFile(canonical, "utf8");
  if (content.includes("\0")) {
    return undefined;
  }
  if (new TextEncoder().encode(content).length > APPROVAL_FILE_PREVIEW_MAX_BYTES) {
    return undefined;
  }
  return { path: canonical, content };
}

/** Directory names first with a trailing slash, then files; same ordering as `executeLs`. */
async function listDirectoryPreviewLines(canonical: string): Promise<string> {
  const entries = await readdir(canonical, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${entry.name}/`)
    .sort((left, right) => left.localeCompare(right));
  const files = entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  return [...directories, ...files].join("\n");
}
