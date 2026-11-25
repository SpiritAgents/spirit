import type { MarkdownLinkComponentProps } from "@spiritagent/ui/rendering/markdown-message-components";
import { AgentLinkFavicon } from "@/components/agent-link-favicon";
import { AgentLinkPreviewCard } from "@/components/agent-link-preview-card";
import { useAgentLinkPreview } from "@/components/agent-link-preview-context";
import { TextLink } from "@/components/ui/link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export function AgentInlineLink({
  muted = false,
  streaming = false,
  className,
  href,
  children,
  ...props
}: MarkdownLinkComponentProps) {
  const { resolvedDark } = useTheme();
  const hrefValue = href?.trim() ?? "";
  const isHttp = /^https?:\/\//i.test(hrefValue);
  const preview = useAgentLinkPreview(isHttp && !streaming ? hrefValue : undefined);

  if (!isHttp) {
    return (
      <TextLink muted={muted} className={className} href={href} {...props}>
        {children}
      </TextLink>
    );
  }

  return (
    <Tooltip delayDuration={300}>
      <Tooltip.Zone asChild>
        <TooltipTrigger asChild>
          <a
            href={href}
            className={cn(
              "group inline no-underline",
              muted
                ? "text-muted-foreground hover:text-chrome-emphasis/80"
                : "text-foreground hover:text-chrome-emphasis/80",
              className,
            )}
            {...props}
          >
            <AgentLinkFavicon
              preview={preview}
              resolvedDark={resolvedDark}
              className="mr-1 inline-block size-3.5 align-[-0.125em]"
            />
            <span className="underline underline-offset-2">{children}</span>
          </a>
        </TooltipTrigger>
      </Tooltip.Zone>
      <TooltipContent
        appearance="detail"
        sideOffset={8}
        collisionPadding={8}
        className="w-80 overflow-hidden p-0"
      >
        <AgentLinkPreviewCard
          href={hrefValue}
          preview={preview}
          resolvedDark={resolvedDark}
          target={props.target}
          rel={props.rel}
          onClick={props.onClick}
        />
      </TooltipContent>
    </Tooltip>
  );
}
