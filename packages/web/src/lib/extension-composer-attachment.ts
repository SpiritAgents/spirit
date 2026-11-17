import type {
  FileSnippetAttachment,
  PrDiffAttachment,
  TerminalSnippetAttachment,
} from "@spiritagent/ui/composer";

export type ExtensionComposerAttachment =
  | { kind: "prDiff"; attachment: PrDiffAttachment }
  | { kind: "fileSnippet"; attachment: FileSnippetAttachment }
  | { kind: "terminalSnippet"; attachment: TerminalSnippetAttachment };

/** This is the single untrusted-page boundary; ids and origin always belong to the host. */
export function parseExtensionComposerAttachment(
  value: unknown,
  sourceTabId: string,
): ExtensionComposerAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("An attachment object is required.");
  }
  const input = value as Record<string, unknown>;
  const text = (key: string): string => {
    if (typeof input[key] !== "string" || !input[key].trim()) {
      throw new Error(`Attachment ${key} must be a non-empty string.`);
    }
    return input[key];
  };
  const lineStart = input.lineStart;
  const lineEnd = input.lineEnd;
  if (
    !Number.isSafeInteger(lineStart) ||
    !Number.isSafeInteger(lineEnd) ||
    (lineStart as number) < 0 ||
    (lineEnd as number) < (lineStart as number)
  ) {
    throw new Error("Attachment line range is invalid.");
  }
  const base = {
    id: crypto.randomUUID(),
    sourceTabId,
    lineStart: lineStart as number,
    lineEnd: lineEnd as number,
  };
  switch (input.kind) {
    case "prDiff": {
      const prUrl = text("prUrl");
      if (!URL.canParse(prUrl) || !["http:", "https:"].includes(new URL(prUrl).protocol)) {
        throw new Error("Pull request attachments require an HTTP(S) URL.");
      }
      const status = input.status;
      if (status !== "open" && status !== "closed" && status !== "merged" && status !== "draft") {
        throw new Error("Pull request attachment status is invalid.");
      }
      return {
        kind: "prDiff",
        attachment: {
          ...base,
          prUrl,
          filename: text("filename"),
          diffText: text("diffText"),
          status,
        },
      };
    }
    case "fileSnippet":
      return {
        kind: "fileSnippet",
        attachment: { ...base, filePath: text("filePath"), selectedText: text("selectedText") },
      };
    case "terminalSnippet":
      return {
        kind: "terminalSnippet",
        attachment: {
          ...base,
          terminalName: text("terminalName"),
          selectedText: text("selectedText"),
        },
      };
    default:
      throw new Error("Unsupported extension attachment kind.");
  }
}
