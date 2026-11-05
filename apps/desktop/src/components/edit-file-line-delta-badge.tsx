import { AnimatedCount } from "./animated-count";
import { cn } from "@/lib/utils";
import type { EditFileLineDelta } from "@/lib/edit-file-line-delta";

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
