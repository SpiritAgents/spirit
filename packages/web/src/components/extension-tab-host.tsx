import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { extensionTabPageUrl } from "@/lib/extension-tab-frame";
import { cn } from "@/lib/utils";
import type { DesktopExtensionDesktopTab, WorkspaceExtensionToolTab } from "@/types";

export function ExtensionTabHost({
  tab,
  contribution,
  active,
}: {
  tab: WorkspaceExtensionToolTab;
  contribution: DesktopExtensionDesktopTab;
  active: boolean;
}) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (status !== "loading") {
      return;
    }
    const timeout = window.setTimeout(() => setStatus("error"), 10_000);
    return () => window.clearTimeout(timeout);
  }, [attempt, status, tab.instanceId]);

  useEffect(() => {
    setStatus("loading");
  }, [attempt, tab.instanceId]);

  return (
    <div
      className="relative min-h-0 min-w-0 flex-1"
      data-extension-tab-instance={tab.instanceId}
      data-extension-tab-state={status}
    >
      {status === "error" ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center text-sm">
          <p className="text-muted-foreground">
            {t("workspace.extensionTabLoadError", { name: contribution.name })}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      <iframe
        key={attempt}
        title={tab.tabTitle ?? contribution.name}
        sandbox="allow-scripts"
        src={extensionTabPageUrl(tab)}
        className={cn("size-full border-0 bg-background", status === "error" && "invisible")}
        data-extension-tab-active={active}
        onLoad={() => setStatus("ready")}
        onError={() => setStatus("error")}
      />
    </div>
  );
}
