import { LoaderCircle } from "@spiritagent/icons/loader-circle";
import {
  useMemo,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { ArrowUp, Square } from "lucide-react";

import { ComposerAbortShortcutKbd, ComposerSendEnterKbd } from "./composer-shortcut-kbds.js";
import {
  ComposerLocalFileStrip,
  type ComposerLocalFileAttachmentView,
} from "./composer-local-file-strip.js";
import { ComposerInsertMenu } from "./composer-insert-menu.js";
import {
  ComposerRichInput,
  type ComposerRichInputHandle,
  type RichSegment,
} from "./composer-rich-input.js";
import {
  ModelPickerMenu,
  type ModelPickerShortcutTarget,
} from "../model-picker/model-picker-menu.js";
import { Button } from "../button.js";
import type { SaveLocalImageAs } from "./types.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip.js";
import type { DesktopAgentMode } from "./agent-mode.js";
import { ComposerLabelsProvider, useComposerLabels } from "./labels.js";
import { modelRefsEqual } from "../model-picker/model-ref.js";
import { selectedModelEffort } from "../model-picker/model-picker-controls.js";
import type { BrowserElementAttachment } from "./browser-element-attachment.js";
import {
  DESKTOP_COMPOSER_GHOST_HOVER,
  DESKTOP_ELEVATION_SHADOW_SM,
  instantHoverMotionClass,
} from "../chrome.js";
import {
  DESKTOP_COMPOSER_EDGE,
  DESKTOP_COMPOSER_EDGE_HOVER,
  desktopComposerSurfaceBackdropClass,
} from "../chrome.js";
import { cn } from "../cn.js";
import { segmentsToPlainText } from "./composer-segment-model.js";
import type {
  ModelEffortSelection,
  ModelReasoningMode,
  ModelServiceTier,
  ModelPickerModelProfile,
  ModelRef,
  ModelCatalogHint,
  ProviderEntryMeta,
  ProviderPickerPresetRow,
} from "../model-picker/types.js";

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
  models: readonly ModelPickerModelProfile[];
  catalogHints?: readonly ModelCatalogHint[];
  providers?: readonly ProviderEntryMeta[];
  providerPresets?: readonly ProviderPickerPresetRow[];
  activeModel: ModelRef;
  /** Last upstream-measured conversation input tokens; absent means unknown. */
  lastInputTokens?: number;
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
  onModelReasoningEffortSelect(ref: ModelRef, reasoningEffort: ModelEffortSelection): void;
  onModelReasoningModeSelect?(ref: ModelRef, reasoningMode: ModelReasoningMode): void;
  onModelThinkingEnabledSelect?(ref: ModelRef, enabled: boolean): void | Promise<boolean>;
  onModelServiceTierSelect?(
    ref: ModelRef,
    serviceTier: ModelServiceTier | undefined,
  ): void | Promise<boolean>;
  onAgentModeChange(mode: DesktopAgentMode): void;
  onLoopEnabledChange?(enabled: boolean): void;
  richInputRef?: RefObject<ComposerRichInputHandle | null>;
  /** Host-injected extra Lexical plugins (e.g. Desktop's Edit-menu command bridge). */
  extraPlugins?: ReactNode;
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
  /** Global-shortcut wiring for the model picker (Desktop Cmd+/ bridge); absent = no registration. */
  modelPickerShortcutTarget?: ModelPickerShortcutTarget;
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
  providers,
  providerPresets,
  activeModel,
  lastInputTokens,
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
  onModelServiceTierSelect,
  onAgentModeChange,
  onLoopEnabledChange,
  richInputRef,
  extraPlugins,
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
  modelPickerShortcutTarget,
  useTranslucency = false,
}: ComposerSurfaceProps) {
  const labels = useComposerLabels();
  const [fileDragOver, setFileDragOver] = useState(false);
  const activeModelProfile = useMemo(
    () => models.find((model) => modelRefsEqual(model.ref, activeModel)),
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
        "relative overflow-hidden rounded-2xl focus-within:ring-0",
        DESKTOP_COMPOSER_EDGE,
        DESKTOP_COMPOSER_EDGE_HOVER,
        "focus-within:border-composer-edge-hover",
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
        loopChipLabel={labels.loopChip}
        agentMode={agentMode}
        planChipLabel={labels.planChip}
        askChipLabel={labels.askChip}
        extraPlugins={extraPlugins}
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
      {/* Optical insets: pl-1.5 + the 28px insert button's 7px internal icon inset lands the
          + glyph exactly on the input text edge (px-3); pr-2 evens the send circle's right
          gap with the bar's bottom gap (pb-2). */}
      <div
        className="cursor-text pt-0.5 pr-2 pb-2 pl-1.5"
        onMouseDown={handleComposerChromeMouseDown}
      >
        <div className="flex w-full max-w-full items-center justify-between gap-2">
          {/* gap-0.5 + trigger pl-1 keep the model label one tight step right of the + icon.
              Do NOT use a negative margin on the trigger instead: this flex chain is
              content-sized, so a negative margin shrinks every ancestor's max-content and
              the model name ends up truncated by exactly the margin amount. */}
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
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
              providers={providers}
              providerPresets={providerPresets}
              activeModelRef={activeModel}
              activeReasoningEffort={
                activeModelProfile ? selectedModelEffort(activeModelProfile) : undefined
              }
              lastInputTokens={lastInputTokens}
              disabled={readOnly}
              onModelSelect={onModelSelect}
              onModelReasoningEffortSelect={onModelReasoningEffortSelect}
              onModelReasoningModeSelect={onModelReasoningModeSelect}
              onModelThinkingEnabledSelect={onModelThinkingEnabledSelect}
              onModelServiceTierSelect={onModelServiceTierSelect}
              shortcutTarget={modelPickerShortcutTarget}
              triggerClassName={cn(DESKTOP_COMPOSER_GHOST_HOVER, "pl-1")}
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
              ? labels.abort
              : showEnqueueWhileBusy
                ? labels.enqueueWhileBusy
                : labels.send;
            const actionButton = (
              <Button
                type="button"
                size="icon-sm"
                shape="pill"
                className={cn(
                  "shrink-0 shadow-none [&_svg]:size-3",
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
                  <LoaderCircle className="size-3 animate-spin" strokeWidth={1.75} />
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
                  {() => (
                    <ComposerLabelsProvider value={labels}>
                      {showAbortButton ? (
                        <>
                          {labels.abort} <ComposerAbortShortcutKbd />
                        </>
                      ) : showEnqueueWhileBusy ? (
                        labels.enqueueWhileBusy
                      ) : (
                        <>
                          {labels.send} <ComposerSendEnterKbd />
                        </>
                      )}
                    </ComposerLabelsProvider>
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
