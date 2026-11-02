import { useEffect, useMemo, useRef, useState } from "react";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";

import { ComposerSurface, segmentsToPlainText, type RichSegment } from "@spiritagent/ui/composer";
import type { ModelCatalogHint, ModelPickerModelProfile } from "@spiritagent/ui/model-picker";
import { UiPreviewProviders } from "@/components/ui-preview-providers";
import {
  buildRunningTool,
  buildSucceededTool,
  conversationMessageDomId,
  PreviewMessageCard,
  shouldCompactAfterPreviousMessage,
} from "@/components/conversation/preview-presentation";
import { EmptyStateWorkspaceSelector } from "@/components/empty-state-workspace-selector";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Messages } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import {
  AGENT_PLAN_CREATE_PLAN_START_DELAY_MS,
  AGENT_PLAN_CREATE_PLAN_SUCCESS_DELAY_MS,
  AGENT_PLAN_DEMO_RESTART_DELAY_MS,
  AGENT_PLAN_DEMO_RESUME_AFTER_IDLE_MS,
  AGENT_PLAN_DEMO_START_DELAY_MS,
  AGENT_PLAN_IMAGE_TOOL_START_DELAY_MS,
  AGENT_PLAN_IMAGE_TOOL_SUCCESS_DELAY_MS,
  AGENT_PLAN_REVEAL_DELAY_MS,
  AGENT_PLAN_SEND_DELAY_MS,
  AGENT_PLAN_STREAM_CHAR_MS,
  AGENT_PLAN_ASSISTANT_STREAM_START_DELAY_MS,
  AGENT_PLAN_ASSISTANT_STREAM_SPEED_MS,
  AGENT_PLAN_THINKING_START_DELAY_MS,
  AGENT_PLAN_THINKING_STREAM_SPEED_MS,
  AGENT_PLAN_TYPE_SPEED_MS,
  buildAgentCreatePlanRunningTool,
  buildAgentCreatePlanSucceededTool,
  buildAgentImageRunningTool,
  buildAgentImageSucceededTool,
} from "@/lib/agent-plan-demo-script";
import type { BrowserElementAttachment } from "@spiritagent/ui/composer";
import {
  DESIGN_MODE_ASSISTANT_STREAM_SPEED_MS,
  DESIGN_MODE_ASSISTANT_STREAM_START_DELAY_MS,
  DESIGN_MODE_DEMO_RESTART_DELAY_MS,
  DESIGN_MODE_DEMO_RESUME_AFTER_IDLE_MS,
  DESIGN_MODE_DEMO_START_DELAY_MS,
  DESIGN_MODE_EDIT_TOOL_START_DELAY_MS,
  DESIGN_MODE_EDIT_TOOL_SUCCESS_DELAY_MS,
  DESIGN_MODE_HEADLINE_CROSSFADE_MS,
  DESIGN_MODE_CURSOR_RETURN_TRANSITION_MS,
  DESIGN_MODE_CURSOR_SWEEP_TRANSITION_MS,
  DESIGN_MODE_HOVER_STEP_MS,
  DESIGN_MODE_HOVER_SWEEP_STEP_MS,
  DESIGN_MODE_PICKER_ACTIVATE_MS,
  DESIGN_MODE_SELECT_MS,
  DESIGN_MODE_SEND_DELAY_MS,
  DESIGN_MODE_THINKING_START_DELAY_MS,
  DESIGN_MODE_THINKING_STREAM_SPEED_MS,
  DESIGN_MODE_TOOLS_OPEN_MS,
  DESIGN_MODE_TYPE_SPEED_MS,
  buildDesignModeEditRunningTool,
  buildDesignModeEditSucceededTool,
} from "@/lib/design-mode-demo-script";
import type { DesignModeDemoState } from "@/lib/design-mode-demo-state";
import { DESIGN_MODE_BROWSER_URL } from "@/lib/workspace-tool-tabs";
import { CONVERSATION_GUTTER_X, CONVERSATION_MAX_W } from "@/lib/conversation-layout-constants";
import {
  isNestedDesktopPreview,
  useDesktopPreviewDensity,
} from "@/contexts/desktop-preview-density-context";
import { cn } from "@/lib/utils";
import type { ConversationMessageSnapshot } from "@/types/spirit-desktop";

type AvailableWorkspace = {
  label: string;
  path: string;
};

export type DemoStaticSnapshot = "defaultEnd";

type DesktopConversationPreviewProps = {
  workspaceRoot: string;
  availableWorkspaces: AvailableWorkspace[];
  models: ModelPickerModelProfile[];
  catalogHints?: ModelCatalogHint[];
  activeModel: string;
  planMode: boolean;
  demoVariant?: "default" | "agentPlan" | "designMode";
  demoPlaybackActive?: boolean;
  /** Seed a finished default-demo frame; skips playback timers. */
  demoStaticSnapshot?: DemoStaticSnapshot;
  baseToneClassName?: string;
  onSelectWorkspace(workspaceRoot: string): void;
  onAddWorkspace(): void;
  onModelSelect(name: string): void;
  onPlanModeChange(planMode: boolean): void;
  onPlanReveal?: () => void;
  onPlanContentUpdate?: (content: string) => void;
  onPlanReset?: () => void;
  onWorkspaceToolsOpen?: () => void;
  onWorkspaceToolsClose?: () => void;
  onDesignModeStateChange?: (patch: Partial<DesignModeDemoState>) => void;
  onDesignModeReset?: () => void;
  designModeUserInteractRef?: React.MutableRefObject<(() => void) | null>;
};

function buildDefaultEndSnapshot(
  copy: Messages["desktop"]["conversation"],
): ConversationMessageSnapshot[] {
  const toolCallId = "tool-static-1";
  return [
    {
      id: 1,
      role: "user",
      content: copy.demoUserPrompt,
      pending: false,
    },
    {
      id: 2,
      role: "assistant",
      content: "",
      aux: { thinking: copy.demoThinkingText },
      pending: false,
    },
    {
      id: 3,
      role: "assistant",
      content: "",
      tool: buildSucceededTool(toolCallId, copy),
      pending: false,
    },
    {
      id: 4,
      role: "assistant",
      content: copy.demoAssistantResponse,
      pending: false,
    },
  ];
}

const DEMO_START_DELAY_MS = 900;
const DEMO_TYPE_SPEED_MS = 30;
const DEMO_SEND_DELAY_MS = 260;
const DEMO_THINKING_START_DELAY_MS = 260;
const DEMO_THINKING_STREAM_SPEED_MS = 10;
const DEMO_TOOL_START_DELAY_MS = 920;
const DEMO_TOOL_SUCCESS_DELAY_MS = 2120;
const DEMO_ASSISTANT_STREAM_START_DELAY_MS = 2380;
const DEMO_ASSISTANT_STREAM_SPEED_MS = 16;
const MANUAL_ASSISTANT_RESPONSE_DELAY_MS = 220;

export function DesktopConversationPreview({
  workspaceRoot,
  availableWorkspaces,
  models,
  catalogHints,
  activeModel,
  planMode,
  demoVariant = "default",
  demoPlaybackActive = true,
  demoStaticSnapshot,
  baseToneClassName,
  onSelectWorkspace,
  onAddWorkspace,
  onModelSelect,
  onPlanModeChange,
  onPlanReveal,
  onPlanContentUpdate,
  onPlanReset,
  onWorkspaceToolsOpen,
  onWorkspaceToolsClose,
  onDesignModeStateChange,
  onDesignModeReset,
  designModeUserInteractRef,
}: DesktopConversationPreviewProps) {
  const { messages: i18nMessages, locale } = useI18n();
  const previewDensity = useDesktopPreviewDensity();
  const nestedPreview = isNestedDesktopPreview(previewDensity);
  const conversationCopy = i18nMessages.desktop.conversation;
  const agentDemoCopy = conversationCopy.agentDemo;
  const designDemoCopy = conversationCopy.designDemo;
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nextMessageIdRef = useRef(1);
  const demoTimersRef = useRef<number[]>([]);
  const manualResponseTimerRef = useRef<number | null>(null);
  const resumeTimeoutRef = useRef<number | null>(null);
  const demoActiveRef = useRef(false);
  const interruptedRef = useRef(false);
  const startDemoCycleRef = useRef<(() => void) | null>(null);
  const onPlanRevealRef = useRef(onPlanReveal);
  const onPlanContentUpdateRef = useRef(onPlanContentUpdate);
  const onPlanResetRef = useRef(onPlanReset);
  const onWorkspaceToolsOpenRef = useRef(onWorkspaceToolsOpen);
  const onWorkspaceToolsCloseRef = useRef(onWorkspaceToolsClose);
  const onDesignModeStateChangeRef = useRef(onDesignModeStateChange);
  const onDesignModeResetRef = useRef(onDesignModeReset);
  const [composerSegments, setComposerSegments] = useState<RichSegment[]>([]);
  const composer = segmentsToPlainText(composerSegments);
  const setComposer = (text: string) =>
    setComposerSegments(text ? [{ kind: "text", value: text }] : []);
  const [browserElementAttachments, setBrowserElementAttachments] = useState<
    BrowserElementAttachment[]
  >([]);
  const activeModelRef = useMemo(
    () =>
      models.find((model) => model.name === activeModel)?.ref ?? {
        providerId: "",
        name: activeModel,
      },
    [models, activeModel],
  );
  const [messages, setMessages] = useState<ConversationMessageSnapshot[]>(() =>
    demoStaticSnapshot === "defaultEnd" ? buildDefaultEndSnapshot(conversationCopy) : [],
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onPlanRevealRef.current = onPlanReveal;
    onPlanContentUpdateRef.current = onPlanContentUpdate;
    onPlanResetRef.current = onPlanReset;
    onWorkspaceToolsOpenRef.current = onWorkspaceToolsOpen;
    onWorkspaceToolsCloseRef.current = onWorkspaceToolsClose;
    onDesignModeStateChangeRef.current = onDesignModeStateChange;
    onDesignModeResetRef.current = onDesignModeReset;
  }, [
    onDesignModeReset,
    onDesignModeStateChange,
    onPlanContentUpdate,
    onPlanReveal,
    onPlanReset,
    onWorkspaceToolsClose,
    onWorkspaceToolsOpen,
  ]);

  const allocateMessageId = () => {
    const nextId = nextMessageIdRef.current;
    nextMessageIdRef.current += 1;
    return nextId;
  };

  const clearDemoTimers = () => {
    for (const timeoutId of demoTimersRef.current) {
      window.clearTimeout(timeoutId);
    }
    demoTimersRef.current = [];
  };

  const clearManualResponseTimer = () => {
    if (manualResponseTimerRef.current !== null) {
      window.clearTimeout(manualResponseTimerRef.current);
      manualResponseTimerRef.current = null;
    }
  };

  const scheduleDemo = (callback: () => void, delayMs: number) => {
    const timeoutId = window.setTimeout(callback, delayMs);
    demoTimersRef.current.push(timeoutId);
  };

  const scheduleThinkingStream = (
    thinkingMessageId: number,
    thinkingText: string,
    thinkingStartAt: number,
    charSpeedMs: number,
  ): number => {
    scheduleDemo(() => {
      if (interruptedRef.current) {
        return;
      }
      setMessages((current) => [
        ...current,
        {
          id: thinkingMessageId,
          role: "assistant",
          content: "",
          aux: { thinking: "" },
          pending: true,
        },
      ]);
    }, thinkingStartAt);

    for (let index = 0; index < thinkingText.length; index += 1) {
      scheduleDemo(
        () => {
          if (interruptedRef.current) {
            return;
          }
          setMessages((current) =>
            current.map((message) =>
              message.id === thinkingMessageId
                ? { ...message, aux: { thinking: thinkingText.slice(0, index + 1) } }
                : message,
            ),
          );
        },
        thinkingStartAt + charSpeedMs * (index + 1),
      );
    }

    return thinkingStartAt + charSpeedMs * thinkingText.length + 100;
  };

  const pruneInterruptedMessages = (current: ConversationMessageSnapshot[]) =>
    current.filter((message) => !message.pending);

  const resetConversation = () => {
    nextMessageIdRef.current = 1;
    setComposer("");
    setBrowserElementAttachments([]);
    setMessages([]);
    setBusy(false);
    if (demoVariant === "agentPlan") {
      onPlanResetRef.current?.();
      onWorkspaceToolsCloseRef.current?.();
    }
    if (demoVariant === "designMode") {
      onDesignModeResetRef.current?.();
    }
  };

  const clearResumeTimer = () => {
    if (resumeTimeoutRef.current !== null) {
      window.clearTimeout(resumeTimeoutRef.current);
      resumeTimeoutRef.current = null;
    }
  };

  const stopDemo = (resetUi: boolean) => {
    const wasDemoActive = demoActiveRef.current;
    interruptedRef.current = true;
    clearDemoTimers();
    clearResumeTimer();
    demoActiveRef.current = false;
    if (wasDemoActive) {
      setBusy(false);
    }
    if (resetUi) {
      resetConversation();
    }
  };

  const takeConversationControl = () => {
    stopDemo(false);
    setMessages(pruneInterruptedMessages);
  };

  const handleComposerChange = (segments: RichSegment[]) => {
    takeConversationControl();
    setComposerSegments(segments);
  };

  const handleSelectWorkspace = (nextWorkspaceRoot: string) => {
    takeConversationControl();
    onSelectWorkspace(nextWorkspaceRoot);
  };

  const handleAddWorkspaceClick = () => {
    takeConversationControl();
    onAddWorkspace();
  };

  const handleModelSelect = (name: string) => {
    takeConversationControl();
    onModelSelect(name);
  };

  const handlePlanModeSelect = (nextPlanMode: boolean) => {
    takeConversationControl();
    onPlanModeChange(nextPlanMode);
  };

  const handleManualSubmit = () => {
    const trimmed = composer.trim();
    if (!trimmed || busy) {
      return;
    }

    takeConversationControl();
    clearManualResponseTimer();
    setBusy(true);

    setMessages((current) => [
      ...current,
      {
        id: allocateMessageId(),
        role: "user",
        content: trimmed,
        pending: false,
      },
    ]);
    setComposer("");

    manualResponseTimerRef.current = window.setTimeout(() => {
      manualResponseTimerRef.current = null;
      setMessages((current) => [
        ...current,
        {
          id: allocateMessageId(),
          role: "assistant",
          content: conversationCopy.manualAssistantResponse,
          pending: false,
        },
      ]);
      setBusy(false);
    }, MANUAL_ASSISTANT_RESPONSE_DELAY_MS);
  };

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    if (!(viewport instanceof HTMLDivElement)) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if ((demoVariant !== "agentPlan" && demoVariant !== "designMode") || !demoPlaybackActive) {
      return;
    }
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
      resumeTimeoutRef.current = window.setTimeout(
        () => {
          interruptedRef.current = false;
          resetConversation();
          startDemoCycleRef.current?.();
        },
        demoVariant === "designMode"
          ? DESIGN_MODE_DEMO_RESUME_AFTER_IDLE_MS
          : AGENT_PLAN_DEMO_RESUME_AFTER_IDLE_MS,
      );
    };

    node.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      node.removeEventListener("pointerdown", handlePointerDown, true);
      clearResumeTimer();
    };
  }, [demoVariant, demoPlaybackActive]);

  useEffect(() => {
    if (!designModeUserInteractRef || demoVariant !== "designMode") {
      return;
    }

    designModeUserInteractRef.current = () => {
      if (!demoPlaybackActive) {
        return;
      }
      stopDemo(false);
      clearResumeTimer();
      resumeTimeoutRef.current = window.setTimeout(() => {
        interruptedRef.current = false;
        resetConversation();
        startDemoCycleRef.current?.();
      }, DESIGN_MODE_DEMO_RESUME_AFTER_IDLE_MS);
    };

    return () => {
      designModeUserInteractRef.current = null;
    };
  }, [demoPlaybackActive, demoVariant, designModeUserInteractRef]);

  useEffect(() => {
    if (demoStaticSnapshot === "defaultEnd") {
      interruptedRef.current = true;
      demoActiveRef.current = false;
      clearDemoTimers();
      clearManualResponseTimer();
      clearResumeTimer();
      startDemoCycleRef.current = null;
      nextMessageIdRef.current = 5;
      setComposer("");
      setBrowserElementAttachments([]);
      setBusy(false);
      setMessages(buildDefaultEndSnapshot(conversationCopy));
      return;
    }

    if (!demoPlaybackActive) {
      interruptedRef.current = true;
      demoActiveRef.current = false;
      clearDemoTimers();
      clearManualResponseTimer();
      clearResumeTimer();
      resetConversation();
      startDemoCycleRef.current = null;
      return;
    }

    interruptedRef.current = false;

    const beginDefaultDemo = () => {
      if (interruptedRef.current) {
        return;
      }

      demoActiveRef.current = true;
      resetConversation();

      for (let index = 0; index < conversationCopy.demoUserPrompt.length; index += 1) {
        scheduleDemo(
          () => {
            if (interruptedRef.current) {
              return;
            }
            setComposer(conversationCopy.demoUserPrompt.slice(0, index + 1));
          },
          DEMO_TYPE_SPEED_MS * (index + 1),
        );
      }

      const submitAt =
        DEMO_TYPE_SPEED_MS * conversationCopy.demoUserPrompt.length + DEMO_SEND_DELAY_MS;
      const userMessageId = allocateMessageId();
      const thinkingMessageId = allocateMessageId();
      const toolCallId = `tool-${allocateMessageId()}`;
      const assistantMessageId = allocateMessageId();

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setBusy(true);
        setMessages((current) => [
          ...current,
          {
            id: userMessageId,
            role: "user",
            content: conversationCopy.demoUserPrompt,
            pending: false,
          },
        ]);
        setComposer("");
      }, submitAt);

      const thinkingStartAt = submitAt + DEMO_THINKING_START_DELAY_MS;
      const thinkingCompleteAt = scheduleThinkingStream(
        thinkingMessageId,
        conversationCopy.demoThinkingText,
        thinkingStartAt,
        DEMO_THINKING_STREAM_SPEED_MS,
      );
      const thinkingSettleAt = thinkingCompleteAt + 180;
      const toolStartAt = thinkingSettleAt + 120;
      const toolSuccessAt = toolStartAt + (DEMO_TOOL_SUCCESS_DELAY_MS - DEMO_TOOL_START_DELAY_MS);
      const assistantStartAt =
        toolSuccessAt + (DEMO_ASSISTANT_STREAM_START_DELAY_MS - DEMO_TOOL_SUCCESS_DELAY_MS);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === thinkingMessageId ? { ...message, pending: false } : message,
          ),
        );
      }, thinkingSettleAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) => [
          ...current,
          {
            id: allocateMessageId(),
            role: "assistant",
            content: "",
            tool: buildRunningTool(toolCallId, conversationCopy),
            pending: false,
          },
        ]);
      }, toolStartAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.tool?.toolCallId === toolCallId
              ? { ...message, tool: buildSucceededTool(toolCallId, conversationCopy) }
              : message,
          ),
        );
      }, toolSuccessAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            pending: true,
          },
        ]);
      }, assistantStartAt);

      for (let index = 0; index < conversationCopy.demoAssistantResponse.length; index += 1) {
        scheduleDemo(
          () => {
            if (interruptedRef.current) {
              return;
            }
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: conversationCopy.demoAssistantResponse.slice(0, index + 1),
                    }
                  : message,
              ),
            );
          },
          assistantStartAt + DEMO_ASSISTANT_STREAM_SPEED_MS * (index + 1),
        );
      }

      const completeAt =
        assistantStartAt +
        DEMO_ASSISTANT_STREAM_SPEED_MS * conversationCopy.demoAssistantResponse.length +
        240;

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        demoActiveRef.current = false;
        interruptedRef.current = true;
        clearDemoTimers();
        setBusy(false);
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId ? { ...message, pending: false } : message,
          ),
        );
      }, completeAt);
    };

    const beginAgentPlanDemo = () => {
      if (interruptedRef.current) {
        return;
      }

      demoActiveRef.current = true;
      resetConversation();

      const userPrompt = agentDemoCopy.demoUserPrompt;
      const planMarkdown = agentDemoCopy.planMarkdown;

      for (let index = 0; index < userPrompt.length; index += 1) {
        scheduleDemo(
          () => {
            if (interruptedRef.current) {
              return;
            }
            setComposer(userPrompt.slice(0, index + 1));
          },
          AGENT_PLAN_TYPE_SPEED_MS * (index + 1),
        );
      }

      const submitAt = AGENT_PLAN_TYPE_SPEED_MS * userPrompt.length + AGENT_PLAN_SEND_DELAY_MS;
      const userMessageId = allocateMessageId();
      const thinkingMessageId = allocateMessageId();
      const imageToolCallId = `tool-${allocateMessageId()}`;
      const createPlanToolCallId = `tool-${allocateMessageId()}`;
      const assistantMessageId = allocateMessageId();

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setBusy(true);
        setMessages((current) => [
          ...current,
          {
            id: userMessageId,
            role: "user",
            content: userPrompt,
            pending: false,
          },
        ]);
        setComposer("");
      }, submitAt);

      const thinkingStartAt = submitAt + AGENT_PLAN_THINKING_START_DELAY_MS;
      const thinkingCompleteAt = scheduleThinkingStream(
        thinkingMessageId,
        agentDemoCopy.demoThinkingText,
        thinkingStartAt,
        AGENT_PLAN_THINKING_STREAM_SPEED_MS,
      );
      const thinkingSettleAt = thinkingCompleteAt + 160;
      const imageToolStartAt = thinkingSettleAt + 120;
      const imageToolSuccessAt =
        imageToolStartAt +
        (AGENT_PLAN_IMAGE_TOOL_SUCCESS_DELAY_MS - AGENT_PLAN_IMAGE_TOOL_START_DELAY_MS);
      const createPlanStartAt =
        imageToolStartAt +
        (AGENT_PLAN_CREATE_PLAN_START_DELAY_MS - AGENT_PLAN_IMAGE_TOOL_START_DELAY_MS);
      const createPlanSuccessAt =
        imageToolStartAt +
        (AGENT_PLAN_CREATE_PLAN_SUCCESS_DELAY_MS - AGENT_PLAN_IMAGE_TOOL_START_DELAY_MS);
      const planRevealAt =
        imageToolStartAt + (AGENT_PLAN_REVEAL_DELAY_MS - AGENT_PLAN_IMAGE_TOOL_START_DELAY_MS);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === thinkingMessageId ? { ...message, pending: false } : message,
          ),
        );
      }, thinkingSettleAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) => [
          ...current,
          {
            id: allocateMessageId(),
            role: "assistant",
            content: "",
            tool: buildAgentImageRunningTool(imageToolCallId, agentDemoCopy),
            pending: false,
          },
        ]);
      }, imageToolStartAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.tool?.toolCallId === imageToolCallId
              ? { ...message, tool: buildAgentImageSucceededTool(imageToolCallId, agentDemoCopy) }
              : message,
          ),
        );
      }, imageToolSuccessAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) => [
          ...current,
          {
            id: allocateMessageId(),
            role: "assistant",
            content: "",
            tool: buildAgentCreatePlanRunningTool(createPlanToolCallId, agentDemoCopy),
            pending: false,
          },
        ]);
      }, createPlanStartAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.tool?.toolCallId === createPlanToolCallId
              ? {
                  ...message,
                  tool: buildAgentCreatePlanSucceededTool(createPlanToolCallId, agentDemoCopy),
                }
              : message,
          ),
        );
      }, createPlanSuccessAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        onWorkspaceToolsOpenRef.current?.();
        onPlanRevealRef.current?.();
      }, planRevealAt);

      for (let index = 0; index < planMarkdown.length; index += 1) {
        scheduleDemo(
          () => {
            if (interruptedRef.current) {
              return;
            }
            onPlanContentUpdateRef.current?.(planMarkdown.slice(0, index + 1));
          },
          planRevealAt + AGENT_PLAN_STREAM_CHAR_MS * (index + 1),
        );
      }

      const planStreamEndAt = planRevealAt + AGENT_PLAN_STREAM_CHAR_MS * planMarkdown.length;
      const assistantStartAt = planStreamEndAt + AGENT_PLAN_ASSISTANT_STREAM_START_DELAY_MS;

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            pending: true,
          },
        ]);
      }, assistantStartAt);

      for (let index = 0; index < agentDemoCopy.demoAssistantResponse.length; index += 1) {
        scheduleDemo(
          () => {
            if (interruptedRef.current) {
              return;
            }
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: agentDemoCopy.demoAssistantResponse.slice(0, index + 1),
                    }
                  : message,
              ),
            );
          },
          assistantStartAt + AGENT_PLAN_ASSISTANT_STREAM_SPEED_MS * (index + 1),
        );
      }

      const completeAt =
        assistantStartAt +
        AGENT_PLAN_ASSISTANT_STREAM_SPEED_MS * agentDemoCopy.demoAssistantResponse.length +
        320;

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId ? { ...message, pending: false } : message,
          ),
        );
        setBusy(false);
      }, completeAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        demoActiveRef.current = false;
        interruptedRef.current = false;
        clearDemoTimers();
        beginAgentPlanDemo();
      }, completeAt + AGENT_PLAN_DEMO_RESTART_DELAY_MS);
    };

    const beginDesignModeDemo = () => {
      if (interruptedRef.current) {
        return;
      }

      demoActiveRef.current = true;
      resetConversation();

      const designElementAttachment: BrowserElementAttachment = {
        id: "design-element-headline",
        tagName: "span",
        pageUrl: DESIGN_MODE_BROWSER_URL,
        outerHtml: designDemoCopy.selectedElementHtml,
        screenshotDataUrl: "",
      };

      const userPrompt = designDemoCopy.demoUserPrompt;
      let cursorAt = DESIGN_MODE_TOOLS_OPEN_MS;

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        onWorkspaceToolsOpenRef.current?.();
        onDesignModeStateChangeRef.current?.({ showCursor: true });
      }, cursorAt);

      cursorAt += DESIGN_MODE_PICKER_ACTIVATE_MS;
      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        onDesignModeStateChangeRef.current?.({
          pickerActive: true,
          hoverTarget: "headline",
          cursorTransitionMs: DESIGN_MODE_CURSOR_RETURN_TRANSITION_MS,
        });
      }, cursorAt);

      cursorAt += DESIGN_MODE_HOVER_SWEEP_STEP_MS;
      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        onDesignModeStateChangeRef.current?.({
          hoverTarget: "tagline",
          cursorTransitionMs: DESIGN_MODE_CURSOR_SWEEP_TRANSITION_MS,
        });
      }, cursorAt);

      cursorAt += DESIGN_MODE_HOVER_SWEEP_STEP_MS;
      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        onDesignModeStateChangeRef.current?.({
          hoverTarget: "cta",
          cursorTransitionMs: DESIGN_MODE_CURSOR_SWEEP_TRANSITION_MS,
        });
      }, cursorAt);

      cursorAt += DESIGN_MODE_HOVER_STEP_MS;
      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        onDesignModeStateChangeRef.current?.({
          hoverTarget: "headline",
          cursorTransitionMs: DESIGN_MODE_CURSOR_RETURN_TRANSITION_MS,
        });
      }, cursorAt);

      cursorAt += DESIGN_MODE_SELECT_MS;
      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        onDesignModeStateChangeRef.current?.({
          hoverTarget: null,
          selectedTarget: "headline",
          showCursor: false,
        });
        setBrowserElementAttachments([designElementAttachment]);
      }, cursorAt);

      for (let index = 0; index < userPrompt.length; index += 1) {
        scheduleDemo(
          () => {
            if (interruptedRef.current) {
              return;
            }
            setComposer(userPrompt.slice(0, index + 1));
          },
          cursorAt + DESIGN_MODE_TYPE_SPEED_MS * (index + 1),
        );
      }

      const submitAt =
        cursorAt + DESIGN_MODE_TYPE_SPEED_MS * userPrompt.length + DESIGN_MODE_SEND_DELAY_MS;
      const userMessageId = allocateMessageId();
      const thinkingMessageId = allocateMessageId();
      const editToolCallId = `tool-${allocateMessageId()}`;
      const assistantMessageId = allocateMessageId();

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setBusy(true);
        onDesignModeStateChangeRef.current?.({ pickerActive: false, selectedTarget: null });
        setMessages((current) => [
          ...current,
          {
            id: userMessageId,
            role: "user",
            content: userPrompt,
            browserElements: [
              {
                id: designElementAttachment.id,
                tagName: designElementAttachment.tagName,
                url: designElementAttachment.pageUrl,
                pageUrl: designElementAttachment.pageUrl,
              },
            ],
            pending: false,
          },
        ]);
        setComposer("");
        setBrowserElementAttachments([]);
      }, submitAt);

      const thinkingStartAt = submitAt + DESIGN_MODE_THINKING_START_DELAY_MS;
      const thinkingCompleteAt = scheduleThinkingStream(
        thinkingMessageId,
        designDemoCopy.demoThinkingText,
        thinkingStartAt,
        DESIGN_MODE_THINKING_STREAM_SPEED_MS,
      );
      const thinkingSettleAt = thinkingCompleteAt + 160;
      const editToolStartAt = thinkingSettleAt + 120;
      const editToolSuccessAt =
        editToolStartAt +
        (DESIGN_MODE_EDIT_TOOL_SUCCESS_DELAY_MS - DESIGN_MODE_EDIT_TOOL_START_DELAY_MS);
      const headlineUpdateAt = editToolSuccessAt + 120;
      const assistantStartAt =
        headlineUpdateAt +
        DESIGN_MODE_HEADLINE_CROSSFADE_MS +
        DESIGN_MODE_ASSISTANT_STREAM_START_DELAY_MS;

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === thinkingMessageId ? { ...message, pending: false } : message,
          ),
        );
      }, thinkingSettleAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) => [
          ...current,
          {
            id: allocateMessageId(),
            role: "assistant",
            content: "",
            tool: buildDesignModeEditRunningTool(editToolCallId, designDemoCopy),
            pending: false,
          },
        ]);
      }, editToolStartAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.tool?.toolCallId === editToolCallId
              ? {
                  ...message,
                  tool: buildDesignModeEditSucceededTool(editToolCallId, designDemoCopy),
                }
              : message,
          ),
        );
      }, editToolSuccessAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        onDesignModeStateChangeRef.current?.({ headlineVariant: "improved" });
      }, headlineUpdateAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) => [
          ...current,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            pending: true,
          },
        ]);
      }, assistantStartAt);

      for (let index = 0; index < designDemoCopy.demoAssistantResponse.length; index += 1) {
        scheduleDemo(
          () => {
            if (interruptedRef.current) {
              return;
            }
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      content: designDemoCopy.demoAssistantResponse.slice(0, index + 1),
                    }
                  : message,
              ),
            );
          },
          assistantStartAt + DESIGN_MODE_ASSISTANT_STREAM_SPEED_MS * (index + 1),
        );
      }

      const completeAt =
        assistantStartAt +
        DESIGN_MODE_ASSISTANT_STREAM_SPEED_MS * designDemoCopy.demoAssistantResponse.length +
        320;

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId ? { ...message, pending: false } : message,
          ),
        );
        setBusy(false);
      }, completeAt);

      scheduleDemo(() => {
        if (interruptedRef.current) {
          return;
        }
        demoActiveRef.current = false;
        interruptedRef.current = false;
        clearDemoTimers();
        beginDesignModeDemo();
      }, completeAt + DESIGN_MODE_DEMO_RESTART_DELAY_MS);
    };

    const beginDemo =
      demoVariant === "agentPlan"
        ? beginAgentPlanDemo
        : demoVariant === "designMode"
          ? beginDesignModeDemo
          : beginDefaultDemo;

    startDemoCycleRef.current = () => {
      clearDemoTimers();
      const startDelay =
        demoVariant === "agentPlan"
          ? AGENT_PLAN_DEMO_START_DELAY_MS
          : demoVariant === "designMode"
            ? DESIGN_MODE_DEMO_START_DELAY_MS
            : DEMO_START_DELAY_MS;
      scheduleDemo(beginDemo, startDelay);
    };

    startDemoCycleRef.current();

    return () => {
      interruptedRef.current = true;
      demoActiveRef.current = false;
      clearDemoTimers();
      clearManualResponseTimer();
      clearResumeTimer();
      startDemoCycleRef.current = null;
    };
  }, [conversationCopy, demoPlaybackActive, demoStaticSnapshot, demoVariant, locale]);

  const isEmptySession = messages.length === 0;

  return (
    <div
      ref={rootRef}
      data-spirit-surface="conversation-stage"
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col",
        nestedPreview ? "text-xs" : "text-sm",
        baseToneClassName ?? "bg-background",
      )}
    >
      {!isEmptySession ? (
        <ScrollArea
          ref={scrollAreaRef}
          data-spirit-surface="conversation-scroll"
          className={cn("min-h-0 flex-1", baseToneClassName ?? "bg-background")}
          type="hover"
          scrollHideDelay={450}
        >
          <div
            data-spirit-surface="conversation-scroll-body"
            className={cn(
              "min-h-full w-full pb-[calc(11rem+env(safe-area-inset-bottom,0px))]",
              baseToneClassName ?? "bg-background",
            )}
          >
            <div
              data-spirit-surface="conversation-list-shell"
              className={cn(
                "mx-auto w-full overflow-x-hidden pt-6 sm:pt-7",
                CONVERSATION_GUTTER_X,
                CONVERSATION_MAX_W,
              )}
            >
              <div data-spirit-surface="conversation-list" className="space-y-3">
                {messages.map((message, index) => (
                  <PreviewMessageCard
                    key={conversationMessageDomId(message, index)}
                    listIndex={index}
                    message={message}
                    conversationMessages={messages}
                    thinkingPolicy={demoVariant === "agentPlan" ? "firstTurnOnly" : "always"}
                    compactAfterPrevious={shouldCompactAfterPreviousMessage(
                      messages[index - 1],
                      message,
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      ) : null}

      <div
        data-spirit-surface="composer-dock"
        className={cn(
          "pointer-events-none absolute inset-x-0 z-10 bg-transparent",
          isEmptySession
            ? cn(
                nestedPreview
                  ? "inset-y-0 flex flex-col items-center justify-center gap-2 pb-3"
                  : "inset-y-0 flex items-center justify-center pb-[env(safe-area-inset-bottom,0px)]",
                CONVERSATION_GUTTER_X,
              )
            : "bottom-0 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]",
        )}
      >
        <div
          className={cn(
            "pointer-events-auto mx-auto w-full",
            nestedPreview ? "max-w-[92%] space-y-1.5" : "space-y-2",
            CONVERSATION_GUTTER_X,
            CONVERSATION_MAX_W,
          )}
        >
          {isEmptySession ? (
            <div data-spirit-surface="conversation-empty">
              <p
                className={cn(
                  `text-center ${FONT_WEIGHT_NORMAL} tracking-tight text-foreground`,
                  nestedPreview ? "mb-1 text-lg leading-snug" : "mb-6 text-2xl sm:text-3xl",
                )}
              >
                {conversationCopy.emptyTitle}
              </p>
            </div>
          ) : null}

          {isEmptySession ? (
            <EmptyStateWorkspaceSelector
              currentWorkspaceRoot={workspaceRoot}
              workspaceBinding="project"
              availableWorkspaces={availableWorkspaces}
              disabled={busy}
              onSelectWorkspace={handleSelectWorkspace}
              onSelectNoWorkspace={() => undefined}
              onAddWorkspace={handleAddWorkspaceClick}
            />
          ) : null}

          <div className="grid gap-1.5">
            <UiPreviewProviders>
              <ComposerSurface
                segments={composerSegments}
                localFileAttachments={[]}
                onSegmentsChange={handleComposerChange}
                onSubmit={handleManualSubmit}
                placeholder={conversationCopy.composerPlaceholder}
                models={models}
                catalogHints={catalogHints}
                activeModel={activeModelRef}
                agentMode={planMode ? "plan" : "agent"}
                loopEnabled={false}
                canSend={
                  (composer.trim().length > 0 || browserElementAttachments.length > 0) && !busy
                }
                busy={busy}
                onModelSelect={(ref) => handleModelSelect(ref.name)}
                onModelReasoningEffortSelect={() => {}}
                onAgentModeChange={(mode) => handlePlanModeSelect(mode === "plan")}
                browserElementAttachments={browserElementAttachments}
                onElementAttachmentsChange={setBrowserElementAttachments}
              />
            </UiPreviewProviders>
          </div>
        </div>
      </div>
    </div>
  );
}
