import { PenTool } from "lucide-react";

import {
  BROWSER_ELEMENT_CHIP_CLASS,
  BROWSER_ELEMENT_CHIP_ICON_CLASS,
} from "@/lib/browser-element-chip-styles";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import { cn } from "@/lib/utils";

type BrowserElementChipProps = {
  attachment: BrowserElementAttachment;
  className?: string;
};

export function BrowserElementChip({ attachment, className }: BrowserElementChipProps) {
  return (
    <span
      title={attachment.pageUrl ?? attachment.url}
      className={cn(BROWSER_ELEMENT_CHIP_CLASS, className)}
    >
      <PenTool
        className={cn("size-[10px] shrink-0", BROWSER_ELEMENT_CHIP_ICON_CLASS)}
        aria-hidden
        strokeWidth={1.75}
      />
      {`<${attachment.tagName}>`}
    </span>
  );
}
