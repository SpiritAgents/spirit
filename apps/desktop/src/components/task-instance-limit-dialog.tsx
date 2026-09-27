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
import {
  getTaskInstanceLimitPrompt,
  resolveTaskInstanceLimitPrompt,
  subscribeTaskInstanceLimitPrompt,
  type TaskInstanceLimitChoice,
  type TaskInstanceLimitPrompt,
} from "@/lib/task-run-service";

/** Bridges the coordinator's synchronous instance-limit prompt into React state. */
export function TaskInstanceLimitDialog() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState<TaskInstanceLimitPrompt | undefined>(() =>
    getTaskInstanceLimitPrompt(),
  );

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
          choose("cancel");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("task.instanceLimitTitle")}</DialogTitle>
          <DialogDescription>
            {t("task.instanceLimitDescription", { label: prompt?.task.label ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              choose("cancel");
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              choose("replace");
            }}
          >
            {t("task.instanceLimitReplace")}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => {
              choose("new");
            }}
          >
            {t("task.instanceLimitNew")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
