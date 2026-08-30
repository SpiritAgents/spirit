import { memo } from "react";

import { SpiritStreamdownMarkdown } from "@/components/spirit-streamdown-markdown";
import type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";
import type {
  ReadLocalImagePreview,
  ReadLocalVideoPreview,
} from "@/components/tool-call/tool-call-types";
import type { MarkdownSize, MarkdownTone } from "@/lib/markdown-message-components";

export type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";
export type { MarkdownSize, MarkdownTone } from "@/lib/markdown-message-components";

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  className,
  tone = "default",
  size = "default",
  allowHtml = false,
  singleLineBreaks = true,
  readManagedImagePreviewDataUrl,
  readLocalImagePreviewDataUrl,
  readLocalVideoPreviewUrl,
  localImageBaseDir,
  localImageAllowedRootDir,
}: {
  content: string;
  className?: string;
  tone?: MarkdownTone;
  size?: MarkdownSize;
  allowHtml?: boolean;
  singleLineBreaks?: boolean;
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl;
  readLocalImagePreviewDataUrl?: ReadLocalImagePreview;
  readLocalVideoPreviewUrl?: ReadLocalVideoPreview;
  localImageBaseDir?: string;
  localImageAllowedRootDir?: string;
}) {
  return (
    <SpiritStreamdownMarkdown
      content={content}
      streaming={false}
      className={className}
      tone={tone}
      size={size}
      allowHtml={allowHtml}
      singleLineBreaks={singleLineBreaks}
      readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
      readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
      readLocalVideoPreviewUrl={readLocalVideoPreviewUrl}
      localImageBaseDir={localImageBaseDir}
      localImageAllowedRootDir={localImageAllowedRootDir}
    />
  );
});
