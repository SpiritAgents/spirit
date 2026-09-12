import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { EditFileLineDelta } from "@/lib/edit-file-line-delta";

type SlideDirection = "up" | "down" | "none";

function AnimatedCount({ value, className }: { value: number; className: string }) {
  const previousRef = useRef(value);
  const [direction, setDirection] = useState<SlideDirection>("none");
  const [columns, setColumns] = useState<{ char: string; changed: boolean }[]>(() =>
    Array.from(String(value), (char) => ({ char, changed: false })),
  );

  useLayoutEffect(() => {
    const previous = previousRef.current;
    if (value === previous) {
      return;
    }
    const previousChars = String(previous).split("");
    const nextChars = String(value).split("");
    const offset = nextChars.length - previousChars.length;
    const alignedPrevious = nextChars.map((_, index) => previousChars[index - offset] ?? "");
    setDirection(value > previous ? "up" : "down");
    setColumns(
      nextChars.map((char, index) => ({ char, changed: char !== alignedPrevious[index] })),
    );
    previousRef.current = value;
  }, [value]);

  return (
    <span
      className={cn(
        "relative inline-flex h-[1em] items-center overflow-hidden font-sans leading-none",
        className,
      )}
      aria-hidden
    >
      {columns.map((column, index) => (
        <span key={index} className="inline-block">
          <span
            key={column.char}
            className={cn(
              "inline-block",
              column.changed && direction === "up" && "spirit-edit-delta-slide-up",
              column.changed && direction === "down" && "spirit-edit-delta-slide-down",
            )}
          >
            {column.char}
          </span>
        </span>
      ))}
    </span>
  );
}

export function EditFileLineDeltaBadge({
  delta,
  className,
}: {
  delta: EditFileLineDelta;
  className?: string;
}) {
  if (delta.added === 0 && delta.removed === 0) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 font-sans text-xs font-normal leading-none",
        className,
      )}
    >
      {delta.added > 0 ? (
        <span className="inline-flex items-baseline leading-none text-emerald-600 dark:text-emerald-400">
          <span aria-hidden className="leading-none">
            +
          </span>
          <AnimatedCount value={delta.added} className="text-emerald-600 dark:text-emerald-400" />
        </span>
      ) : null}
      {delta.removed > 0 ? (
        <span className="inline-flex items-baseline leading-none text-red-500 dark:text-red-400">
          <span aria-hidden className="leading-none">
            -
          </span>
          <AnimatedCount value={delta.removed} className="text-red-500 dark:text-red-400" />
        </span>
      ) : null}
    </span>
  );
}
