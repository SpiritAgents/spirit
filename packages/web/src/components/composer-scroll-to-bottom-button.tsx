import { ChevronDown } from "@spiritagent/icons/chevron-down";
import { useEffect, useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { desktopComposerChipSurfaceClass } from "@/lib/desktop-translucency-surface";
import { prefersReducedMotion } from "@/lib/reduce-motion";
import { cn } from "@/lib/utils";

const FADE_MS = 150;

export function ComposerScrollToBottomButton({
  visible,
  onClick,
  useTranslucency = false,
}: {
  visible: boolean;
  onClick: () => void;
  useTranslucency?: boolean;
}) {
  const { t } = useTranslation();
  const [rendered, setRendered] = useState(visible);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      return;
    }
    if (!rendered) {
      return;
    }
    const ms = prefersReducedMotion() ? 0 : FADE_MS;
    const timer = window.setTimeout(() => setRendered(false), ms);
    return () => window.clearTimeout(timer);
  }, [visible, rendered]);

  useLayoutEffect(() => {
    if (!rendered) {
      return;
    }
    if (!visible) {
      setShown(false);
      return;
    }
    if (prefersReducedMotion()) {
      setShown(true);
      return;
    }
    setShown(false);
    let cancelled = false;
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) {
          setShown(true);
        }
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
    };
  }, [visible, rendered]);

  if (!rendered) {
    return null;
  }

  return (
    <button
      type="button"
      data-spirit-surface="composer-scroll-to-bottom"
      className={cn(
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full leading-none",
        "transition-opacity duration-150 ease-out motion-reduce:transition-none",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
        desktopComposerChipSurfaceClass(useTranslucency),
      )}
      onClick={onClick}
      aria-label={t("composer.scrollToBottomAria")}
      aria-hidden={!shown}
      tabIndex={shown ? undefined : -1}
    >
      <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden strokeWidth={1.75} />
    </button>
  );
}
