import type { LucideIcon } from "lucide-react";
import { cn } from "../cn.js";
export function TimelineNode({
  icon: Icon,
  className,
  iconClassName,
  size = "default",
}: {
  icon: LucideIcon;
  className?: string;
  iconClassName?: string;
  /** `compact` fits single-line `text-xs` rows (e.g. local git history). */
  size?: "default" | "compact";
}) {
  return (
    <div
      className={cn(
        "relative z-10 flex shrink-0 items-center justify-center rounded-full border border-border/40 bg-background",
        size === "compact" ? "size-3.5" : "size-5",
        className,
      )}
      aria-hidden
    >
      <Icon
        className={cn(
          size === "compact" ? "size-2" : "size-2.5",
          iconClassName ?? "text-muted-foreground",
        )}
        strokeWidth={1.75}
      />
    </div>
  );
}
