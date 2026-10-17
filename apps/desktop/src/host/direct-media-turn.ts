import { randomUUID } from "node:crypto";

import {
  createLlmMessageContentFromText,
  createLlmTransport,
  createToolExecutionTextOutput,
  DEFAULT_IMAGE_GENERATION_SIZE,
  type ImageGenerationRequest,
  type RuntimeEvent,
  type RuntimeToolExecution,
  type StoredLlmMessageArchiveEntry,
  type ToolExecutionOutput,
} from "@spiritagent/agent-core";

import i18n from "../lib/i18n-host.js";
import {
  resolveComposerDirectMediaTool,
  type DirectMediaTool,
} from "../lib/composer-direct-media.js";
import type { LlmTransportConfig } from "@spiritagent/agent-core";

import type { DesktopToolRequest } from "./contracts.js";
import {
  modelCapabilitiesFromConfig,
  type DirectMediaTool as HostDirectMediaTool,
} from "./model-config.js";
import type { SessionBundle } from "./session-bundle.js";
import { isWorktreeBootstrapInFlight } from "./worktree-bootstrap-card.js";
import { syncRuntimeHistoryFromBundleArchive } from "./conversation-continuation.js";
import type { SessionTurnOrchestratorContext } from "./session-turn-orchestrator.js";
import type { DesktopConfigFile } from "./storage.js";
import type { ModelProfileSnapshot, ModelRef } from "../types.js";
import { flattenProviders, resolveModelProfile } from "./model-config-access.js";
import type { DesktopToolExecutor } from "./tool-executor.js";

export interface DirectMediaTurnInput {
  bundle: SessionBundle;
  toolName: HostDirectMediaTool;
  prompt: string;
  userMessageId: number;
  beforeUserCheckpoint: unknown;
}

/**
 * Media-only turn shell: the resolved profile carries the materialized apiBase; the generation
 * backend reads the `imageGeneration` / `videoGeneration` sub-config off the transport config.
 */
function buildMediaOnlyTransportConfig(
  toolName: DirectMediaTool,
  input: { profile: ModelProfileSnapshot; apiKey: string },
): LlmTransportConfig {
  const subConfig = {
    apiKey: input.apiKey,
    model: input.profile.name,
    baseUrl: input.profile.apiBase,
    ...(input.profile.capabilities
      ? { modelCapabilities: modelCapabilitiesFromConfig(input.profile.capabilities) }
      : {}),
  };
  const shell = {
    transportKind: "openai-compatible" as const,
    apiKey: input.apiKey,
    model: input.profile.name,
    baseUrl: input.profile.apiBase,
  };
  if (toolName === "generate_image") {
    return { ...shell, imageGeneration: subConfig } as LlmTransportConfig;
  }
  return { ...shell, videoGeneration: subConfig } as LlmTransportConfig;
}

function buildMediaToolRequest(toolName: DirectMediaTool, prompt: string): DesktopToolRequest {
  if (toolName === "generate_image") {
    return { name: "generate_image", prompt };
  }
  return { name: "generate_video", prompt };
}

function buildMediaToolExecution(
  toolCallId: string,
  toolName: DirectMediaTool,
  request: DesktopToolRequest,
  output: ToolExecutionOutput,
  failed: boolean,
): RuntimeToolExecution<DesktopToolRequest> {
  const artifacts: RuntimeToolExecution<DesktopToolRequest>["artifacts"] = [];
  for (const part of output.content) {
    if (part.type === "image") {
      artifacts.push({ kind: "image", path: part.path });
      continue;
    }
    if (part.type === "video") {
      artifacts.push({ kind: "video", path: part.path });
    }
  }

  return {
    toolCallId,
    toolName,
    request,
    output: output.summaryText,
    failed,
    ...(artifacts.length > 0 ? { artifacts } : {}),
  };
}

export function appendDirectMediaTurnToArchive(
  bundle: SessionBundle,
  input: {
    prompt: string;
    toolCallId: string;
    toolName: DirectMediaTool;
    request: DesktopToolRequest;
    summaryText: string;
  },
): void {
  const userEntry: StoredLlmMessageArchiveEntry = {
    role: "user",
    content: createLlmMessageContentFromText(input.prompt),
  };
  const assistantEntry: StoredLlmMessageArchiveEntry = {
    role: "assistant",
    content: createLlmMessageContentFromText(""),
    toolCalls: [
      {
        id: input.toolCallId,
        name: input.toolName,
        argumentsJson: JSON.stringify(input.request),
      },
    ],
  };
  const toolEntry: StoredLlmMessageArchiveEntry = {
    role: "tool",
    content: createLlmMessageContentFromText(input.summaryText),
    toolCallId: input.toolCallId,
  };

  bundle.archiveHistory = [...bundle.archiveHistory, userEntry, assistantEntry, toolEntry];
}

function renderDirectMediaError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}

export function isSessionBundleBusy(bundle: SessionBundle | undefined): boolean {
  if (!bundle) {
    return false;
  }
  if (bundle.directMediaTurnInFlight === true) {
    return true;
  }
  if (isWorktreeBootstrapInFlight(bundle.pendingWorktreeBootstrap)) {
    return true;
  }
  return bundle.runtime?.isBusy() === true;
}

export function beginDirectMediaTurn(
  ctx: SessionTurnOrchestratorContext,
  input: DirectMediaTurnInput & { toolCallId: string },
): DesktopToolRequest {
  const request = buildMediaToolRequest(input.toolName, input.prompt);
  const startedEvent: RuntimeEvent<DesktopToolRequest> = {
    kind: "tool-call-started",
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    request,
  };
  ctx.orchestrationFor(input.bundle).runtimeEvents.applyRuntimeHostEvents([startedEvent]);
  input.bundle.messages = input.bundle.messageTimeline.toMessages();
  input.bundle.directMediaTurnInFlight = true;
  return request;
}

async function validateDirectMediaTurnSetup(
  ctx: SessionTurnOrchestratorContext,
  input: DirectMediaTurnInput,
): Promise<void> {
  const config = ctx.requireConfig();
  const profile = resolveModelProfile(config, config.activeModel);
  if (!profile) {
    throw new Error(i18n.t("error.modelNotFound", { model: config.activeModel.name }));
  }

  const apiKey = await ctx.resolveApiKeyForConfigModel(profile.ref);
  if (!apiKey) {
    throw new Error(i18n.t("error.apiKeyNotConfigured"));
  }

  await ctx.ensureToolExecutor(input.bundle);
}

async function runDirectMediaGeneration(
  ctx: SessionTurnOrchestratorContext,
  input: DirectMediaTurnInput,
  toolCallId: string,
  request: DesktopToolRequest,
): Promise<void> {
  const config = ctx.requireConfig();
  const profile = resolveModelProfile(config, config.activeModel);
  if (!profile) {
    throw new Error(i18n.t("error.modelNotFound", { model: config.activeModel.name }));
  }

  const apiKey = await ctx.resolveApiKeyForConfigModel(profile.ref);
  if (!apiKey) {
    throw new Error(i18n.t("error.apiKeyNotConfigured"));
  }

  const mediaTransportConfig = buildMediaOnlyTransportConfig(input.toolName, {
    profile,
    apiKey,
  });
  const toolExecutor = (await ctx.ensureToolExecutor(input.bundle)) as DesktopToolExecutor;
  const llmTransport = input.bundle.runtimeTransport ?? createLlmTransport();
  const orchestration = ctx.orchestrationFor(input.bundle);

  try {
    let output: ToolExecutionOutput;
    if (input.toolName === "generate_image") {
      const imageRequest: ImageGenerationRequest = {
        prompt: input.prompt,
        size: DEFAULT_IMAGE_GENERATION_SIZE,
      };
      output = await llmTransport.generateImage(mediaTransportConfig, imageRequest, (saveRequest) =>
        toolExecutor.saveGeneratedImage(saveRequest),
      );
    } else {
      output = await llmTransport.generateVideo(
        mediaTransportConfig,
        { prompt: input.prompt },
        (saveRequest) => toolExecutor.saveGeneratedVideo(saveRequest),
      );
    }

    const execution = buildMediaToolExecution(toolCallId, input.toolName, request, output, false);
    orchestration.runtimeEvents.applyRuntimeHostEvents([
      { kind: "tool-execution-finished", execution },
    ]);
    appendDirectMediaTurnToArchive(input.bundle, {
      prompt: input.prompt,
      toolCallId,
      toolName: input.toolName,
      request,
      summaryText: output.summaryText,
    });
  } catch (error) {
    const message = renderDirectMediaError(error);
    const failedOutput = createToolExecutionTextOutput(`${input.toolName} failed: ${message}`);
    const execution = buildMediaToolExecution(
      toolCallId,
      input.toolName,
      request,
      failedOutput,
      true,
    );
    orchestration.runtimeEvents.applyRuntimeHostEvents([
      { kind: "tool-execution-finished", execution },
    ]);
    appendDirectMediaTurnToArchive(input.bundle, {
      prompt: input.prompt,
      toolCallId,
      toolName: input.toolName,
      request,
      summaryText: failedOutput.summaryText,
    });
  }

  syncRuntimeHistoryFromBundleArchive(input.bundle);

  input.bundle.messages = input.bundle.messageTimeline.toMessages();
  await ctx.recordRewindCheckpoint(input.userMessageId, input.beforeUserCheckpoint);
  await ctx.persistSessionBundle(input.bundle, { bumpListSortAt: false });
}

async function finishDirectMediaTurn(
  ctx: SessionTurnOrchestratorContext,
  input: DirectMediaTurnInput,
  toolCallId: string,
  request: DesktopToolRequest,
): Promise<void> {
  try {
    await runDirectMediaGeneration(ctx, input, toolCallId, request);
    const orchestration = ctx.orchestrationFor(input.bundle);
    orchestration.runtimeEvents.syncPendingToolStates();
    orchestration.runtimeEvents.syncAssistantPrefixFromHistoryBeforeToolRow();
    await ctx.flushDeferredRuntimeRefreshIfIdle(input.bundle);
    await ctx.refreshTodoSnapshotForBundle(input.bundle);
    input.bundle.conversationRevision += 1;
    ctx.requestLiveSnapshotEmit();
    ctx.notifySessionListUpdated();
  } finally {
    input.bundle.directMediaTurnInFlight = false;
    input.bundle.currentTurnSkills = [];
  }
}

/** Runs a full direct-media turn synchronously (tests and legacy call paths). */
export async function executeDirectMediaTurn(
  ctx: SessionTurnOrchestratorContext,
  input: DirectMediaTurnInput,
): Promise<void> {
  const toolCallId = randomUUID();
  const request = beginDirectMediaTurn(ctx, { ...input, toolCallId });
  await finishDirectMediaTurn(ctx, input, toolCallId, request);
}

/**
 * Consistent with LLM streaming turns: validate and show the tool card, then return the snapshot immediately;
 * the long-running generateImage/generateVideo completes in the background without holding runSerialized.
 */
export async function startComposerDirectMediaTurn(
  ctx: SessionTurnOrchestratorContext,
  input: DirectMediaTurnInput,
): Promise<void> {
  await validateDirectMediaTurnSetup(ctx, input);
  const toolCallId = randomUUID();
  const request = beginDirectMediaTurn(ctx, { ...input, toolCallId });
  void finishDirectMediaTurn(ctx, input, toolCallId, request).catch((error) => {
    console.error("[desktop][composer-direct-media] background turn failed", error);
  });
}

export function shouldUseComposerDirectMediaTurn(
  config: DesktopConfigFile,
  activeModel: ModelRef,
  explicitWorkspaceFileCount: number,
): DirectMediaTool | null {
  const activeProfile = resolveModelProfile(config, activeModel);
  if (!activeProfile) {
    return null;
  }
  const directMediaTool = resolveComposerDirectMediaTool(activeModel, {
    models: flattenProviders(config).map((model) => ({
      name: model.name,
      capabilities: model.capabilities,
    })),
    imageGenerationModel: config.imageGenerationModel,
    videoGenerationModel: config.videoGenerationModel,
  });
  if (!directMediaTool) {
    return null;
  }
  if (explicitWorkspaceFileCount > 0) {
    console.warn("[desktop][composer-direct-media] attachments present; falling back to chat", {
      activeModel: activeProfile.name,
      tool: directMediaTool,
    });
    return null;
  }
  return directMediaTool;
}
