import { COMPACT_PROGRESS_TEXT } from "../../../../llm-context-block.js";
import {
  AgentRuntime,
  CompactExecutor,
  FinalTextTransport,
  HostExecutor,
  PollingManualBackgroundExecutor,
  ProgressManualCompactionTransport,
  appendScriptedToolResult,
  appendScriptedUserMessage,
  createLlmMessageContentFromText,
  createScriptedState,
  extractScriptedAssistantText,
  flushMicrotasks,
  truncateScriptedHistoryForCompaction,
  type RuntimeEvent,
  type RuntimeParityCaseResult,
  type ScriptedToolRequest,
} from "./harness.js";

export async function runManualToolsCase(): Promise<RuntimeParityCaseResult> {
  const manualBackgroundEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const manualCompactionEvents: RuntimeEvent<ScriptedToolRequest>[] = [];

  const hostRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new FinalTextTransport("MANUAL_GUIDANCE_OK"),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const manualAllowed = await hostRuntime.executeManualToolCommand("/tool read demo.txt");
  if (
    manualAllowed.kind !== "completed" ||
    manualAllowed.output !== "manual output for read_file"
  ) {
    throw new Error("manual tool allowed smoke did not complete.");
  }

  const manualApproval = await hostRuntime.executeManualToolCommand("/tool delete demo.txt");
  if (manualApproval.kind !== "requires-approval") {
    throw new Error("manual tool approval smoke did not enter approval.");
  }

  const manualGuidance = await hostRuntime.resumePendingManualToolApproval({
    kind: "guidance",
    userMessage: "Don't delete the file, give a summary first",
  });
  if (manualGuidance.kind !== "submitted-user-turn") {
    throw new Error("manual guidance smoke was not handed off as a user turn.");
  }
  if (
    manualGuidance.result.kind !== "completed" ||
    manualGuidance.result.assistantText !== "MANUAL_GUIDANCE_OK"
  ) {
    throw new Error("manual guidance smoke did not complete the final reply.");
  }

  const manualBackgroundExecutor = new PollingManualBackgroundExecutor();
  const manualBackgroundRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new FinalTextTransport("UNUSED_MANUAL_BACKGROUND"),
    toolExecutor: manualBackgroundExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => manualBackgroundEvents.push(event),
  });

  const manualBackgroundStarted = await manualBackgroundRuntime.startManualToolCommand(
    "/tool search runtime parity",
  );
  if (
    manualBackgroundStarted.kind !== "started-background" ||
    manualBackgroundStarted.statusText !== "Searching: runtime parity"
  ) {
    throw new Error("manual background smoke did not enter started-background.");
  }
  const manualBackgroundAux = manualBackgroundRuntime.pendingAuxState();
  if (
    !manualBackgroundAux ||
    manualBackgroundAux.kind !== "thinking" ||
    manualBackgroundAux.detailText !== "Searching: runtime parity"
  ) {
    throw new Error("manual background smoke did not expose the thinking aux state.");
  }
  if (manualBackgroundRuntime.takeCompletedManualToolCommandResult()) {
    throw new Error(
      "manual background smoke should not produce a result before the background tool finishes.",
    );
  }

  manualBackgroundExecutor.finish("manual output for grep");
  let manualBackgroundCompleted;
  for (let index = 0; index < 8; index += 1) {
    await flushMicrotasks(4);
    await manualBackgroundRuntime.poll();
    manualBackgroundCompleted = manualBackgroundRuntime.takeCompletedManualToolCommandResult();
    if (manualBackgroundCompleted) {
      break;
    }
  }
  if (
    !manualBackgroundCompleted ||
    manualBackgroundCompleted.output !== "manual output for grep" ||
    !manualBackgroundCompleted.backgroundExecution ||
    manualBackgroundCompleted.failed
  ) {
    throw new Error("manual background smoke did not get the background tool completion result.");
  }
  if (
    !manualBackgroundEvents.some(
      (event) => event.kind === "background-tool-status" && event.phase === "started",
    ) ||
    !manualBackgroundEvents.some(
      (event) => event.kind === "background-tool-status" && event.phase === "finished",
    )
  ) {
    throw new Error("manual background smoke is missing the complete background status events.");
  }

  const manualCompactionTransport = new ProgressManualCompactionTransport();
  const manualCompactionRuntime = new AgentRuntime(
    {
      config: undefined,
      llmTransport: manualCompactionTransport,
      toolExecutor: new CompactExecutor(),
      createToolAgentState: createScriptedState,
      appendToolResultMessage: appendScriptedToolResult,
      appendUserMessage: appendScriptedUserMessage,
      extractAssistantText: extractScriptedAssistantText,
      truncateHistoryForCompaction: truncateScriptedHistoryForCompaction,
      onEvent: (event) => manualCompactionEvents.push(event),
    },
    [
      {
        role: "assistant",
        content: [],
        toolCalls: [{ id: "call-old-manual", name: "read_file", argumentsJson: "{}" }],
      },
      {
        role: "tool",
        toolCallId: "call-old-manual",
        content: createLlmMessageContentFromText("old tool output\n" + "x".repeat(5000)),
      },
      {
        role: "assistant",
        content: createLlmMessageContentFromText("Old answer."),
      },
      {
        role: "user",
        content: createLlmMessageContentFromText("Please compact the context for me."),
      },
    ],
  );

  await manualCompactionRuntime.startManualHistoryCompaction();
  await flushMicrotasks(4);
  await manualCompactionRuntime.poll();
  const manualCompactionAux = manualCompactionRuntime.pendingAuxState();
  if (!manualCompactionAux || manualCompactionAux.kind !== "compacting") {
    throw new Error("manual compaction smoke did not expose the compacting aux state.");
  }
  if (manualCompactionRuntime.takeCompletedManualHistoryCompactionResult()) {
    throw new Error(
      "manual compaction smoke should not produce a result before compaction finishes.",
    );
  }

  manualCompactionTransport.finishCompaction();
  let manualCompactionCompleted;
  for (let index = 0; index < 8; index += 1) {
    await flushMicrotasks(4);
    await manualCompactionRuntime.poll();
    manualCompactionCompleted =
      manualCompactionRuntime.takeCompletedManualHistoryCompactionResult();
    if (manualCompactionCompleted) {
      break;
    }
  }
  if (
    !manualCompactionCompleted ||
    manualCompactionCompleted.kind !== "completed" ||
    manualCompactionCompleted.result.droppedMessages <= 0
  ) {
    throw new Error("manual compaction smoke did not get an effective compaction result.");
  }
  const drainedManualCompactionEvents = manualCompactionRuntime.drainEvents();
  if (!drainedManualCompactionEvents.some((event) => event.kind === "begin-assistant-response")) {
    throw new Error("manual compaction smoke is missing the begin event.");
  }
  if (
    !drainedManualCompactionEvents.some(
      (event) =>
        event.kind === "update-pending-assistant-compaction" &&
        event.text.includes(COMPACT_PROGRESS_TEXT),
    )
  ) {
    throw new Error("manual compaction smoke is missing the progress update event.");
  }
  if (
    !drainedManualCompactionEvents.some(
      (event) =>
        event.kind === "replace-pending-assistant" &&
        event.text.includes("Compaction complete: context messages"),
    )
  ) {
    throw new Error("manual compaction smoke is missing the completion notice event.");
  }
  if (
    !drainedManualCompactionEvents.some((event) => event.kind === "assistant-response-completed")
  ) {
    throw new Error("manual compaction smoke is missing the completed event.");
  }

  return {
    manualGuidance,
    manualBackgroundCompleted,
    manualCompactionCompleted,
    drainedManualCompactionEvents,
  };
}
