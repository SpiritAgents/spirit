import { openExtensionDetails } from "@/lib/extension-navigation";
import { ChevronDown } from "@spiritagent/icons/chevron-down";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import { TEXT_LINK_POPOVER_CLASS } from "@spiritagent/ui/link";

import { ExtensionTabIcon } from "@/components/extension-tab-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DESKTOP_GHOST_MENU_TRIGGER,
  DESKTOP_OVERLAY_LIST_CONTENT,
  DESKTOP_OVERLAY_LIST_FILTER_HEADER,
  DESKTOP_OVERLAY_LIST_FILTER_INPUT_GHOST,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  DESKTOP_OVERLAY_LIST_SCROLL_AREA,
  DESKTOP_OVERLAY_LIST_SHELL,
  DESKTOP_OVERLAY_SHORT_LIST_PADDING,
  DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH,
  DESKTOP_OVERLAY_LIST_SUB_TRIGGER,
  stopOverlayScrollPropagation,
} from "@/lib/desktop-chrome";
import {
  defaultDesktopTimeTrigger,
  formatDesktopAutomationTriggerLabel,
  type DesktopAutomationSchedule,
  type DesktopAutomationTrigger,
} from "@/lib/automation-trigger";
import { buildAutomationTriggerFormatLabels } from "@/lib/automation-trigger-i18n";
import type {
  DesktopAutomationSchedule as ApiDesktopAutomationSchedule,
  DesktopAutomationTriggerMenuItem,
  DesktopAutomationTriggerMenuPage,
  DesktopExtensionAutomationTrigger,
  InvokeExtensionActionRequest,
  ResolveAutomationTriggerMenuRequest,
  CancelAutomationTriggerMenuRequest,
  ValidateAutomationTriggerRequest,
} from "@/types";
import { AutomationTimeScheduleOptions } from "@/components/automation-schedule-menu";
import { DESKTOP_MENU_TRIGGER_TEXT_CLASS } from "@/lib/desktop-typography";
import { cn } from "@/lib/utils";

export type AutomationTriggerRuntime = {
  contributions: DesktopExtensionAutomationTrigger[];
  supportsExtensionTriggers: boolean;
  resolveMenu(
    request: ResolveAutomationTriggerMenuRequest,
  ): Promise<DesktopAutomationTriggerMenuPage>;
  cancelMenu(request: CancelAutomationTriggerMenuRequest): Promise<void>;
  validate(request: ValidateAutomationTriggerRequest): Promise<DesktopAutomationTrigger>;
  invokeExtensionAction?(request: InvokeExtensionActionRequest): Promise<unknown>;
};

type AutomationTriggerMenuProps = {
  trigger: DesktopAutomationTrigger;
  disabled?: boolean;

  onTriggerChange(trigger: DesktopAutomationTrigger): void;
  runtime: AutomationTriggerRuntime;
};

export function AutomationTriggerMenu({
  trigger,
  disabled,

  onTriggerChange,
  runtime,
}: AutomationTriggerMenuProps) {
  const { t } = useTranslation();

  const label = formatDesktopAutomationTriggerLabel(trigger, buildAutomationTriggerFormatLabels(t));
  const timeSchedule: ApiDesktopAutomationSchedule =
    trigger.kind === "time" ? trigger.schedule : { kind: "daily", hour: 20, minute: 0 };

  const setTimeSchedule = (schedule: DesktopAutomationSchedule) => {
    onTriggerChange({ kind: "time", schedule });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            DESKTOP_GHOST_MENU_TRIGGER,
            "text-muted-foreground",
            DESKTOP_MENU_TRIGGER_TEXT_CLASS,
          )}
        >
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown
            className="size-3 shrink-0 text-muted-foreground/80"
            aria-hidden
            strokeWidth={1.75}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn(DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH, "z-[120] p-0")}
      >
        <div className={DESKTOP_OVERLAY_SHORT_LIST_PADDING}>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={disabled} className="gap-2">
              <Clock className="size-3.5 shrink-0" aria-hidden strokeWidth={1.75} />
              {t("automations.trigger.time")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className={cn(DESKTOP_OVERLAY_SHORT_MENU_MIN_WIDTH, "z-[130] p-0")}
            >
              <div className={DESKTOP_OVERLAY_SHORT_LIST_PADDING}>
                <AutomationTimeScheduleOptions
                  schedule={timeSchedule}
                  disabled={disabled}
                  onScheduleChange={setTimeSchedule}
                />
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {runtime.supportsExtensionTriggers
            ? runtime.contributions.map((contribution) => (
                <ContributedTriggerItem
                  key={contribution.kind}
                  contribution={contribution}
                  disabled={disabled}
                  onTriggerChange={onTriggerChange}
                  runtime={runtime}
                />
              ))
            : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ContributedTriggerItem({
  contribution,
  icon,
  disabled,

  onTriggerChange,
  runtime,
  open,
  onOpenChange,
}: {
  contribution: DesktopExtensionAutomationTrigger;
  icon?: ReactNode;
  disabled?: boolean;

  onTriggerChange(trigger: DesktopAutomationTrigger): void;
  runtime: AutomationTriggerRuntime;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const authorization = contribution.authorization;
  const needsAuthorization = authorization && authorization.configured === false;
  const content = (
    <>
      <ContributedTriggerIcon contribution={contribution} icon={icon} />
      {contribution.name}
    </>
  );

  if (needsAuthorization) {
    return (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <span className="flex w-full min-w-0">
            <DropdownMenuItem disabled className="gap-2">
              {content}
            </DropdownMenuItem>
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <span>
            <Trans
              t={t}
              i18nKey="automations.trigger.authorizationRequired"
              values={{ name: contribution.name }}
              components={{
                authorize: (
                  <button
                    type="button"
                    className={TEXT_LINK_POPOVER_CLASS}
                    onClick={() => openExtensionDetails(contribution.extensionId)}
                  />
                ),
              }}
            />
          </span>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (contribution.configuration !== "menu") {
    return (
      <DropdownMenuItem
        disabled={disabled}
        className="gap-2"
        onSelect={() => {
          void runtime.validate({ kind: contribution.kind, config: {} }).then(onTriggerChange);
        }}
      >
        {content}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuSub open={open} onOpenChange={onOpenChange}>
      <DropdownMenuSubTrigger disabled={disabled} className="gap-2">
        {content}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className={cn(DESKTOP_OVERLAY_LIST_CONTENT, DESKTOP_OVERLAY_LIST_SHELL, "z-[130] w-72")}
      >
        <AutomationTriggerMenuPage
          contribution={contribution}
          path={[]}
          disabled={disabled}
          onTriggerChange={onTriggerChange}
          runtime={runtime}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ContributedTriggerIcon({
  contribution,
  icon,
}: {
  contribution: DesktopExtensionAutomationTrigger;
  icon?: ReactNode;
}) {
  return (
    icon ?? (
      <ExtensionTabIcon
        extensionId={contribution.extensionId}
        icon={contribution.icon}
        className="size-3.5"
      />
    )
  );
}

function AutomationTriggerMenuPage({
  contribution,
  path,
  disabled,
  onTriggerChange,
  runtime,
}: {
  contribution: DesktopExtensionAutomationTrigger;
  path: string[];
  disabled?: boolean;
  onTriggerChange(trigger: DesktopAutomationTrigger): void;
  runtime: AutomationTriggerRuntime;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [items, setItems] = useState<DesktopAutomationTriggerMenuItem[]>([]);
  const [pageInfo, setPageInfo] = useState<DesktopAutomationTriggerMenuPage>({ items: [] });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const generationRef = useRef(0);
  const nextPageRef = useRef(1);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pathKey = JSON.stringify(path);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), query.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = async (page: number, append: boolean) => {
    const generation = ++generationRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(false);
    try {
      const result = await runtime.resolveMenu({
        kind: contribution.kind,
        sessionId,
        path,
        query: debouncedQuery,
        page,
      });
      if (generation !== generationRef.current) return;
      setPageInfo(result);
      nextPageRef.current = page + 1;
      setItems((current) => (append ? [...current, ...result.items] : result.items));
    } catch {
      if (generation === generationRef.current) setError(true);
    } finally {
      if (generation === generationRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    setItems([]);
    setPageInfo({ items: [] });
    nextPageRef.current = 1;
    void load(1, false);
    // load is intentionally scoped to the current path and debounced query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contribution.kind, pathKey, debouncedQuery]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      void runtime.cancelMenu({ sessionId });
    };
  }, [runtime.cancelMenu, sessionId]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !pageInfo.hasMore || loadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void load(nextPageRef.current, true);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [pageInfo.hasMore, loadingMore]);

  const searchPlaceholder = pageInfo.searchPlaceholder;

  return (
    <>
      {searchPlaceholder ? (
        <div className={DESKTOP_OVERLAY_LIST_FILTER_HEADER}>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className={DESKTOP_OVERLAY_LIST_FILTER_INPUT_GHOST}
            onKeyDown={(event) => event.stopPropagation()}
            autoComplete="off"
          />
        </div>
      ) : null}
      <ScrollArea
        type="always"
        className={DESKTOP_OVERLAY_LIST_SCROLL_AREA}
        onWheel={stopOverlayScrollPropagation}
        onTouchMove={stopOverlayScrollPropagation}
      >
        <div className={DESKTOP_OVERLAY_LIST_LIST_PADDING}>
          {loading ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t("common.loading")}</p>
          ) : error ? (
            <div className="flex items-center justify-between gap-2 px-2 py-3 text-xs">
              <span className="text-destructive">{t("automations.trigger.triggerLoadFailed")}</span>
              <button type="button" className="text-link" onClick={() => void load(1, false)}>
                {t("common.retry")}
              </button>
            </div>
          ) : items.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {t("automations.trigger.triggerEmpty")}
            </p>
          ) : (
            items.map((item) => (
              <AutomationTriggerMenuNode
                key={item.id}
                contribution={contribution}
                item={item}
                path={path}
                disabled={disabled}
                onTriggerChange={onTriggerChange}
                runtime={runtime}
              />
            ))
          )}
          {pageInfo.hasMore ? (
            <div ref={sentinelRef} className="px-2 py-2 text-xs text-muted-foreground">
              {loadingMore ? t("common.loading") : null}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </>
  );
}

function AutomationTriggerMenuNode({
  contribution,
  item,
  path,
  disabled,
  onTriggerChange,
  runtime,
}: {
  contribution: DesktopExtensionAutomationTrigger;
  item: DesktopAutomationTriggerMenuItem;
  path: string[];
  disabled?: boolean;
  onTriggerChange(trigger: DesktopAutomationTrigger): void;
  runtime: AutomationTriggerRuntime;
}) {
  const label = item.label;
  const content = (
    <>
      {item.icon ? (
        <ExtensionTabIcon
          extensionId={contribution.extensionId}
          icon={item.icon}
          className="size-3.5"
        />
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  if (item.action === "submenu") {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger
          disabled={disabled || item.disabled}
          className={DESKTOP_OVERLAY_LIST_SUB_TRIGGER}
        >
          {content}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="z-[140] p-0">
          <AutomationTriggerMenuPage
            contribution={contribution}
            path={[...path, item.id]}
            disabled={disabled}
            onTriggerChange={onTriggerChange}
            runtime={runtime}
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }
  return (
    <DropdownMenuItem
      disabled={disabled || item.disabled}
      className="text-xs"
      title={item.description}
      onSelect={() => {
        void runtime
          .validate({ kind: contribution.kind, config: item.config })
          .then(onTriggerChange);
      }}
    >
      {content}
    </DropdownMenuItem>
  );
}

export { defaultDesktopTimeTrigger };
