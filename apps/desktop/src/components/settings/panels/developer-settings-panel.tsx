import { useTranslation } from "react-i18next";

import type { SettingsViewProps } from "@/components/settings/types";
import { Button } from "@/components/ui/button";
import { DESKTOP_CANVAS_CARD_SURFACE } from "@/lib/desktop-chrome";
import { LONG_CONVERSATION_LIST_DEMO_TURN_COUNT } from "@/lib/long-conversation-list-demo";
import { DESKTOP_LIST_ITEM_PRIMARY_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

export function DeveloperSettingsPanel({
  onStartCompactionUiDemo,
  onStartLongConversationListDemo,
}: Pick<SettingsViewProps, "onStartCompactionUiDemo" | "onStartLongConversationListDemo">) {
  const { t } = useTranslation();
  return (
    <div className={cn(DESKTOP_CANVAS_CARD_SURFACE, "divide-y divide-border/35 px-4 sm:px-5")}>
      <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}>{t("settings.compactionDemoTitle")}</p>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.compactionDemoDescription")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 self-start sm:self-center"
          disabled={!onStartCompactionUiDemo}
          onClick={() => onStartCompactionUiDemo?.()}
        >
          {t("settings.demoInConversation")}
        </Button>
      </div>
      <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className={DESKTOP_LIST_ITEM_PRIMARY_CLASS}>
            {t("settings.longConversationListDemoTitle")}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.longConversationListDemoDescription", {
              turnCount: LONG_CONVERSATION_LIST_DEMO_TURN_COUNT,
            })}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 self-start sm:self-center"
          disabled={!onStartLongConversationListDemo}
          onClick={() => onStartLongConversationListDemo?.()}
        >
          {t("settings.demoInConversation")}
        </Button>
      </div>
    </div>
  );
}
