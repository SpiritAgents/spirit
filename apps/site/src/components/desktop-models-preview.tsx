import { useEffect, useMemo, useRef, useState } from "react";
import { FONT_WEIGHT_MEDIUM, FONT_WEIGHT_NORMAL } from "@/lib/typography";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  WindowDialog,
  WindowDialogContent,
  WindowDialogDescription,
  WindowDialogHeader,
  WindowDialogTitle,
} from "@/components/ui/window-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProviderIcon } from "@/components/provider-icon";
import { NoTranslate } from "@/components/no-translate";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/utils";
import type { DesktopModelProvider } from "@/types/spirit-desktop";

type PreviewModelItem = {
  name: string;
  apiBase: string;
  keyConfigured?: boolean;
};

type ProviderRow = {
  id: DesktopModelProvider;
  label: string;
};

type DemoStep =
  | "idle"
  | "picker-open"
  | "provider-selected"
  | "connect-open"
  | "typing"
  | "submitting";

const PROVIDER_PICKER_ROWS: ProviderRow[] = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google", label: "Google" },
  { id: "vercel-ai-gateway", label: "Vercel AI Gateway" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "openrouter", label: "OpenRouter" },
];

const PREVIEW_MODELS: PreviewModelItem[] = [
  {
    name: "GPT 5.5",
    apiBase: "https://api.openai.com/v1",
    keyConfigured: true,
  },
  {
    name: "DeepSeek V4 Pro",
    apiBase: "https://api.deepseek.com/v1",
    keyConfigured: true,
  },
];

const DEMO_PROVIDER_ID = "openai";
const DEMO_API_KEY_MASK = "************************";
const DEMO_START_DELAY_MS = 1100;
const DEMO_RESTART_DELAY_MS = 2600;
const DEMO_RESUME_AFTER_IDLE_MS = 5000;
const DEMO_PICKER_OPEN_MS = 850;
const DEMO_PROVIDER_SELECT_MS = 900;
const DEMO_CONNECT_OPEN_MS = 820;
const DEMO_TYPE_STEP_MS = 55;
const DEMO_SUBMIT_PAUSE_MS = 650;
const DEMO_CLOSE_PAUSE_MS = 560;

export function DesktopModelsPreview({
  activeModel = PREVIEW_MODELS[0]?.name ?? "",
  dialogContainer,
}: {
  activeModel?: string;
  dialogContainer?: HTMLElement | null;
}) {
  const { messages } = useI18n();
  const providerPickerRows = useMemo(
    () => [
      ...PROVIDER_PICKER_ROWS,
      { id: "custom" as DesktopModelProvider, label: messages.desktop.models.customProvider },
    ],
    [messages.desktop.models.customProvider],
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timeoutsRef = useRef<number[]>([]);
  const resumeTimeoutRef = useRef<number | null>(null);
  const interruptedRef = useRef(false);
  const startDemoCycleRef = useRef<(() => void) | null>(null);
  const [demoStep, setDemoStep] = useState<DemoStep>("idle");
  const [demoTypingValue, setDemoTypingValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [customConnectMode, setCustomConnectMode] = useState<"single" | "bulk">("bulk");
  const [connectName, setConnectName] = useState("");
  const [connectApiBase, setConnectApiBase] = useState("");
  const [connectApiKey, setConnectApiKey] = useState("");

  const filteredProviders = useMemo(() => {
    const query = providerQuery.trim().toLowerCase();
    if (!query) {
      return providerPickerRows;
    }
    return providerPickerRows.filter((row) => row.label.toLowerCase().includes(query));
  }, [providerPickerRows, providerQuery]);

  const openProviderPicker = () => {
    setProviderQuery("");
    setProviderDialogOpen(true);
  };

  const resetConnectWizard = () => {
    setSelectedProvider(null);
    setCustomConnectMode("bulk");
    setConnectName("");
    setConnectApiBase("");
    setConnectApiKey("");
    setDemoTypingValue("");
    setDemoStep("idle");
  };

  const startConnect = (providerId: string) => {
    setSelectedProvider(providerId);
    setConnectApiBase(providerId === "custom" ? "" : resolveConnectApiBase(providerId));
    setConnectApiKey("");
    setProviderDialogOpen(false);
    setConnectDialogOpen(true);
  };

  const clearDemoTimers = () => {
    for (const timeoutId of timeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    timeoutsRef.current = [];
  };

  const clearResumeTimer = () => {
    if (resumeTimeoutRef.current !== null) {
      window.clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }
  };

  const scheduleDemo = (callback: () => void, delayMs: number) => {
    const timeoutId = window.setTimeout(callback, delayMs);
    timeoutsRef.current.push(timeoutId);
  };

  const stopDemo = (resetUi: boolean) => {
    interruptedRef.current = true;
    clearDemoTimers();
    clearResumeTimer();
    setDemoStep("idle");
    setDemoTypingValue("");
    if (resetUi) {
      setProviderDialogOpen(false);
      setConnectDialogOpen(false);
      setProviderQuery("");
      setDeleteTarget(null);
      setSelectedProvider(null);
      setConnectApiKey("");
      setConnectApiBase("");
      setConnectName("");
      setCustomConnectMode("bulk");
    }
  };

  useEffect(() => {
    const node = rootRef.current;
    if (!node) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isTrusted) {
        return;
      }
      stopDemo(false);
      clearResumeTimer();
      resumeTimeoutRef.current = window.setTimeout(() => {
        interruptedRef.current = false;
        resetConnectWizard();
        setProviderQuery("");
        setProviderDialogOpen(false);
        setConnectDialogOpen(false);
        setDeleteTarget(null);
        setDemoStep("idle");
        startDemoCycleRef.current?.();
      }, DEMO_RESUME_AFTER_IDLE_MS);
    };

    node.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      node.removeEventListener("pointerdown", handlePointerDown, true);
      clearResumeTimer();
    };
  }, []);

  useEffect(() => {
    interruptedRef.current = false;

    const beginDemoCycle = () => {
      if (interruptedRef.current) {
        return;
      }

      resetConnectWizard();
      setProviderQuery("");
      setProviderDialogOpen(false);
      setConnectDialogOpen(false);
      setDeleteTarget(null);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setDemoStep("picker-open");
        setProviderDialogOpen(true);
      }, DEMO_PICKER_OPEN_MS);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setDemoStep("provider-selected");
      }, DEMO_PICKER_OPEN_MS + DEMO_PROVIDER_SELECT_MS);

      scheduleDemo(
        () => {
          if (interruptedRef.current) {
            return;
          }
          startConnect(DEMO_PROVIDER_ID);
          setDemoStep("connect-open");
        },
        DEMO_PICKER_OPEN_MS + DEMO_PROVIDER_SELECT_MS + 180,
      );

      scheduleDemo(
        () => {
          if (interruptedRef.current) {
            return;
          }
          setDemoStep("typing");
          setDemoTypingValue("");
          setConnectApiKey("");
        },
        DEMO_PICKER_OPEN_MS + DEMO_PROVIDER_SELECT_MS + DEMO_CONNECT_OPEN_MS,
      );

      for (let index = 0; index < DEMO_API_KEY_MASK.length; index += 1) {
        scheduleDemo(
          () => {
            if (interruptedRef.current) {
              return;
            }
            const nextValue = DEMO_API_KEY_MASK.slice(0, index + 1);
            setDemoTypingValue(nextValue);
            setConnectApiKey(nextValue);
          },
          DEMO_PICKER_OPEN_MS +
            DEMO_PROVIDER_SELECT_MS +
            DEMO_CONNECT_OPEN_MS +
            DEMO_TYPE_STEP_MS * (index + 1),
        );
      }

      const submitAt =
        DEMO_PICKER_OPEN_MS +
        DEMO_PROVIDER_SELECT_MS +
        DEMO_CONNECT_OPEN_MS +
        DEMO_TYPE_STEP_MS * DEMO_API_KEY_MASK.length +
        DEMO_SUBMIT_PAUSE_MS;

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setDemoStep("submitting");
      }, submitAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setConnectDialogOpen(false);
      }, submitAt + DEMO_CLOSE_PAUSE_MS);

      scheduleDemo(
        () => {
          if (interruptedRef.current) {
            return;
          }
          resetConnectWizard();
          clearDemoTimers();
          beginDemoCycle();
        },
        submitAt + DEMO_CLOSE_PAUSE_MS + DEMO_RESTART_DELAY_MS,
      );
    };

    startDemoCycleRef.current = () => {
      clearDemoTimers();
      scheduleDemo(beginDemoCycle, DEMO_START_DELAY_MS);
    };

    startDemoCycleRef.current();

    return () => {
      interruptedRef.current = true;
      clearDemoTimers();
      clearResumeTimer();
      startDemoCycleRef.current = null;
    };
  }, []);

  const displayedConnectApiKey =
    demoStep === "typing" || demoStep === "submitting" ? demoTypingValue : connectApiKey;
  const demoConnectButtonBusy = demoStep === "submitting";
  const isDemoProviderHighlighted =
    demoStep === "provider-selected" ||
    demoStep === "connect-open" ||
    demoStep === "typing" ||
    demoStep === "submitting";

  return (
    <div ref={rootRef} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={`text-xl ${FONT_WEIGHT_MEDIUM} tracking-tight text-foreground`}>
          {messages.desktop.models.heading}
        </h1>
        <Button type="button" size="sm" onClick={openProviderPicker}>
          {messages.desktop.models.connectProvider}
        </Button>
      </div>

      <div className="divide-y divide-dialog-panel-border rounded-lg border border-dialog-panel-border bg-card/80">
        {PREVIEW_MODELS.map((model) => {
          const isActive = model.name === activeModel;
          return (
            <div
              key={model.name}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm ${FONT_WEIGHT_NORMAL} text-foreground`}>
                    <NoTranslate>{model.name}</NoTranslate>
                  </span>
                  {isActive ? (
                    <Badge variant="secondary" className="text-muted-foreground">
                      {messages.desktop.models.current}
                    </Badge>
                  ) : null}
                  {model.keyConfigured ? (
                    <Badge variant="secondary" className="text-muted-foreground">
                      {messages.desktop.models.savedKey}
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground" title={model.apiBase}>
                  {model.apiBase}
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                disabled={isActive}
                title={isActive ? messages.desktop.models.cannotDeleteCurrent : undefined}
                onClick={() => setDeleteTarget(model.name)}
              >
                {messages.desktop.models.deleteAction}
              </Button>
            </div>
          );
        })}
      </div>

      <WindowDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <WindowDialogContent className="sm:max-w-md" container={dialogContainer}>
          <WindowDialogHeader>
            <WindowDialogTitle>
              {messages.desktop.models.deleteDialogTitle(deleteTarget ?? "")}
            </WindowDialogTitle>
            <WindowDialogDescription>
              {messages.desktop.models.deleteDialogDescription(deleteTarget ?? "")}
            </WindowDialogDescription>
          </WindowDialogHeader>
          <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row">
            <Button type="button" variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
              {messages.desktop.models.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setDeleteTarget(null)}
            >
              {messages.desktop.models.deleteAction}
            </Button>
          </div>
        </WindowDialogContent>
      </WindowDialog>

      <WindowDialog
        open={providerDialogOpen}
        onOpenChange={(open) => {
          setProviderDialogOpen(open);
          if (!open) {
            setProviderQuery("");
          }
        }}
      >
        <WindowDialogContent className="sm:max-w-md" container={dialogContainer}>
          <WindowDialogHeader>
            <WindowDialogTitle>{messages.desktop.models.providerDialogTitle}</WindowDialogTitle>
            <WindowDialogDescription>
              {messages.desktop.models.providerDialogDescription}
            </WindowDialogDescription>
          </WindowDialogHeader>
          <div className="grid gap-3 py-1">
            <Input
              value={providerQuery}
              onChange={(event) => setProviderQuery(event.target.value)}
              placeholder={messages.desktop.models.searchPlaceholder}
              autoComplete="off"
            />
            <ScrollArea className="h-56 rounded-md border border-border/40">
              <div className="p-1">
                {filteredProviders.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    {messages.desktop.models.noMatches}
                  </p>
                ) : (
                  filteredProviders.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60",
                        row.id === DEMO_PROVIDER_ID &&
                          isDemoProviderHighlighted &&
                          "bg-muted/60 text-foreground",
                      )}
                      onClick={() => startConnect(row.id)}
                    >
                      <ProviderIcon providerId={row.id} />
                      <span className="min-w-0 flex-1 truncate">
                        {row.id === "custom" ? row.label : <NoTranslate>{row.label}</NoTranslate>}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </WindowDialogContent>
      </WindowDialog>

      <WindowDialog
        open={connectDialogOpen}
        onOpenChange={(open) => {
          setConnectDialogOpen(open);
          if (!open) {
            resetConnectWizard();
          }
        }}
      >
        <WindowDialogContent className="sm:max-w-lg" container={dialogContainer}>
          <WindowDialogHeader>
            <WindowDialogTitle>
              {selectedProvider !== null && selectedProvider !== "custom" ? (
                <NoTranslate>
                  {connectDialogTitle(selectedProvider, messages.desktop.models)}
                </NoTranslate>
              ) : (
                connectDialogTitle(selectedProvider, messages.desktop.models)
              )}
            </WindowDialogTitle>
            <WindowDialogDescription>
              {selectedProvider === "custom"
                ? messages.desktop.models.connectDialogDescriptionCustom
                : messages.desktop.models.connectDialogDescriptionDefault}
            </WindowDialogDescription>
          </WindowDialogHeader>

          <div className="grid gap-3 py-1">
            {selectedProvider === "custom" ? (
              <div className="grid gap-2">
                <Label>{messages.desktop.models.addModeLabel}</Label>
                <div
                  role="tablist"
                  aria-label={messages.desktop.models.addModeAria}
                  className="inline-flex h-9 shrink-0 rounded-lg border border-border/40 bg-muted/30 p-0.5"
                >
                  {(["single", "bulk"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={customConnectMode === value}
                      className={cn(
                        `rounded-md px-2.5 text-xs ${FONT_WEIGHT_NORMAL} transition-colors`,
                        customConnectMode === value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setCustomConnectMode(value)}
                    >
                      {value === "single"
                        ? messages.desktop.models.addSingle
                        : messages.desktop.models.addAll}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {selectedProvider === "custom" && customConnectMode === "single" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-model-name">{messages.desktop.models.modelNameLabel}</Label>
                <Input
                  id="connect-model-name"
                  value={connectName}
                  onChange={(event) => setConnectName(event.target.value)}
                  placeholder={messages.desktop.models.modelNamePlaceholder}
                  autoComplete="off"
                />
              </div>
            ) : null}
            {selectedProvider === "custom" ? (
              <div className="grid gap-2">
                <Label htmlFor="connect-api-base">{messages.desktop.models.endpointLabel}</Label>
                <Input
                  id="connect-api-base"
                  value={connectApiBase}
                  onChange={(event) => setConnectApiBase(event.target.value)}
                  placeholder={messages.desktop.models.optionalPlaceholder}
                  autoComplete="off"
                />
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="connect-api-key">{messages.desktop.models.apiKeyLabel}</Label>
              <Input
                id="connect-api-key"
                type={demoStep === "typing" || demoStep === "submitting" ? "text" : "password"}
                value={displayedConnectApiKey}
                onChange={(event) => setConnectApiKey(event.target.value)}
                placeholder={messages.desktop.models.apiKeyPlaceholder}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col-reverse justify-end gap-2 pt-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConnectDialogOpen(false)}
              >
                {messages.desktop.models.cancel}
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                {selectedProvider === "custom" && customConnectMode === "single" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!connectName.trim() || !connectApiKey.trim()}
                    onClick={() => setConnectDialogOpen(false)}
                  >
                    {messages.desktop.models.addThisModel}
                  </Button>
                ) : null}
                {selectedProvider === "custom" && customConnectMode === "bulk" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!displayedConnectApiKey.trim()}
                    onClick={() => setConnectDialogOpen(false)}
                  >
                    {demoConnectButtonBusy
                      ? messages.desktop.models.adding
                      : messages.desktop.models.addProvider}
                  </Button>
                ) : null}
                {selectedProvider !== null && selectedProvider !== "custom" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!displayedConnectApiKey.trim()}
                    onClick={() => setConnectDialogOpen(false)}
                  >
                    {demoConnectButtonBusy
                      ? messages.desktop.models.adding
                      : messages.desktop.models.addProvider}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </WindowDialogContent>
      </WindowDialog>
    </div>
  );
}

function resolveConnectApiBase(providerId: string): string {
  switch (providerId) {
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "google":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "vercel-ai-gateway":
      return "https://ai-gateway.vercel.sh/v1";
    case "deepseek":
      return "https://api.deepseek.com/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    default:
      return "";
  }
}

function connectDialogTitle(
  selectedProvider: string | null,
  copy: ReturnType<typeof useI18n>["messages"]["desktop"]["models"],
): string {
  switch (selectedProvider) {
    case "custom":
      return copy.customConnectionTitle;
    case "openai":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "google":
      return "Google";
    case "vercel-ai-gateway":
      return "Vercel AI Gateway";
    case "deepseek":
      return "DeepSeek";
    case "openrouter":
      return "OpenRouter";
    default:
      return copy.connectProviderTitle;
  }
}
