import { ChevronDown } from "@spiritagent/icons/chevron-down";
import { LoaderCircle } from "@spiritagent/icons/loader-circle";
import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { GitMerge, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DESKTOP_GIT_ACTION_BTN,
  DESKTOP_GIT_ACTION_MENU_TRIGGER,
  DESKTOP_GIT_ACTION_SPLIT,
  DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
  DESKTOP_OVERLAY_LIST_ITEM,
  DESKTOP_OVERLAY_LIST_LIST_GAP,
  DESKTOP_OVERLAY_LIST_LIST_PADDING,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { buildGitChangesMenuItemIds } from "@/lib/git-changes-menu-items";
import { cn } from "@/lib/utils";
import type { GitChipAction, SubmitGitChipRequest } from "@/types";

export type GitChangesMenuLabels = {
  push: string;
  merge: string;
  merged: string;
};

type GitChangesMenuItem = {
  id: string;
  icon: ReactNode;
  label: string;
  onSelect(): void;
};

export function buildGitChangesMenuItems(input: {
  needsPush: boolean;
  canMerge: boolean;
  mergeFlashMerged?: boolean;
  labels: GitChangesMenuLabels;
  onPush: () => void;
  onMerge: () => void;
}): GitChangesMenuItem[] {
  return buildGitChangesMenuItemIds({
    needsPush: input.needsPush,
    canMerge: input.canMerge,
  }).map((id) => {
    if (id === "push") {
      return {
        id,
        icon: <Upload className="size-3 shrink-0 opacity-80" aria-hidden />,
        label: input.labels.push,
        onSelect: input.onPush,
      };
    }
    return {
      id,
      icon: <GitMerge className="size-3 shrink-0 opacity-80" aria-hidden />,
      label: input.mergeFlashMerged ? input.labels.merged : input.labels.merge,
      onSelect: input.onMerge,
    };
  });
}

export type GitChangesActionsProps = {
  isRepository: boolean;
  hasChanges: boolean;
  needsPush: boolean;
  canMerge: boolean;
  gitBusy: boolean;
  mergeFlashMerged?: boolean;
  pushDisabledTitle?: string;
  onGitChip(request: SubmitGitChipRequest): Promise<boolean>;
};

export function GitChangesActions({
  isRepository,
  hasChanges,
  needsPush,
  canMerge,
  gitBusy,
  mergeFlashMerged = false,
  pushDisabledTitle,
  onGitChip,
}: GitChangesActionsProps) {
  const { t } = useTranslation();

  const menuLabels = useMemo<GitChangesMenuLabels>(
    () => ({
      push: t("workspace.git.push"),
      merge: t("app.merge"),
      merged: t("app.merged"),
    }),
    [t],
  );

  const runGitChip = useCallback(
    (action: GitChipAction) => {
      void onGitChip({ action });
    },
    [onGitChip],
  );

  const menuItems = useMemo(
    () =>
      buildGitChangesMenuItems({
        needsPush,
        canMerge,
        mergeFlashMerged,
        labels: menuLabels,
        onPush: () => runGitChip("push"),
        onMerge: () => runGitChip("merge"),
      }),
    [canMerge, mergeFlashMerged, menuLabels, needsPush, runGitChip],
  );

  if (!isRepository) {
    return null;
  }

  const busyIcon = gitBusy ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : null;

  if (!hasChanges) {
    return (
      <ButtonGroup>
        <Button
          type="button"
          variant="default"
          size="xs"
          className={cn(DESKTOP_GIT_ACTION_BTN, instantHoverMotionClass)}
          disabled={!needsPush || gitBusy}
          title={!needsPush ? pushDisabledTitle : undefined}
          onClick={() => runGitChip("push")}
        >
          {busyIcon}
          <span>{t("workspace.git.push")}</span>
        </Button>
      </ButtonGroup>
    );
  }

  return (
    <ButtonGroup>
      <Button
        type="button"
        variant="default"
        size="xs"
        className={cn(DESKTOP_GIT_ACTION_BTN, instantHoverMotionClass)}
        disabled={gitBusy}
        onClick={() => runGitChip("commit")}
      >
        {busyIcon}
        <span>{t("app.commit")}</span>
      </Button>
      {menuItems.length > 0 ? (
        <>
          <ButtonGroupSeparator className={DESKTOP_GIT_ACTION_SPLIT} />
          <DropdownMenu modal>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="default"
                size="xs"
                aria-label={t("workspace.git.moreActions")}
                title={t("workspace.git.moreActions")}
                disabled={gitBusy}
                className={cn(DESKTOP_GIT_ACTION_MENU_TRIGGER, instantHoverMotionClass)}
              >
                <ChevronDown className="size-3" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              sideOffset={10}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
              }}
              className={cn(
                "flex w-max min-w-[11rem] max-w-[min(15rem,calc(100vw-1.25rem))] flex-col",
                DESKTOP_OVERLAY_LIST_DROPDOWN_SURFACE,
                DESKTOP_OVERLAY_LIST_LIST_PADDING,
                DESKTOP_OVERLAY_LIST_LIST_GAP,
              )}
            >
              {menuItems.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  className={cn(
                    "flex w-full cursor-pointer select-none items-center gap-2 rounded-sm text-left outline-none",
                    DESKTOP_OVERLAY_LIST_ITEM,
                    "text-popover-foreground",
                  )}
                  onSelect={() => {
                    item.onSelect();
                  }}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </ButtonGroup>
  );
}
