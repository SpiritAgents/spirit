import * as React from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";

import { FONT_WEIGHT_NORMAL } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const WINDOW_DIALOG_ANIMATION_MS = 100;
const WINDOW_DIALOG_OVERLAY_TOKENS =
  "duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-closed:fill-mode-forwards";
const WINDOW_DIALOG_CONTENT_TOKENS =
  "duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-closed:fill-mode-forwards";

type WindowDialogContextValue = {
  open: boolean;
  present: boolean;
  state: "open" | "closed";
  titleId: string;
  descriptionId: string;
  onOpenChange(open: boolean): void;
};

const WindowDialogContext = React.createContext<WindowDialogContextValue | null>(null);

function useWindowDialogContext() {
  const context = React.useContext(WindowDialogContext);
  if (!context) {
    throw new Error("WindowDialog components must be used within <WindowDialog>.");
  }
  return context;
}

function WindowDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  children: React.ReactNode;
}) {
  const [present, setPresent] = React.useState(open);
  const [state, setState] = React.useState<"open" | "closed">(open ? "open" : "closed");
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    if (open) {
      setPresent(true);
      setState("open");
      return;
    }

    setState("closed");
    const timeoutId = window.setTimeout(() => {
      setPresent(false);
    }, WINDOW_DIALOG_ANIMATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [open]);

  const value = React.useMemo(
    () => ({
      open,
      present,
      state,
      titleId,
      descriptionId,
      onOpenChange,
    }),
    [descriptionId, onOpenChange, open, present, state, titleId],
  );

  return <WindowDialogContext.Provider value={value}>{children}</WindowDialogContext.Provider>;
}

function WindowDialogContent({
  container,
  className,
  children,
  showCloseButton = true,
}: {
  container: HTMLElement | null | undefined;
  className?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
}) {
  const { present, state, titleId, descriptionId, onOpenChange } = useWindowDialogContext();

  React.useEffect(() => {
    if (!present) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, present]);

  if (!present || !container) {
    return null;
  }

  return createPortal(
    <>
      <div
        data-state={state}
        data-slot="window-dialog-overlay"
        aria-hidden="true"
        className={cn(
          `absolute inset-0 isolate z-40 bg-black/10 backdrop-blur-xs ${WINDOW_DIALOG_OVERLAY_TOKENS}`,
        )}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.preventDefault();
          onOpenChange(false);
        }}
      />
      <div
        data-state={state}
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 sm:max-w-sm",
        )}
      >
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          data-state={state}
          data-slot="window-dialog-content"
          className={cn(
            `pointer-events-auto grid max-h-[calc(100%-2rem)] w-full gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none ${WINDOW_DIALOG_CONTENT_TOKENS}`,
            className,
          )}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
          {showCloseButton ? (
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          ) : null}
        </div>
      </div>
    </>,
    container,
  );
}

function WindowDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="window-dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function WindowDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="window-dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function WindowDialogTitle({ className, ...props }: React.ComponentProps<"div">) {
  const { titleId } = useWindowDialogContext();
  return (
    <div
      id={titleId}
      data-slot="window-dialog-title"
      className={cn(`font-heading text-base leading-none ${FONT_WEIGHT_NORMAL}`, className)}
      {...props}
    />
  );
}

function WindowDialogDescription({ className, ...props }: React.ComponentProps<"div">) {
  const { descriptionId } = useWindowDialogContext();
  return (
    <div
      id={descriptionId}
      data-slot="window-dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  WindowDialog,
  WindowDialogContent,
  WindowDialogDescription,
  WindowDialogFooter,
  WindowDialogHeader,
  WindowDialogTitle,
};
