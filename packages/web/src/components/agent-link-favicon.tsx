import { useState } from "react";

import { Globe } from "@spiritagent/icons/globe";
import { agentLinkIconCandidates, type AgentLinkPreview } from "@/lib/agent-link-preview";
import { cn } from "@/lib/utils";

export function AgentLinkFavicon({
  preview,
  resolvedDark,
  className,
}: {
  preview: AgentLinkPreview | null | undefined;
  resolvedDark: boolean;
  className?: string;
}) {
  const candidates = preview ? agentLinkIconCandidates(preview, resolvedDark) : [];
  const candidateKey = `${resolvedDark}:${candidates.join("\u0000")}`;
  const [failed, setFailed] = useState<{ key: string; urls: string[] }>({ key: "", urls: [] });
  const failedUrls = failed.key === candidateKey ? failed.urls : [];
  const current = candidates.find((url) => !failedUrls.includes(url));

  if (!current) {
    return (
      <Globe
        aria-hidden
        data-agent-link-favicon="fallback"
        className={cn("shrink-0", className)}
        strokeWidth={1.75}
      />
    );
  }
  return (
    <img
      key={current}
      aria-hidden
      data-agent-link-favicon="site"
      src={current}
      referrerPolicy="no-referrer"
      className={cn("shrink-0 select-none rounded-[3px] object-contain no-underline", className)}
      onError={() => {
        setFailed((previous) => ({
          key: candidateKey,
          urls: [...(previous.key === candidateKey ? previous.urls : []), current],
        }));
      }}
    />
  );
}
