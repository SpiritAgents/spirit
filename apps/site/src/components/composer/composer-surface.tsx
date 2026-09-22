import { LoaderCircle } from "@spiritagent/icons/loader-circle";
import {
  useMemo,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { useTranslation } from "@/lib/desktop-preview-i18n";

import { ArrowUp, Square } from "lucide-react";

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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  isNestedDesktopPreview,
  useDesktopPreviewDensity,
} from "@/contexts/desktop-preview-density-context";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import { instantHoverMotionClass } from "@/lib/desktop-chrome";
import {
  DESKTOP_COMPOSER_SURFACE_BACKDROP,
  DESKTOP_ELEVATION_SHADOW_SM,
} from "@/lib/desktop-translucency-surface";
import { cn } from "@/lib/utils";
import type { DesktopModelCatalogHint, ModelProfileSnapshot } from "@/types/spirit-desktop";

export type ComposerSurfaceProps = {
  value: string;
  localFileAttachments: readonly ComposerLocalFileAttachmentView[];
  placeholder: string;
  models: ModelProfileSnapshot[];
  catalogHints?: DesktopModelCatalogHint[];
  activeModel: string;
  agentMode: DesktopAgentMode;
  loopEnabled: boolean;
  canSend: boolean;
  canAbort?: boolean;
  busy: boolean;
  readOnly?: boolean;
  onChange(value: string): void;
  onSubmit(): void;
  onAbort?(): void;
  onModelSelect(name: string): void;
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
  browserElementAttachments?: readonly BrowserElementAttachment[];
  onElementAttachmentsChange?(attachments: BrowserElementAttachment[]): void;
  initialSegments?: readonly RichSegment[] | null;
  conversationBusy?: boolean;
  agentModeChipDismissed?: boolean;
  onAgentModeChipDismissChange?(dismissed: boolean): void;
};

export function ComposerSurface({
  value,
  localFileAttachments,
  placeholder,
  models,
  catalogHints,
  activeModel,
  agentMode,
  loopEnabled = false,
  canSend,
  canAbort = false,
  busy,
  readOnly = false,
  onChange,
  onSubmit,
  onAbort,
  onModelSelect,
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
  browserElementAttachments,
  onElementAttachmentsChange,
  initialSegments,
  conversationBusy = false,
  agentModeChipDismissed = false,
  onAgentModeChipDismissChange,
}: ComposerSurfaceProps) {
  const { t } = useTranslation();
  const previewDensity = useDesktopPreviewDensity();
  const nestedPreview = isNestedDesktopPreview(previewDensity);
  const activeModelProfile = useMemo(
    () => models.find((model) => model.name === activeModel),
    [activeModel, models],
  );

  return (
    <div
      data-spirit-surface="composer-surface"
      className={cn(
        "relative overflow-hidden border border-ring/30 focus-within:ring-0 hover:border-ring/40 focus-within:border-ring/40 dark:border-white/10 dark:hover:border-white/12 dark:focus-within:border-white/12",
        DESKTOP_ELEVATION_SHADOW_SM,
        DESKTOP_COMPOSER_SURFACE_BACKDROP,
        nestedPreview ? "rounded-xl" : "rounded-2xl",
      )}
    >
      <ComposerLocalFileStrip
        attachments={localFileAttachments}
        onRemove={(path) => onRemoveLocalFileAttachment?.(path)}
      />
      <ComposerRichInput
        ref={richInputRef}
        value={value}
        elementAttachments={browserElementAttachments}
        initialSegments={initialSegments}
        placeholder={placeholder}
        readOnly={readOnly}
        loopEnabled={loopEnabled}
        loopChipLabel={t("composer.loopChipLabel")}
        agentMode={agentMode}
        planChipLabel={t("composer.planChipLabel")}
        askChipLabel={t("composer.askChipLabel")}
        onTextChange={onChange}
        onElementAttachmentsChange={(atts) => onElementAttachmentsChange?.(atts)}
        onLoopEnabledChange={onLoopEnabledChange}
        onAgentModeChange={onAgentModeChange}
        conversationBusy={conversationBusy}
        agentModeChipDismissed={agentModeChipDismissed}
        onAgentModeChipDismissChange={onAgentModeChipDismissChange}
        onPaste={(e) => onPaste?.(e as unknown as ReactClipboardEvent<HTMLTextAreaElement>)}
        onKeyDown={(e) => {
          onKeyDown?.(e as unknown as ReactKeyboardEvent<HTMLTextAreaElement>);
          if (e.defaultPrevented) return;
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            // React synthetic event isComposing is unreliable; must check the IME composition state via nativeEvent
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        onSelectionChange={onSelectionChange}
      />
      <div className={cn("flex justify-center px-3 pt-0.5", nestedPreview ? "pb-1.5" : "pb-2")}>
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
              activeModelName={activeModel}
              activeReasoningEffort={activeModelProfile?.reasoningEffort}
              disabled={readOnly}
              onModelSelect={onModelSelect}
              triggerClassName="max-w-[min(12rem,100%)] pr-0.5 pl-1"
            />
          </div>
          {(() => {
            const hasComposerPayload = value.trim().length > 0 || localFileAttachments.length > 0;
            const showAbortButton = canAbort && Boolean(onAbort) && !hasComposerPayload;
            const showEnqueueWhileBusy = canAbort && hasComposerPayload;
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
                  "shrink-0 rounded-full p-0 shadow-none",
                  nestedPreview ? "size-6 [&_svg]:size-3" : "size-8 [&_svg]:size-3.5",
                  instantHoverMotionClass,
                )}
                onClick={showAbortButton ? onAbort : onSubmit}
                disabled={sendDisabled}
                aria-label={actionAriaLabel}
              >
                {showAbortButton ? (
                  <Square className="size-3.5" strokeWidth={2.4} aria-hidden />
                ) : busy ? (
                  <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} />
                ) : (
                  <ArrowUp className="size-3.5" strokeWidth={2.25} aria-hidden />
                )}
              </Button>
            );

            if (sendDisabled) {
              return actionButton;
            }

            return (
              <Tooltip delayDuration={300}>
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
