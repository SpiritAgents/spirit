import { Check } from "@spiritagent/icons/check";
import { ChevronDown } from "@spiritagent/icons/chevron-down";
import { LoaderCircle } from "@spiritagent/icons/loader-circle";
import { useEffect, useMemo, useState } from "react";
import { Circle } from "lucide-react";

import type { ConversationTodoSnapshot } from "@/types";
import {
  DESKTOP_ELEVATION_SHADOW_SM,
  desktopComposerSurfaceBackdropClass,
} from "@/lib/desktop-translucency-surface";
import { cn } from "@/lib/utils";

type ComposerTodoCardProps = {
  todos: ConversationTodoSnapshot;
  sessionKey: string;
  useTranslucency?: boolean;
};

function storageKey(sessionKey: string): string {
  return `spirit-todo-expanded:${sessionKey}`;
}

export function ComposerTodoCard({
  todos,
  sessionKey,
  useTranslucency = false,
}: ComposerTodoCardProps) {
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    const stored = window.localStorage.getItem(storageKey(sessionKey));
    if (stored === "0") {
      return false;
    }
    if (stored === "1") {
      return true;
    }
    return todos.items.length > 1;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(storageKey(sessionKey));
    if (stored === "0") {
      setExpanded(false);
    } else if (stored === "1") {
      setExpanded(true);
    } else {
      setExpanded(todos.items.length > 1);
    }
  }, [sessionKey, todos.items.length]);

  const firstActiveIndex = useMemo(
    () =>
      todos.items.findIndex((item) => item.status === "in_progress" || item.status === "pending"),
    [todos.items],
  );

  const completedCount = todos.items.filter((item) => item.status === "completed").length;
  const hasInProgress = todos.items.some((item) => item.status === "in_progress");

  const toggleExpanded = () => {
    setExpanded((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey(sessionKey), next ? "1" : "0");
      }
      return next;
    });
  };

  if (todos.items.length === 0) {
    return null;
  }

  const summaryTitle = todos.items[firstActiveIndex >= 0 ? firstActiveIndex : 0]?.title ?? "";

  return (
    <div
      data-spirit-surface="composer-todo-card"
      className={cn(
        "overflow-hidden rounded-t-2xl rounded-b-none border border-ring/30 transition-[max-height] duration-300 ease-out dark:border-white/12",
        DESKTOP_ELEVATION_SHADOW_SM,
        desktopComposerSurfaceBackdropClass(useTranslucency),
      )}
    >
      <button
        type="button"
        onClick={toggleExpanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-canvas-hover"
        aria-expanded={expanded}
      >
        <StatusIcon
          status={
            hasInProgress
              ? "in-progress"
              : todos.items.every((item) => item.status === "completed")
                ? "completed"
                : "pending"
          }
        />
        <span className="min-w-0 flex-1 truncate font-normal">{summaryTitle}</span>
        {!expanded && todos.items.length > 1 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {completedCount}/{todos.items.length}
          </span>
        ) : null}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-300",
            expanded ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <ul className="space-y-0.5 px-3 pb-2.5 pt-0">
            {todos.items.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm leading-snug">
                <StatusIcon
                  status={
                    item.status === "completed"
                      ? "completed"
                      : item.status === "in_progress"
                        ? "in-progress"
                        : "pending"
                  }
                />
                <span
                  className={cn(
                    "min-w-0 flex-1",
                    item.status === "completed" && "text-muted-foreground line-through",
                  )}
                >
                  {item.title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: "pending" | "in-progress" | "completed" }) {
  if (status === "completed") {
    return <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.5} />;
  }
  if (status === "in-progress") {
    return <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-foreground/80" />;
  }
  return <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/55" strokeWidth={1.5} />;
}
