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
  keepMounted = false,
  children,
}: {
  className?: string;
  /** Keep children mounted in the DOM while collapsed (e.g. live iframes whose state must survive collapse/expand). */
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const { open, contentId } = useAnimatedCollapseContext("AnimatedCollapseContent");
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  /** Mounted already open: skip the first expand animation (settings return / app restart). */
  const [allowAnimation, setAllowAnimation] = useState(!open);
  const [hasOpened, setHasOpened] = useState(open);
  const [previousOpen, setPreviousOpen] = useState(open);
  // After the expand animation ends, remove the animation class and hand the height back to layout
  // (auto). fill-mode:forwards would pin the height permanently to var(--…-content-height); from
  // then on, nested collapsing-card animations could only chase the variable via RO writes every
  // frame — lagging and subject to the RO loop limit, with measured row heights showing jagged steps.
  // Once settled, height is content-driven and nested animations propagate in the same frame through
  // pure layout.
  const [expandSettled, setExpandSettled] = useState(false);
  const [collapseSettled, setCollapseSettled] = useState(!open);
  const collapsibleMounted = useCollapsibleChildMount(open);
  const mounted = keepMounted || collapsibleMounted;

  if (previousOpen !== open) {
    setPreviousOpen(open);
    setAllowAnimation(true);
    setExpandSettled(false);
    setCollapseSettled(false);
  }
  if (open && !hasOpened) {
    setHasOpened(true);
  }
  const shouldAnimate = allowAnimation && hasOpened;

  const previousStyleOpenRef = useRef(open);

  useLayoutEffect(() => {
    const openChanged = previousStyleOpenRef.current !== open;
    previousStyleOpenRef.current = open;
    if (!openChanged) {
      return;
    }
    const outer = outerRef.current;
    if (!outer) {
      return;
    }
    outer.style.removeProperty("height");
    outer.style.removeProperty("opacity");
    outer.style.removeProperty("animation");
  }, [open]);

  const previousHeightInputsRef = useRef<{ open: boolean; children: ReactNode } | null>(null);
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || !mounted) {
      return;
    }

    const syncHeight = () => {
      outer.style.setProperty("--spirit-collapsible-content-height", `${inner.scrollHeight}px`);
    };

    const previous = previousHeightInputsRef.current;
    const inputsChanged = !previous || previous.open !== open || previous.children !== children;
    previousHeightInputsRef.current = { open, children };
    if (inputsChanged) {
      syncHeight();
    }

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
      inert={!open}
      aria-hidden={!open}
      onAnimationEnd={(event) => {
        if (event.target !== outerRef.current) {
          return;
        }
        if (open) {
          setExpandSettled(true);
        } else {
          setCollapseSettled(true);
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
          !collapseSettled &&
          "animate-spirit-collapsible-up data-[state=closed]:[animation-fill-mode:forwards]",
        !open && (!shouldAnimate || collapseSettled) && "h-0 opacity-0",
        className,
      )}
      style={
        !open && (!shouldAnimate || collapseSettled)
          ? ({ "--spirit-collapsible-content-height": "0px" } as CSSProperties)
          : undefined
      }
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

export { AnimatedCollapse, AnimatedCollapseContent, AnimatedCollapseTrigger };
