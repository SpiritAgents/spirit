import { X } from "@spiritagent/icons/x";
import { dialogContentClassName, dialogOverlayClassName } from "@spiritagent/ui/dialog";
import { RADIX_OVERLAY_CLOSE_MS } from "@spiritagent/ui/overlay-motion";
import * as React from "react";
import { createPortal } from "react-dom";

import { FONT_WEIGHT_NORMAL } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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
    }, RADIX_OVERLAY_CLOSE_MS);

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
  hasDescription = true,
}: {
  container: HTMLElement | null | undefined;
  className?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
  hasDescription?: boolean;
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
        className={cn(dialogOverlayClassName, "absolute isolate z-40")}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.preventDefault();
          onOpenChange(false);
        }}
      />
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={hasDescription ? descriptionId : undefined}
        data-state={state}
        data-slot="window-dialog-content"
        className={cn(
          dialogContentClassName,
          "absolute max-h-[calc(100%-2rem)] overflow-y-auto text-sm outline-none",
          className,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
        {showCloseButton ? (
          <Button
            variant="ghost"
            className="absolute top-2 right-2 text-muted-foreground"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-3.5" strokeWidth={1.75} />
            <span className="sr-only">Close</span>
          </Button>
        ) : null}
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
