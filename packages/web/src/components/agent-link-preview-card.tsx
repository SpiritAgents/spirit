import { useState, type AnchorHTMLAttributes } from "react";

import { ArrowUpRight } from "lucide-react";
import { AgentLinkFavicon } from "@/components/agent-link-favicon";
import type { AgentLinkPreview } from "@/lib/agent-link-preview";

function linkHostname(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return href;
  }
}

export function AgentLinkPreviewCard({
  href,
  preview,
  resolvedDark,
  target,
  rel,
  onClick,
}: {
  href: string;
  preview: AgentLinkPreview | null | undefined;
  resolvedDark: boolean;
} & Pick<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel" | "onClick">) {
  const [failedImageUrl, setFailedImageUrl] = useState<string>();
  const imageUrl = preview?.imageUrl;
  const showImage = Boolean(imageUrl && failedImageUrl !== imageUrl);

  return (
    <a
      data-agent-link-preview-card
      href={href}
      target={target}
      rel={rel}
      onClick={onClick}
      className="block bg-popover text-popover-foreground transition-none hover:brightness-[0.96] dark:hover:brightness-[0.92]"
    >
      {showImage ? (
        <img
          data-agent-link-og-image
          src={imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="block h-auto w-full"
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : null}
      {preview?.title || preview?.description ? (
        <div className="px-3 pt-2.5 text-left">
          {preview.title ? (
            <div className="line-clamp-2 text-[13px] font-normal leading-snug">{preview.title}</div>
          ) : null}
          {preview.description ? (
            <div className="mt-1 line-clamp-2 text-[13px] font-normal leading-snug text-muted-foreground">
              {preview.description}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3 px-3 pb-2.5 pt-2 text-left">
        <div
          data-agent-link-preview-footer
          className="flex min-w-0 items-center gap-1.5 text-muted-foreground"
        >
          <span className="shrink-0">
            <AgentLinkFavicon preview={preview} resolvedDark={resolvedDark} className="size-3" />
          </span>
          <span className="truncate text-xs leading-4 text-muted-foreground">
            {linkHostname(href)}
          </span>
        </div>
        <ArrowUpRight
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
        />
      </div>
    </a>
  );
}
