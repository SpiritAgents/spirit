import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function AnimatedCount({
  value,
  text = String(value),
  className,
}: {
  value: number;
  text?: string;
  className?: string;
}) {
  const previousRef = useRef({ value, text });
  const [direction, setDirection] = useState<"up" | "down" | "none">("none");
  const [columns, setColumns] = useState(() =>
    Array.from(text, (char) => ({ char, changed: false })),
  );
  useLayoutEffect(() => {
    const previous = previousRef.current;
    if (text === previous.text) return;
    const previousChars = Array.from(previous.text);
    const nextChars = Array.from(text);
    const offset = nextChars.length - previousChars.length;
    setDirection(value > previous.value ? "up" : value < previous.value ? "down" : "none");
    setColumns(
      nextChars.map((char, index) => ({
        char,
        changed: char !== previousChars[index - offset],
      })),
    );
    previousRef.current = { value, text };
  }, [value, text]);
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
