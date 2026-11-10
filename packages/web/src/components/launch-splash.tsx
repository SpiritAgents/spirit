import { useEffect, useLayoutEffect, useState } from "react";

import { SpiritGlassLogo, spiritGlassLogoMaskStyle } from "@spiritagent/brand";

import { desktopFullscreenOverlayTintClass } from "@/lib/desktop-translucency-surface";
import type { ShellOverlayPhase } from "@/lib/desktop-shell";
import { cn } from "@/lib/utils";

const LAUNCH_LOGO_WIDTH_PX = 72;

const EXIT_MS = 520;

/** Delay after loading ends before playing the exit animation (milliseconds); 0 means exit immediately */
const EXIT_DELAY_BEFORE_MS = 0;

type Phase = "running" | "leaving" | "gone";

type LaunchSplashProps = {
  /** When true the loading state is shown; when it becomes false, the exit animation plays and then it unmounts */
  active: boolean;
  /** translucency (Win Mica / macOS Vibrancy): when enabled, uses the fullscreen overlay tint (`bg-background/70`). */
  useTranslucency?: boolean;
  /** Phase changes during the mount lifetime (so the host does not reveal app-body early, before leaving). */
  onPhaseChange?: (phase: ShellOverlayPhase) => void;
};

/**
 * First-screen launch: centered brand icon + skeleton-style linear shimmer, fading out once the
 * host is ready.
 * When Blur is enabled, uses the fullscreen overlay tint (`bg-background/70`).
 * On exit, the whole layer (including the background tint) fades out with the container opacity;
 * the app-body below is hidden early by a styles.css rule via opacity and kept rasterized, fading
 * in with a compensation curve during the exit — background and main content thus cross-fade into
 * place instead of a hard cut.
 */
export function LaunchSplash({
  active,
  useTranslucency = false,
  onPhaseChange,
}: LaunchSplashProps) {
  const [phase, setPhase] = useState<Phase>(() => (active ? "running" : "gone"));

  useEffect(() => {
    if (active) {
      setPhase("running");
      return;
    }
    const id = window.setTimeout(() => {
      setPhase((current) => {
        if (current === "running" || current === "leaving") {
          return "leaving";
        }
        return current;
      });
    }, EXIT_DELAY_BEFORE_MS);
    return () => window.clearTimeout(id);
  }, [active]);

  useEffect(() => {
    if (phase !== "leaving") {
      return;
    }
    const id = window.setTimeout(() => {
      setPhase("gone");
    }, EXIT_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  useLayoutEffect(() => {
    onPhaseChange?.(phase);
  }, [onPhaseChange, phase]);

  useLayoutEffect(() => {
    if (!active || phase !== "running") {
      return;
    }
    window.spiritDesktop?.notifyLaunchSplashReady?.();
  }, [active, phase]);

  if (phase === "gone") {
    return null;
  }

  const exiting = phase === "leaving";

  return (
    <div
      data-spirit-surface="launch-splash"
      aria-hidden={exiting}
      className={cn(
        "fixed inset-0 z-[200] flex items-center justify-center",
        desktopFullscreenOverlayTintClass(useTranslucency),
        "transition-opacity duration-500 ease-out motion-reduce:duration-200",
        exiting ? "pointer-events-none opacity-0" : "opacity-100",
      )}
    >
      <div
        className={cn(
          "relative shrink-0 transition-[opacity,transform] duration-[420ms] ease-out motion-reduce:duration-150",
          exiting ? "scale-[0.97] opacity-0 motion-reduce:scale-100" : "scale-100 opacity-100",
        )}
        style={{ width: LAUNCH_LOGO_WIDTH_PX }}
      >
        <SpiritGlassLogo width={LAUNCH_LOGO_WIDTH_PX} className="relative z-0" />
        <div
          className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
          style={spiritGlassLogoMaskStyle()}
          aria-hidden
        >
          <div className="spirit-launch-shimmer-sweep" />
        </div>
      </div>
    </div>
  );
}
