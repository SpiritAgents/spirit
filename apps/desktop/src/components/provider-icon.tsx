import { Sparkles } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import {
  modelsDevProviderLogoUrl,
  probeModelsDevReachability,
} from "@/lib/models-dev-provider-logo";
import { cn } from "@/lib/utils";
import type { DesktopModelProvider } from "@/types";

type ProviderIconProps = {
  providerId: DesktopModelProvider;
  className?: string;
};

function ProviderFallbackIcon({ className }: { className?: string }) {
  return (
    <Sparkles
      aria-hidden
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
      strokeWidth={1.75}
    />
  );
}

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

/**
 * Provider logo from models.dev CDN when reachable; otherwise local Sparkles fallback
 * (`custom` always uses Sparkles).
 */
export function ProviderIcon({ providerId, className }: ProviderIconProps) {
  const [modelsDevReachable, setModelsDevReachable] = useState(false);

  useEffect(() => {
    if (providerId === "custom") {
      return;
    }

    let cancelled = false;
    void probeModelsDevReachability().then((reachable) => {
      if (!cancelled && reachable) {
        setModelsDevReachable(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [providerId]);

  if (providerId === "custom" || !modelsDevReachable) {
    return <ProviderFallbackIcon className={className} />;
  }

  return (
    <span
      aria-hidden
      className={cn("inline-block size-4 shrink-0 bg-foreground", className)}
      style={modelsDevLogoMaskStyle(providerId)}
    />
  );
}
