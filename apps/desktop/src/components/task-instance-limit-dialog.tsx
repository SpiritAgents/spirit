import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DESKTOP_OVERLAY_LIST_ITEM_SELECTED } from "@/lib/desktop-chrome";
import { formatCiDuration } from "@/lib/format-ci-duration";
import {
  getTaskInstanceLimitPrompt,
  resolveTaskInstanceLimitPrompt,
  subscribeTaskInstanceLimitPrompt,
  type TaskInstanceLimitChoice,
  type TaskInstanceLimitPromptInstance,
} from "@/lib/task-run-service";
import { useElapsedDuration } from "@/lib/use-elapsed-duration";
import { cn } from "@/lib/utils";

/** Bridges the coordinator's synchronous instance-limit prompt into React state. */
export function TaskInstanceLimitDialog() {
  const [prompt, setPrompt] = useState(() => getTaskInstanceLimitPrompt());

  useEffect(
    () =>
      subscribeTaskInstanceLimitPrompt(() => {
        setPrompt(getTaskInstanceLimitPrompt());
      }),
    [],
  );

  const choose = (choice: TaskInstanceLimitChoice): void => {
    resolveTaskInstanceLimitPrompt(choice);
  };

  return (
    <Dialog
      open={prompt !== undefined}
      onOpenChange={(open) => {
        if (!open) {
          choose({ kind: "cancel" });
        }
      }}
    >
      <DialogContent>
        <TaskInstanceLimitDialogBody
          label={prompt?.task.label ?? ""}
          instances={prompt?.activeInstances ?? []}
          onChoose={choose}
        />
      </DialogContent>
    </Dialog>
  );
}

function TaskInstanceLimitDialogBody({
  label,
  instances,
  onChoose,
}: {
  label: string;
  instances: TaskInstanceLimitPromptInstance[];
  onChoose: (choice: TaskInstanceLimitChoice) => void;
}) {
  const { t } = useTranslation();
  // The first instance is always preselected: it reads as a list, and Replace is
  // immediately actionable.
  const [selected, setSelected] = useState<string | null>(() => instances[0]?.instanceKey ?? null);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("task.instanceLimitTitle", { label })}</DialogTitle>
        <DialogDescription>{t("task.instanceLimitDescription")}</DialogDescription>
      </DialogHeader>
      <div
        role="radiogroup"
        aria-label={t("task.instanceLimitTitle", { label })}
        className="max-h-48 overflow-y-auto rounded-lg border border-outline-border"
      >
        {instances.map((entry) => (
          <TaskInstanceLimitRow
            key={entry.instanceKey}
            entry={entry}
            selected={selected === entry.instanceKey}
            onSelect={() => {
              setSelected(entry.instanceKey);
            }}
          />
        ))}
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onChoose({ kind: "cancel" });
          }}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={selected === null}
          onClick={() => {
            if (selected !== null) {
              onChoose({ kind: "replace", instanceKey: selected });
            }
          }}
        >
          {t("task.instanceLimitReplace")}
        </Button>
      </DialogFooter>
    </>
  );
}

function TaskInstanceLimitRow({
  entry,
  selected,
  onSelect,
}: {
  entry: TaskInstanceLimitPromptInstance;
  selected: boolean;
  onSelect: () => void;
}) {
  const elapsedMs = useElapsedDuration(entry.startedAt, true);
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      className={cn(
        "flex min-w-0 cursor-pointer items-center gap-2 px-3 py-3 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60",
        // Same wash as the selected fill, so hovering a selected row changes nothing.
        "hover:bg-overlay-hover hover:text-accent-foreground",
        selected && DESKTOP_OVERLAY_LIST_ITEM_SELECTED,
      )}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="min-w-0 flex-1 truncate text-xs font-normal text-foreground/80">
        #{entry.instance}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/75 dark:text-muted-foreground/65">
        {formatCiDuration(Math.floor(elapsedMs / 1000))}
      </span>
    </div>
  );
}
