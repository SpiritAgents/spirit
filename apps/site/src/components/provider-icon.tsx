import { Sparkles } from "lucide-react";
import type { CSSProperties } from "react";

import { modelsDevProviderLogoUrl } from "@/lib/models-dev-provider-logo";
import { cn } from "@/lib/utils";
import type { DesktopModelProvider } from "@/types/spirit-desktop";

type ProviderIconProps = {
  providerId: DesktopModelProvider;
  className?: string;
};

function modelsDevLogoMaskStyle(providerId: DesktopModelProvider): CSSProperties {
  const url = modelsDevProviderLogoUrl(providerId);
  return {
    WebkitMaskImage: `url("${url}")`,
    maskImage: `url("${url}")`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };
}

/** Provider logo from models.dev CDN; `custom` uses a local fallback icon. */
export function ProviderIcon({ providerId, className }: ProviderIconProps) {
  if (providerId === "custom") {
    return (
      <Sparkles
        aria-hidden
        className={cn("size-4 shrink-0 text-muted-foreground", className)}
        strokeWidth={1.75}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn("inline-block size-4 shrink-0 bg-foreground", className)}
      style={modelsDevLogoMaskStyle(providerId)}
    />
  );
}
