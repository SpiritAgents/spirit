import * as React from "react";

import { DESKTOP_OUTLINE_BORDER } from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(function Input(
  { className, type, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        // No hover/focus brightening anywhere: the text cursor already signals the input state.
        "h-8 w-full min-w-0 rounded-lg bg-background px-2.5 py-1 text-base outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-normal file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        DESKTOP_OUTLINE_BORDER,
        className,
      )}
      {...props}
    />
  );
});

export { Input };
