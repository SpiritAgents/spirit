import {
  useMemo,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { ArrowUp, LoaderCircle, Square } from "lucide-react";

import {
  ComposerAbortShortcutKbd,
  ComposerSendEnterKbd,
} from "@/components/composer/composer-shortcut-kbds";
import {
  ComposerLocalFileStrip,
  type ComposerLocalFileAttachmentView,
} from "@/components/composer-local-file-strip";
import { ComposerInsertMenu } from "@/components/composer-insert-menu";
import {
  ComposerRichInput,
  type ComposerRichInputHandle,
  type RichSegment,
} from "@/components/composer-rich-input";
import { ModelPickerMenu } from "@/components/model-picker-menu";
import { Button } from "@/components/ui/button";
import type { SaveLocalImageAs } from "@/components/tool-call/tool-call-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import { modelRefsEqual } from "@spiritagent/host-internal/config-v2";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import {
  DESKTOP_COMPOSER_GHOST_HOVER,
  DESKTOP_ELEVATION_SHADOW_SM,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { desktopComposerSurfaceBackdropClass } from "@/lib/desktop-translucency-surface";
import { cn } from "@/lib/utils";
import { segmentsToPlainText } from "@/lib/composer-segment-model";
import type {
  DesktopModelReasoningEffort,
  DesktopModelReasoningMode,
  DesktopSnapshot,
  ModelRef,
} from "@/types";

function isComposerChromeInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="combobox"], [role="menuitem"], [role="option"], [data-composer-chrome-static]',
    ),
  );
}

export type ComposerSurfaceProps = {
  segments: readonly RichSegment[];
  onSegmentsChange(segments: RichSegment[]): void;
  localFileAttachments: readonly ComposerLocalFileAttachmentView[];
  placeholder: string;
  agentModeChipPlaceholder?: string;
  models: DesktopSnapshot["config"]["models"];
  catalogHints?: DesktopSnapshot["config"]["modelCatalogHints"];
  providerGroups?: DesktopSnapshot["config"]["providerGroups"];
  activeModel: ModelRef;
  agentMode: DesktopAgentMode;
  loopEnabled: boolean;
  canSend: boolean;
  hasComposerPayload?: boolean;
  canAbort?: boolean;
  busy: boolean;
  readOnly?: boolean;
  onSubmit(): void;
  onAbort?(): void;
  onModelSelect(ref: ModelRef): void;
  onModelReasoningEffortSelect(ref: ModelRef, reasoningEffort: DesktopModelReasoningEffort): void;
  onModelReasoningModeSelect?(ref: ModelRef, reasoningMode: DesktopModelReasoningMode): void;
  onModelThinkingEnabledSelect?(ref: ModelRef, enabled: boolean): void | Promise<boolean>;
  onAgentModeChange(mode: DesktopAgentMode): void;
  onLoopEnabledChange?(enabled: boolean): void;
  richInputRef?: RefObject<ComposerRichInputHandle | null>;
  onKeyDown?(event: ReactKeyboardEvent<HTMLTextAreaElement>): void;
  onSelectionChange?(selectionStart: number | null): void;
  showInsertButton?: boolean;
  canPickLocalFile?: boolean;
  onInsertWorkspaceFileReferenceTrigger?(): void;
  onPickLocalFile?(): void | Promise<void>;
  onInsertSkillTrigger?(): void;
  onRemoveLocalFileAttachment?(path: string): void;
  onPaste?(event: ReactClipboardEvent<HTMLTextAreaElement>): void;
  onDragOver?(event: ReactDragEvent<HTMLElement>): void;
  onDrop?(event: ReactDragEvent<HTMLElement>): void;
  browserElementAttachments?: readonly BrowserElementAttachment[];
  onElementAttachmentsChange?(attachments: BrowserElementAttachment[]): void;
  agentModeChipDismissed?: boolean;
  onAgentModeChipDismissChange?(dismissed: boolean): void;
  saveLocalImageAs?: SaveLocalImageAs;
  /** With translucency enabled, the input box uses a solid background to avoid scrolling messages showing through the CSS blur */
  useTranslucency?: boolean;
};

export function ComposerSurface({
  segments,
  onSegmentsChange,
  localFileAttachments,
  placeholder,
  agentModeChipPlaceholder,
  models,
  catalogHints,
  providerGroups,
  activeModel,
  agentMode,
  loopEnabled = false,
  canSend,
  hasComposerPayload,
  canAbort = false,
  busy,
  readOnly = false,
  onSubmit,
  onAbort,
  onModelSelect,
  onModelReasoningEffortSelect,
  onModelReasoningModeSelect,
  onModelThinkingEnabledSelect,
  onAgentModeChange,
  onLoopEnabledChange,
  richInputRef,
  onKeyDown,
  onSelectionChange,
  showInsertButton = false,
  canPickLocalFile = false,
  onInsertWorkspaceFileReferenceTrigger,
  onPickLocalFile,
  onInsertSkillTrigger,
  onRemoveLocalFileAttachment,
  onPaste,
  onDragOver,
  onDrop,
  browserElementAttachments,
  onElementAttachmentsChange,
  agentModeChipDismissed = false,
  onAgentModeChipDismissChange,
  saveLocalImageAs,
  useTranslucency = false,
}: ComposerSurfaceProps) {
  const { t } = useTranslation();
  const [fileDragOver, setFileDragOver] = useState(false);
  const activeModelProfile = useMemo(
    () =>
      models.find((model) =>
        modelRefsEqual(
          model.ref ?? { groupId: model.groupId ?? "", name: model.name },
          activeModel,
        ),
      ),
    [activeModel, models],
  );

  const focusRichInput = () => {
    if (!readOnly) {
      richInputRef?.current?.focus();
    }
  };

  const handleComposerChromeMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (readOnly || isComposerChromeInteractiveTarget(event.target)) {
      return;
    }
    event.preventDefault();
    focusRichInput();
  };

  const handleSurfaceDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    onDragOver?.(event);
    if (event.defaultPrevented) {
      setFileDragOver(true);
    }
  };

  const handleSurfaceDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) {
      return;
    }
    setFileDragOver(false);
  };

  const handleSurfaceDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    setFileDragOver(false);
    onDrop?.(event);
  };

  return (
    <div
      data-spirit-surface="composer-surface"
      className={cn(
        "relative overflow-hidden rounded-2xl border border-ring/30 focus-within:ring-0 hover:border-ring/40 focus-within:border-ring/40 dark:border-white/10 dark:hover:border-white/12 dark:focus-within:border-white/12",
        DESKTOP_ELEVATION_SHADOW_SM,
        fileDragOver && "border-ring/40 dark:border-white/12",
        desktopComposerSurfaceBackdropClass(useTranslucency),
      )}
      onDragOver={handleSurfaceDragOver}
      onDragLeave={handleSurfaceDragLeave}
      onDrop={handleSurfaceDrop}
    >
      {localFileAttachments.length > 0 ? (
        <div className="cursor-text" onMouseDown={handleComposerChromeMouseDown}>
          <ComposerLocalFileStrip
            attachments={localFileAttachments}
            onRemove={(path) => onRemoveLocalFileAttachment?.(path)}
            saveLocalImageAs={saveLocalImageAs}
          />
        </div>
      ) : null}
      <ComposerRichInput
        ref={richInputRef}
        segments={segments}
        onSegmentsChange={onSegmentsChange}
        elementAttachments={browserElementAttachments}
        placeholder={placeholder}
        agentModeChipPlaceholder={agentModeChipPlaceholder}
        readOnly={readOnly}
        loopEnabled={loopEnabled}
        loopChipLabel={t("composer.loopChipLabel")}
        agentMode={agentMode}
        planChipLabel={t("composer.planChipLabel")}
        askChipLabel={t("composer.askChipLabel")}
        onElementAttachmentsChange={(atts) => onElementAttachmentsChange?.(atts)}
        onLoopEnabledChange={onLoopEnabledChange}
        onAgentModeChange={onAgentModeChange}
        agentModeChipDismissed={agentModeChipDismissed}
        onAgentModeChipDismissChange={onAgentModeChipDismissChange}
        onPaste={(e) => onPaste?.(e as unknown as ReactClipboardEvent<HTMLTextAreaElement>)}
        onKeyDown={(e) => {
          onKeyDown?.(e as unknown as ReactKeyboardEvent<HTMLTextAreaElement>);
          const plainEnter =
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.nativeEvent.isComposing;
          // When a slash/file suggestion already preventDefault'ed, submission must not proceed
          if (plainEnter) {
            if (e.defaultPrevented) {
              return;
            }
            e.preventDefault();
            if (canSend) onSubmit();
            return;
          }
          if (e.defaultPrevented) return;
        }}
        onSelectionChange={onSelectionChange}
      />
      <div className="cursor-text px-3 pt-0.5 pb-2" onMouseDown={handleComposerChromeMouseDown}>
        <div className="flex w-full max-w-full items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {showInsertButton ? (
              <div className="shrink-0">
                <ComposerInsertMenu
                  disabled={readOnly}
                  canPickLocalFile={canPickLocalFile}
                  onInsertWorkspaceReference={() => onInsertWorkspaceFileReferenceTrigger?.()}
                  onPickLocalFile={() => onPickLocalFile?.()}
                  onInsertSkillTrigger={() => onInsertSkillTrigger?.()}
                />
              </div>
            ) : null}
            <ModelPickerMenu
              models={models}
              catalogHints={catalogHints}
              providerGroups={providerGroups}
              activeModelRef={activeModel}
              activeReasoningEffort={activeModelProfile?.reasoningEffort}
              disabled={readOnly}
              onModelSelect={onModelSelect}
              onModelReasoningEffortSelect={onModelReasoningEffortSelect}
              onModelReasoningModeSelect={onModelReasoningModeSelect}
              onModelThinkingEnabledSelect={onModelThinkingEnabledSelect}
              triggerClassName={cn("max-w-[min(12rem,100%)]", DESKTOP_COMPOSER_GHOST_HOVER)}
              menuContentClassName="z-[100]"
            />
          </div>
          {(() => {
            const resolvedHasComposerPayload =
              hasComposerPayload ??
              (segmentsToPlainText([...segments]).trim().length > 0 ||
                localFileAttachments.length > 0);
            const showAbortButton = canAbort && Boolean(onAbort) && !resolvedHasComposerPayload;
            const showEnqueueWhileBusy = canAbort && resolvedHasComposerPayload;
            const sendDisabled = showAbortButton ? false : !canSend || (busy && !canAbort);
            const actionAriaLabel = showAbortButton
              ? t("app.abort")
              : showEnqueueWhileBusy
                ? t("composer.enqueueWhileBusy")
                : t("app.send");
            const actionButton = (
              <Button
                type="button"
                className={cn(
                  "size-7 shrink-0 rounded-full p-0 shadow-none [&_svg]:size-3",
                  instantHoverMotionClass,
                  sendDisabled && "disabled:pointer-events-auto disabled:cursor-default",
                )}
                onClick={showAbortButton ? onAbort : onSubmit}
                disabled={sendDisabled}
                aria-label={actionAriaLabel}
              >
                {showAbortButton ? (
                  <Square className="size-3" strokeWidth={2.4} aria-hidden />
                ) : showEnqueueWhileBusy || !busy ? (
                  <ArrowUp className="size-3" strokeWidth={2.25} aria-hidden />
                ) : (
                  <LoaderCircle className="size-3 animate-spin" />
                )}
              </Button>
            );

            if (sendDisabled) {
              return actionButton;
            }

            return (
              <Tooltip delayDuration={300} disableHoverableContent>
                <TooltipTrigger asChild>{actionButton}</TooltipTrigger>
                <TooltipContent side="top" sideOffset={4}>
                  {showAbortButton ? (
                    <>
                      {t("app.abort")} <ComposerAbortShortcutKbd />
                    </>
                  ) : showEnqueueWhileBusy ? (
                    t("composer.enqueueWhileBusy")
                  ) : (
                    <>
                      {t("app.send")} <ComposerSendEnterKbd />
                    </>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
