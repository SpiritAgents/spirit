import { useMemo } from "react";

import { DiffCodeScrollView } from "@/components/diff-code-scroll-view";
import type { DiffDisplayLine } from "@/lib/diff-display-lines";
import { DESKTOP_CONTENT_TRANSLUCENT_FILL } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

import "@/styles/tool-call-diff-view.css";

/**
 * Directory listing preview for ls approvals: a bare box of entry names. No frame header, no
 * line numbers, no per-entry icons — the listing reads as "only these entries come back", not
 * as file content being shared.
 */
export type DirectoryListPreviewProps = {
  content: string;
};

function listingLines(content: string): DiffDisplayLine[] {
  const normalized = content.replace(/\r\n/g, "\n");
  const rows = normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
  return rows.map((row) => ({ kind: "normal", content: row }));
}

export function DirectoryListPreview({ content }: DirectoryListPreviewProps) {
  const lines = useMemo(() => listingLines(content), [content]);

  // Outline-control default fill (background + translucent layer), not a code box: the shared
  // diff body is transparent, so this box is the only painted layer.
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-outline-border bg-background px-2 py-1.5",
        DESKTOP_CONTENT_TRANSLUCENT_FILL,
      )}
    >
      <DiffCodeScrollView lines={lines} languageId="plaintext" gutter="none" />
    </div>
  );
}
