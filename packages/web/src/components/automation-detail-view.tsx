import { ChevronRight } from "@spiritagent/icons/chevron-right";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AutomationHistoryTable } from "@/components/automation-history-table";
import { AutomationSettingsPanel } from "@/components/automation-settings-panel";
import type { AutomationTriggerRuntime } from "@/components/automation-trigger-menu";
import type {
  DesktopAutomationDetail,
  DesktopSnapshot,
  DesktopUpdateAutomationRequest,
} from "@/types";
import { FONT_WEIGHT_MEDIUM } from "@/lib/desktop-typography";
import {
  CONVERSATION_GUTTER_X,
  CONVERSATION_MESSAGE_LIST_MAX_W,
} from "@/lib/conversation-layout-constants";
import { cn } from "@/lib/utils";
import { RovingFocusGroup, RovingFocusItem } from "@/components/ui/roving-focus-group";

type AutomationDetailViewProps = {
  automationId: string;
  snapshot: DesktopSnapshot | null;
  onBack(): void;
  onOpenSession(sessionPath: string): void;
  getAutomation(automationId: string): Promise<DesktopAutomationDetail | undefined>;
  updateAutomation(
    automationId: string,
    patch: DesktopUpdateAutomationRequest,
  ): void | Promise<void>;
  onAddWorkspace?(): void | Promise<void>;
  settingsDisabled?: boolean;

  triggerRuntime: AutomationTriggerRuntime;
};

type AutomationDetailTab = "history" | "settings";

const AUTOMATION_DETAIL_TABS: ReadonlyArray<{
  id: AutomationDetailTab;
  labelKey: "automations.tabHistory" | "automations.tabSettings";
}> = [
  { id: "history", labelKey: "automations.tabHistory" },
  { id: "settings", labelKey: "automations.tabSettings" },
];

function AutomationDetailTabs({
  activeTab,
  onTabChange,
  children,
}: {
  activeTab: AutomationDetailTab;
  onTabChange(tab: AutomationDetailTab): void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-y-4">
      <RovingFocusGroup asChild orientation="horizontal" loop defaultCurrentTabStopId={activeTab}>
        <div
          className="flex flex-wrap gap-1 pt-0.5"
          role="tablist"
          aria-label={t("automations.detailTabsAria")}
        >
          {AUTOMATION_DETAIL_TABS.map(({ id, labelKey }) => (
            <RovingFocusItem asChild key={id} tabStopId={id} active={activeTab === id}>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={cn(
                  "rounded-md px-3 py-2 text-sm",
                  activeTab === id
                    ? "font-normal text-foreground underline decoration-foreground/80 underline-offset-[10px]"
                    : "text-muted-foreground hover:bg-canvas-hover hover:text-chrome-emphasis",
                )}
                onClick={() => onTabChange(id)}
              >
                {t(labelKey)}
              </button>
            </RovingFocusItem>
          ))}
        </div>
      </RovingFocusGroup>
      {children}
    </div>
  );
}

export function AutomationDetailView({
  automationId,
  snapshot,
  onBack,
  onOpenSession,
  getAutomation,
  updateAutomation,
  onAddWorkspace,
  settingsDisabled,

  triggerRuntime,
}: AutomationDetailViewProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<AutomationDetailTab>("history");
  const [detail, setDetail] = useState<DesktopAutomationDetail | undefined>();
  const [loading, setLoading] = useState(true);
  const showInitialLoadingRef = useRef(true);
  const initialLoadingAutomationIdRef = useRef(automationId);
  const [previousAutomationId, setPreviousAutomationId] = useState(automationId);
  if (previousAutomationId !== automationId) {
    setPreviousAutomationId(automationId);
    setActiveTab("history");
  }
  useLayoutEffect(() => {
    if (initialLoadingAutomationIdRef.current !== automationId) {
      initialLoadingAutomationIdRef.current = automationId;
      showInitialLoadingRef.current = true;
    }
  }, [automationId]);

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      if (!silent) {
        setLoading(true);
      }
      try {
        const next = await getAutomation(automationId);
        setDetail(next);
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [automationId, getAutomation],
  );

  useEffect(() => {
    const hasListDefinition =
      snapshot?.automationsList.some((item) => item.id === automationId) === true;
    void refresh({ silent: !showInitialLoadingRef.current && hasListDefinition }).finally(() => {
      showInitialLoadingRef.current = false;
    });
  }, [automationId, refresh, snapshot?.automationsList]);

  const definition = detail?.definition;
  const listFallback = snapshot?.automationsList.find((item) => item.id === automationId);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Shares the conversation message list's max width and gutter: full width up to
          the cap, then proportional side margins on narrower windows. */}
      <div
        className={cn(
          "relative mx-auto flex w-full min-h-0 flex-1 flex-col py-8",
          CONVERSATION_GUTTER_X,
          CONVERSATION_MESSAGE_LIST_MAX_W,
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-y-4">
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <button
              type="button"
              onClick={onBack}
              className="font-normal text-muted-foreground transition-colors hover:text-chrome-emphasis"
            >
              {t("automations.detailBack")}
            </button>
            <ChevronRight
              className="size-3.5 text-muted-foreground/70"
              aria-hidden
              strokeWidth={1.75}
            />
            <span className={cn(FONT_WEIGHT_MEDIUM, "text-foreground")}>
              {definition?.title ?? listFallback?.title ?? automationId}
            </span>
          </nav>

          <AutomationDetailTabs activeTab={activeTab} onTabChange={setActiveTab}>
            {activeTab === "history" ? (
              <div className={cn("flex min-h-0 flex-1", loading && "opacity-70")}>
                <AutomationHistoryTable runs={detail?.runs ?? []} onOpenSession={onOpenSession} />
              </div>
            ) : null}
            {activeTab === "settings" ? (
              <AutomationSettingsPanel
                automationId={automationId}
                definition={definition}
                snapshot={snapshot}
                disabled={settingsDisabled}

                onAddWorkspace={onAddWorkspace}
                triggerRuntime={triggerRuntime}
                onSave={async (patch) => {
                  await updateAutomation(automationId, patch);
                  await refresh({ silent: true });
                }}
              />
            ) : null}
          </AutomationDetailTabs>
        </div>
      </div>
    </div>
  );
}
