import type { ToolApprovalRequest } from "@spiritagent/agent-core";

import { monacoLanguageId } from "./monaco-language.js";
import type { FileContentPreviewPayload, FileDiffPreviewPayload } from "../types.js";

/**
 * Maps the executor-produced previews on a ToolApprovalRequest to the render payloads of the
 * approval card. Shared by the host snapshot mapper (real approvals) and the approval demo
 * gallery, so the demo always renders through the same path as real cards.
 */
export function fileDiffPreviewsForApprovalRequest(
  request: ToolApprovalRequest,
): FileDiffPreviewPayload[] | undefined {
  const preview = "fileDiffPreview" in request ? request.fileDiffPreview : undefined;
  if (!preview) {
    return undefined;
  }
  return [
    {
      relativePath: preview.path,
      languageId: monacoLanguageId(preview.path),
      original: preview.original,
      modified: preview.modified,
      // Delete frames start collapsed: the content is only context for the decision.
      ...(preview.operation === "delete" ? { defaultOpen: false } : {}),
    },
  ];
}

/** Out-of-workspace read approvals: clean line-numbered content, expanded by default. */
export function fileContentPreviewForApprovalRequest(
  request: ToolApprovalRequest,
): FileContentPreviewPayload | undefined {
  if (request.kind !== "read_path") {
    return undefined;
  }
  const preview = request.fileContentPreview;
  if (!preview) {
    return undefined;
  }
  return {
    relativePath: preview.path,
    languageId: request.operation === "ls" ? "plaintext" : monacoLanguageId(preview.path),
    content: preview.content,
    ...(request.operation === "ls" ? { directory: true } : {}),
  };
}
