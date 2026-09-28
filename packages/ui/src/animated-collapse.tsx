// Copyright (c) 2026 Yu
// SPDX-License-Identifier: MIT

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";

import { cn } from "./cn.js";
import { useCollapsibleChildMount } from "./hooks/use-collapsible-child-mount.js";

type AnimatedCollapseContextValue = {
  open: boolean;
  onOpenChange(nextOpen: boolean): void;
  contentId: string;
};

const AnimatedCollapseContext = createContext<AnimatedCollapseContextValue | null>(null);

function useAnimatedCollapseContext(component: string): AnimatedCollapseContextValue {
  const context = useContext(AnimatedCollapseContext);
  if (!context) {
    throw new Error(`${component} must be used within AnimatedCollapse`);
  }
  return context;
}

function AnimatedCollapse({
  open,
  defaultOpen,
  onOpenChange,
  className,
  children,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const resolvedOpen = isControlled ? open : uncontrolledOpen;
  const contentId = useId();

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  return (
    <AnimatedCollapseContext.Provider
      value={{
        open: resolvedOpen,
        onOpenChange: handleOpenChange,
        contentId,
      }}
    >
      <div data-slot="animated-collapse" className={className}>
        {children}
      </div>
    </AnimatedCollapseContext.Provider>
  );
}

function AnimatedCollapseTrigger({ className, children, ...props }: ComponentProps<"button">) {
  const { open, onOpenChange, contentId } = useAnimatedCollapseContext("AnimatedCollapseTrigger");

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={contentId}
      onClick={() => onOpenChange(!open)}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
}

function AnimatedCollapseContent({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const { open, contentId } = useAnimatedCollapseContext("AnimatedCollapseContent");
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  /** Mounted already open: skip the first expand animation (settings return / app restart). */
  const allowAnimationRef = useRef(!open);
  const hasOpenedRef = useRef(false);
  const prevOpenRef = useRef(open);
  // After the expand animation ends, remove the animation class and hand the height back to layout
  // (auto). fill-mode:forwards would pin the height permanently to var(--…-content-height); from
  // then on, nested collapsing-card animations could only chase the variable via RO writes every
  // frame — lagging and subject to the RO loop limit, with measured row heights showing jagged steps.
  // Once settled, height is content-driven and nested animations propagate in the same frame through
  // pure layout.
  const [expandSettled, setExpandSettled] = useState(false);
  const mounted = useCollapsibleChildMount(open);

  if (prevOpenRef.current !== open) {
    allowAnimationRef.current = true;
  }
  if (open) {
    hasOpenedRef.current = true;
  }
  const shouldAnimate = allowAnimationRef.current && hasOpenedRef.current;

  useLayoutEffect(() => {
    prevOpenRef.current = open;
    setExpandSettled(false);
  }, [open]);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer) {
      return;
    }
    outer.style.removeProperty("height");
    outer.style.removeProperty("opacity");
    outer.style.removeProperty("animation");
  }, [open]);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || !mounted) {
      return;
    }

    const syncHeight = () => {
      outer.style.setProperty("--spirit-collapsible-content-height", `${inner.scrollHeight}px`);
    };

    syncHeight();

    const observer = new ResizeObserver(() => {
      syncHeight();
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [mounted, open, children]);

  if (!mounted) {
    return (
      <div
        ref={outerRef}
        id={contentId}
        data-slot="animated-collapse-content"
        data-state="closed"
        className="h-0 overflow-hidden opacity-0"
        style={{ "--spirit-collapsible-content-height": "0px" } as CSSProperties}
      />
    );
  }

  return (
    <div
      ref={outerRef}
      id={contentId}
      data-slot="animated-collapse-content"
      data-state={open ? "open" : "closed"}
      onAnimationEnd={(event) => {
        if (open && event.target === outerRef.current) {
          setExpandSettled(true);
        }
      }}
      className={cn(
        "overflow-hidden",
        shouldAnimate &&
          open &&
          !expandSettled &&
          "animate-spirit-collapsible-down data-[state=open]:[animation-fill-mode:forwards]",
        shouldAnimate &&
          !open &&
          "animate-spirit-collapsible-up data-[state=closed]:[animation-fill-mode:forwards]",
        !open && !shouldAnimate && "h-0 opacity-0",
        className,
      )}
      style={
        !open && !shouldAnimate
          ? ({ "--spirit-collapsible-content-height": "0px" } as CSSProperties)
          : undefined
      }
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

export { AnimatedCollapse, AnimatedCollapseContent, AnimatedCollapseTrigger };
