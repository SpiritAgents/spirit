import {
  AgentRuntime,
  BackgroundExecutor,
  CompactExecutor,
  HostExecutor,
  PollingBackgroundExecutor,
  StreamingApprovalExecutor,
  StreamingApprovalGuidanceTransport,
  StreamingApprovalImageExecutor,
  StreamingApprovalImageTransport,
  StreamingApprovalTransport,
  StreamingBackgroundRoundTransport,
  StreamingCompactionTransport,
  StreamingFailureTransport,
  StreamingStartRejectTransport,
  StreamingFinalTransport,
  StreamingTimeoutTransport,
  StreamingToolRoundTransport,
  SubagentExecutor,
  appendScriptedToolResult,
  appendScriptedUserLlmMessage,
  appendScriptedUserMessage,
  createLlmMessageContentFromText,
  createScriptedState,
  extractScriptedAssistantText,
  flushMicrotasks,
  historyAsPlainApiMessages,
  isJsonObject,
  llmMessageImagePaths,
  llmMessageTextContent,
  rebuildScriptedStateAfterCompaction,
  streamFromEvents,
  truncateScriptedHistoryForCompaction,
  truncateScriptedStateForContextRetry,
  type LlmMessage,
  type RuntimeEvent,
  type RuntimeParityCaseResult,
  type ScriptedState,
  type ScriptedToolRequest,
} from "./harness.js";
import type {
  JsonValue,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
  ToolExecutionOutput,
} from "../../../../ports.js";

export async function runStreamingCase(): Promise<RuntimeParityCaseResult> {
  const streamingEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingBackgroundEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingCompactionEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingApprovalEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingApprovalImageEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingApprovalThenImageEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingGuidanceEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const timeoutEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingFailureEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const previewEarlyExecutionEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const previewBackgroundDeferredEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const previewSubagentDeferredEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const authorizationFailureEvents: RuntimeEvent<ScriptedToolRequest>[] = [];

  const streamingRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingFinalTransport(),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingEvents.push(event),
  });

  await streamingRuntime.startUserTurnStreaming("Please stream the output");
  for (let index = 0; index < 24 && streamingRuntime.isBusy(); index += 1) {
    await flushMicrotasks(8);
    await streamingRuntime.poll();
  }

  if (streamingRuntime.isBusy()) {
    throw new Error("streaming final smoke did not finish within the expected rounds.");
  }

  const drainedStreamingEvents = streamingRuntime.drainEvents();
  if (!drainedStreamingEvents.some((event) => event.kind === "begin-assistant-response")) {
    throw new Error("streaming final smoke is missing the begin event.");
  }
  if (
    !drainedStreamingEvents.some(
      (event) =>
        event.kind === "update-pending-assistant-thinking" && event.text.includes("thinking..."),
    )
  ) {
    throw new Error("streaming final smoke is missing the thinking aggregation event.");
  }
  if (drainedStreamingEvents.filter((event) => event.kind === "assistant-chunk").length < 2) {
    throw new Error("streaming final smoke is missing assistant chunk events.");
  }
  if (!drainedStreamingEvents.some((event) => event.kind === "assistant-response-completed")) {
    throw new Error("streaming final smoke is missing the completed event.");
  }

  const previewEarlyExecutionTransport = new PreviewEarlyExecutionTransport();
  const previewEarlyExecutionExecutor = new CountingReadFileExecutor();
  const previewEarlyExecutionRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: previewEarlyExecutionTransport,
    toolExecutor: previewEarlyExecutionExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => previewEarlyExecutionEvents.push(event),
  });

  await previewEarlyExecutionRuntime.startUserTurnStreaming("Preview, then read the file");
  for (let index = 0; index < 8 && previewEarlyExecutionExecutor.executedCalls === 0; index += 1) {
    await flushMicrotasks(4);
    await previewEarlyExecutionRuntime.poll();
  }
  if (previewEarlyExecutionExecutor.executedCalls !== 1) {
    throw new Error(
      "preview early execution smoke did not execute the tool before the formal tool-calls completion.",
    );
  }
  if (previewEarlyExecutionTransport.toolCallRoundResolved) {
    throw new Error(
      "preview early execution smoke should not have resolved before the formal tool-calls completion.",
    );
  }
  if (
    !previewEarlyExecutionEvents.some(
      (event) =>
        event.kind === "tool-execution-finished" &&
        event.execution.toolCallId === "call-preview-read",
    )
  ) {
    throw new Error(
      "preview early execution smoke did not emit the tool completion event after the preview.",
    );
  }

  previewEarlyExecutionTransport.resolveToolCallRound();
  for (let index = 0; index < 16 && previewEarlyExecutionRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await previewEarlyExecutionRuntime.poll();
  }
  if (previewEarlyExecutionRuntime.isBusy()) {
    throw new Error("preview early execution smoke did not finish within the expected rounds.");
  }
  const previewEarlyExecutionResult = previewEarlyExecutionRuntime.takeCompletedTurnResult();
  if (
    !previewEarlyExecutionResult ||
    previewEarlyExecutionResult.kind !== "completed" ||
    previewEarlyExecutionResult.assistantText !== "PREVIEW_EARLY_OK"
  ) {
    throw new Error("preview early execution smoke did not complete the final assistant round.");
  }
  if (previewEarlyExecutionExecutor.executedCalls !== 1) {
    throw new Error("preview early execution smoke executed the tool more than once.");
  }
  const previewToolExecutions = previewEarlyExecutionResult.toolExecutions.filter(
    (execution) => execution.toolCallId === "call-preview-read",
  );
  if (previewToolExecutions.length !== 1) {
    throw new Error("preview early execution smoke did not reuse the preview-phase tool result.");
  }

  const previewBackgroundTransport = new PreviewBackgroundDeferredTransport();
  const previewBackgroundExecutor = new CountingBackgroundExecutor();
  const previewBackgroundRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: previewBackgroundTransport,
    toolExecutor: previewBackgroundExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => previewBackgroundDeferredEvents.push(event),
  });

  await previewBackgroundRuntime.startUserTurnStreaming("Preview, then search in the background");
  for (let index = 0; index < 8; index += 1) {
    await flushMicrotasks(4);
    await previewBackgroundRuntime.poll();
  }
  if (previewBackgroundExecutor.executedCalls !== 0) {
    throw new Error(
      "preview background smoke should not start the background tool before the formal tool-calls completion.",
    );
  }
  if (
    previewBackgroundDeferredEvents.some(
      (event) =>
        event.kind === "tool-call-started" && event.toolCallId === "call-preview-background",
    )
  ) {
    throw new Error(
      "preview background smoke should not emit tool-call-started before the formal path.",
    );
  }
  if (
    previewBackgroundDeferredEvents.some(
      (event) => event.kind === "background-tool-status" && event.toolName === "grep",
    )
  ) {
    throw new Error(
      "preview background smoke should not emit background status events before the formal path.",
    );
  }

  previewBackgroundTransport.resolveToolCallRound();
  for (let index = 0; index < 20 && previewBackgroundRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await previewBackgroundRuntime.poll();
  }
  if (previewBackgroundRuntime.isBusy()) {
    throw new Error("preview background smoke did not finish within the expected rounds.");
  }
  if (Number(previewBackgroundExecutor.executedCalls) !== 1) {
    throw new Error(
      "preview background smoke should execute the background tool exactly once on the formal path.",
    );
  }
  if (
    previewBackgroundDeferredEvents.filter(
      (event) =>
        event.kind === "tool-call-started" && event.toolCallId === "call-preview-background",
    ).length !== 1
  ) {
    throw new Error("preview background smoke formal path tool-call-started count is incorrect.");
  }

  const previewSubagentTransport = new PreviewSubagentDeferredTransport();
  const previewSubagentExecutor = new SubagentExecutor();
  const previewSubagentRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: previewSubagentTransport,
    toolExecutor: previewSubagentExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => previewSubagentDeferredEvents.push(event),
  });

  await previewSubagentRuntime.startUserTurnStreaming("Preview, then delegate to the subagent");
  for (let index = 0; index < 8; index += 1) {
    await flushMicrotasks(4);
    await previewSubagentRuntime.poll();
  }
  if (
    previewSubagentDeferredEvents.some(
      (event) => event.kind === "tool-call-started" && event.toolCallId === "call-preview-subagent",
    )
  ) {
    throw new Error(
      "preview subagent smoke should not emit tool-call-started before defer-to-formal.",
    );
  }

  previewSubagentTransport.resolveToolCallRound();
  for (let index = 0; index < 24 && previewSubagentRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await previewSubagentRuntime.poll();
  }
  if (previewSubagentRuntime.isBusy()) {
    throw new Error("preview subagent smoke did not finish within the expected rounds.");
  }
  if (previewSubagentExecutor.executedSubagentCalls !== 0) {
    throw new Error("preview subagent smoke incorrectly fell through to host execute.");
  }
  if (
    previewSubagentDeferredEvents.filter(
      (event) => event.kind === "tool-call-started" && event.toolCallId === "call-preview-subagent",
    ).length !== 1
  ) {
    throw new Error("preview subagent smoke tool-call-started should not be duplicated.");
  }

  const authorizationFailureRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new AuthorizationFailureTransport(),
    toolExecutor: new AuthorizationFailureExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => authorizationFailureEvents.push(event),
  });

  await authorizationFailureRuntime.startUserTurnStreaming("Read a nonexistent file");
  for (let index = 0; index < 12 && authorizationFailureRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await authorizationFailureRuntime.poll();
  }
  if (authorizationFailureRuntime.isBusy()) {
    throw new Error("authorization failure smoke did not finish within the expected rounds.");
  }

  const drainedAuthorizationFailureEvents = authorizationFailureRuntime.drainEvents();
  if (
    !drainedAuthorizationFailureEvents.some(
      (event) => event.kind === "tool-call-started" && event.toolCallId === "call-stream-auth-fail",
    )
  ) {
    throw new Error("authorization failure smoke is missing the tool-call-started event.");
  }
  if (
    !drainedAuthorizationFailureEvents.some(
      (event) =>
        event.kind === "tool-execution-finished" &&
        event.execution.toolCallId === "call-stream-auth-fail" &&
        event.execution.failed &&
        event.execution.output.includes("[authorization error]"),
    )
  ) {
    throw new Error("authorization failure smoke is missing the failed tool completion event.");
  }

  const authorizationFailureResult = authorizationFailureRuntime.takeCompletedTurnResult();
  if (
    !authorizationFailureResult ||
    authorizationFailureResult.kind !== "completed" ||
    authorizationFailureResult.assistantText !== "AUTHORIZATION_FAILURE_OK"
  ) {
    throw new Error("authorization failure smoke did not complete the final reply.");
  }
  if (
    !authorizationFailureResult.toolExecutions.some(
      (execution) =>
        execution.toolCallId === "call-stream-auth-fail" &&
        execution.failed &&
        execution.output.includes("[authorization error]"),
    )
  ) {
    throw new Error("authorization failure smoke did not record the failed tool execution.");
  }
  if (
    !authorizationFailureRuntime
      .history()
      .some(
        (message) =>
          message.role === "assistant" &&
          message.toolCalls?.some(
            (toolCall) =>
              toolCall.id === "call-stream-auth-fail" &&
              toolCall.name === "read_file" &&
              toolCall.argumentsJson === '{"path":"D:\\Spirit\\apps\\cli\\src\\tool_runtime.rs"}',
          ),
      )
  ) {
    throw new Error(
      "authorization failure smoke did not write the assistant tool call parent message into llmHistory.",
    );
  }
  if (
    !authorizationFailureRuntime
      .history()
      .some(
        (message) =>
          message.role === "tool" &&
          message.toolCallId === "call-stream-auth-fail" &&
          llmMessageTextContent(message.content).includes("[authorization error]"),
      )
  ) {
    throw new Error(
      "authorization failure smoke did not write the failed tool result into llmHistory.",
    );
  }

  if (
    !authorizationFailureRuntime
      .toArchive([], [])
      .llmHistory.some(
        (message) =>
          message.role === "assistant" &&
          "toolCalls" in message &&
          Array.isArray(message.toolCalls) &&
          message.toolCalls.some(
            (toolCall) =>
              toolCall.id === "call-stream-auth-fail" &&
              toolCall.name === "read_file" &&
              toolCall.argumentsJson === '{"path":"D:\\Spirit\\apps\\cli\\src\\tool_runtime.rs"}',
          ),
      )
  ) {
    throw new Error(
      "authorization failure smoke did not write the assistant tool call parent message into the archive.",
    );
  }

  const timeoutRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingTimeoutTransport(),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => timeoutEvents.push(event),
  });

  await timeoutRuntime.startUserTurnStreaming("Please wait for the timeout");
  await flushMicrotasks();
  await timeoutRuntime.poll();
  timeoutRuntime.handleStreamStallTimeout(Date.now() + 25_000);
  const drainedTimeoutEvents = timeoutRuntime.drainEvents();
  if (
    !drainedTimeoutEvents.some(
      (event) => event.kind === "assistant-chunk" && event.text.includes("[stream timeout]"),
    )
  ) {
    throw new Error("stream timeout smoke did not produce a timeout chunk.");
  }
  if (!drainedTimeoutEvents.some((event) => event.kind === "assistant-response-completed")) {
    throw new Error("stream timeout smoke did not complete the pending response.");
  }
  if (timeoutRuntime.pendingUserTurn() !== undefined) {
    throw new Error("stream timeout smoke did not clear the pending user turn after finishing.");
  }

  const streamingFailureRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingFailureTransport(),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingFailureEvents.push(event),
  });

  await streamingFailureRuntime.startUserTurnStreaming("Please trigger a streaming failure");
  for (let index = 0; index < 8 && streamingFailureRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingFailureRuntime.poll();
  }
  if (streamingFailureRuntime.isBusy()) {
    throw new Error("streaming failure smoke did not finish within the expected rounds.");
  }
  if (streamingFailureRuntime.pendingUserTurn() !== undefined) {
    throw new Error("streaming failure smoke did not clear the pending user turn after finishing.");
  }
  const drainedStreamingFailureEvents = streamingFailureRuntime.drainEvents();
  if (
    !drainedStreamingFailureEvents.some(
      (event) =>
        event.kind === "replace-pending-assistant" &&
        event.text.includes("invalid chat setting (2013)"),
    )
  ) {
    throw new Error("streaming failure smoke did not output the expected error message.");
  }
  if (
    !drainedStreamingFailureEvents.some((event) => event.kind === "assistant-response-completed")
  ) {
    throw new Error("streaming failure smoke is missing the completed event.");
  }

  const streamingStartRejectEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const streamingStartRejectRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingStartRejectTransport(),
    toolExecutor: new HostExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingStartRejectEvents.push(event),
  });

  await streamingStartRejectRuntime.startUserTurnStreaming("Please trigger a start rejection");
  for (let index = 0; index < 8 && streamingStartRejectRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingStartRejectRuntime.poll();
  }
  if (streamingStartRejectRuntime.isBusy()) {
    throw new Error("streaming start-reject smoke stayed busy after the transport rejected.");
  }
  if (streamingStartRejectRuntime.pendingUserTurn() !== undefined) {
    throw new Error(
      "streaming start-reject smoke did not clear the pending user turn after finishing.",
    );
  }
  const drainedStreamingStartRejectEvents = streamingStartRejectRuntime.drainEvents();
  const streamingStartRejectResult = streamingStartRejectRuntime.takeCompletedTurnResult();
  if (
    !streamingStartRejectResult ||
    streamingStartRejectResult.kind !== "failed" ||
    !streamingStartRejectResult.error.includes("Video upload failed (400)")
  ) {
    throw new Error("streaming start-reject smoke did not surface the transport start error.");
  }
  if (
    !drainedStreamingStartRejectEvents.some(
      (event) => event.kind === "assistant-response-completed",
    )
  ) {
    throw new Error("streaming start-reject smoke is missing the completed event.");
  }

  const streamingApprovalExecutor = new StreamingApprovalExecutor();
  const streamingApprovalRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingApprovalTransport(),
    toolExecutor: streamingApprovalExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingApprovalEvents.push(event),
  });

  await streamingApprovalRuntime.startUserTurnStreaming("Approve in streaming mode, then continue");
  await flushMicrotasks(4);
  await streamingApprovalRuntime.poll();
  if (!streamingApprovalRuntime.hasPendingApproval()) {
    throw new Error("streaming approval smoke did not enter the pending-approval state.");
  }

  await streamingApprovalRuntime.continuePendingApproval({ kind: "allow" });
  for (let index = 0; index < 12 && streamingApprovalRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingApprovalRuntime.poll();
  }
  if (streamingApprovalRuntime.isBusy()) {
    throw new Error("streaming approval smoke did not finish within the expected rounds.");
  }

  const drainedStreamingApprovalEvents = streamingApprovalRuntime.drainEvents();
  if (
    drainedStreamingApprovalEvents.filter((event) => event.kind === "begin-assistant-response")
      .length < 2
  ) {
    throw new Error(
      "streaming approval smoke should contain two begin events, before and after approval.",
    );
  }
  if (
    !drainedStreamingApprovalEvents.some(
      (event) => event.kind === "approval-requested" && event.approval.toolName === "create_file",
    )
  ) {
    throw new Error("streaming approval smoke is missing the approval-requested event.");
  }
  if (
    !drainedStreamingApprovalEvents.some(
      (event) => event.kind === "assistant-chunk" && event.text === "STREAM_APPROVAL_",
    )
  ) {
    throw new Error(
      "streaming approval smoke is missing the streaming chunk after approval resume.",
    );
  }
  if (streamingApprovalExecutor.executedCalls !== 1) {
    throw new Error("streaming approval smoke tool execution count is incorrect.");
  }
  const streamingApprovalTrace = streamingApprovalRuntime.requestTrace();
  if (
    !streamingApprovalTrace.some(
      (trace) => isJsonObject(trace) && trace.mode === "streaming-approval-round-2",
    )
  ) {
    throw new Error(
      "streaming approval smoke is missing the streaming trace after approval resume.",
    );
  }
  if (
    streamingApprovalTrace.some(
      (trace) => isJsonObject(trace) && trace.mode === "streaming-approval-sync-fallback",
    )
  ) {
    throw new Error("streaming approval smoke incorrectly fell back to a non-streaming round.");
  }

  const streamingApprovalImageExecutor = new StreamingApprovalImageExecutor();
  const streamingApprovalImageRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingApprovalImageTransport(),
    toolExecutor: streamingApprovalImageExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    appendUserLlmMessage: appendScriptedUserLlmMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingApprovalImageEvents.push(event),
  });

  await streamingApprovalImageRuntime.startUserTurnStreaming("Approve, then read the image");
  await flushMicrotasks(4);
  await streamingApprovalImageRuntime.poll();
  if (!streamingApprovalImageRuntime.hasPendingApproval()) {
    throw new Error("streaming approval image smoke did not enter the pending-approval state.");
  }

  await streamingApprovalImageRuntime.continuePendingApproval({ kind: "allow" });
  for (let index = 0; index < 12 && streamingApprovalImageRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingApprovalImageRuntime.poll();
  }
  if (streamingApprovalImageRuntime.isBusy()) {
    throw new Error("streaming approval image smoke did not finish within the expected rounds.");
  }

  const drainedStreamingApprovalImageEvents = streamingApprovalImageRuntime.drainEvents();
  if (
    drainedStreamingApprovalImageEvents.filter((event) => event.kind === "begin-assistant-response")
      .length < 2
  ) {
    throw new Error(
      "streaming approval image smoke should contain two begin events, before and after approval.",
    );
  }
  if (
    !drainedStreamingApprovalImageEvents.some(
      (event) => event.kind === "approval-requested" && event.approval.toolName === "read_file",
    )
  ) {
    throw new Error("streaming approval image smoke is missing the approval-requested event.");
  }
  if (
    !drainedStreamingApprovalImageEvents.some(
      (event) => event.kind === "assistant-chunk" && event.text === "STREAM_APPROVAL_IMAGE_",
    )
  ) {
    throw new Error(
      "streaming approval image smoke is missing the streaming chunk after approval resume.",
    );
  }
  if (streamingApprovalImageExecutor.executedCalls !== 1) {
    throw new Error("streaming approval image smoke tool execution count is incorrect.");
  }
  const streamingApprovalImageTrace = streamingApprovalImageRuntime.requestTrace();
  if (
    !streamingApprovalImageTrace.some(
      (trace) => isJsonObject(trace) && trace.mode === "streaming-approval-image-round-2",
    )
  ) {
    throw new Error(
      "streaming approval image smoke is missing the streaming trace after approval resume.",
    );
  }
  if (
    streamingApprovalImageTrace.some(
      (trace) => isJsonObject(trace) && trace.mode === "streaming-approval-image-sync-fallback",
    )
  ) {
    throw new Error(
      "streaming approval image smoke incorrectly fell back to a non-streaming round.",
    );
  }
  if (
    !streamingApprovalImageRuntime
      .history()
      .some(
        (message) =>
          message.role === "user" &&
          llmMessageTextContent(message.content).includes("[read image]") &&
          llmMessageImagePaths(message.content).includes("approved-image.png"),
      )
  ) {
    throw new Error(
      "streaming approval image smoke did not write the image projection into the history.",
    );
  }

  const streamingApprovalThenImageExecutor = new StreamingApprovalExecutor();
  let generateImageStarted: number = 0;
  let resolveApprovedImage: ((output: ToolExecutionOutput) => void) | undefined;
  const approvedImageOutput = new Promise<ToolExecutionOutput>((resolve) => {
    resolveApprovedImage = resolve;
  });
  const streamingApprovalThenImageRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingApprovalThenGenerateImageTransport(),
    toolExecutor: streamingApprovalThenImageExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    generateImage: async () => {
      generateImageStarted += 1;
      return approvedImageOutput;
    },
    onEvent: (event) => streamingApprovalThenImageEvents.push(event),
  });

  await streamingApprovalThenImageRuntime.startUserTurnStreaming(
    "Approve, then continue generating the image",
  );
  await flushMicrotasks(4);
  await streamingApprovalThenImageRuntime.poll();
  if (!streamingApprovalThenImageRuntime.hasPendingApproval()) {
    throw new Error(
      "streaming approval then image smoke did not enter the pending-approval state.",
    );
  }

  let approvalReturned = false;
  const continueApprovalPromise = streamingApprovalThenImageRuntime
    .continuePendingApproval({ kind: "allow" })
    .then(() => {
      approvalReturned = true;
    });
  await flushMicrotasks(32);
  if (!approvalReturned) {
    throw new Error(
      "streaming approval then image smoke should not wait for generate_image to finish before ending the approval resume.",
    );
  }
  await continueApprovalPromise;
  if (streamingApprovalThenImageRuntime.hasPendingApproval()) {
    throw new Error(
      "streaming approval then image smoke should clear the pending-approval state immediately after resume.",
    );
  }
  if (!streamingApprovalThenImageRuntime.isBusy()) {
    throw new Error(
      "streaming approval then image smoke should stay busy after the approval resume.",
    );
  }
  if (generateImageStarted !== 0) {
    throw new Error(
      "streaming approval then image smoke should not start generate_image directly inside continuePendingApproval.",
    );
  }

  const drainedApprovalThenImageEvents = streamingApprovalThenImageRuntime.drainEvents();
  if (
    !drainedApprovalThenImageEvents.some(
      (event) => event.kind === "approval-resolved" && event.toolName === "create_file",
    )
  ) {
    throw new Error("streaming approval then image smoke is missing the approval-resolved event.");
  }
  if (
    !drainedApprovalThenImageEvents.some(
      (event) =>
        event.kind === "tool-execution-finished" &&
        event.execution.toolName === "create_file" &&
        event.execution.output.includes("approved output for create_file"),
    )
  ) {
    throw new Error(
      "streaming approval then image smoke is missing the completion event for the approved tool.",
    );
  }
  if (
    drainedApprovalThenImageEvents.some(
      (event) =>
        event.kind === "tool-execution-finished" && event.execution.toolName === "generate_image",
    )
  ) {
    throw new Error(
      "streaming approval then image smoke should not finish generate_image early in the approval resume event batch.",
    );
  }

  let continuationPollReturned = false;
  const continuationPoll = streamingApprovalThenImageRuntime.poll().then(() => {
    continuationPollReturned = true;
  });
  await flushMicrotasks(32);
  if (Number(generateImageStarted) !== 1) {
    throw new Error("streaming approval then image smoke next poll should start generate_image.");
  }
  if (continuationPollReturned) {
    throw new Error(
      "streaming approval then image smoke continuation poll should not return early before generate_image finishes.",
    );
  }

  resolveApprovedImage?.({
    content: createLlmMessageContentFromText("[generated image] approval-follow-up ready"),
    summaryText: "[generated image] approval-follow-up ready",
  });
  await continuationPoll;

  for (let index = 0; index < 12 && streamingApprovalThenImageRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingApprovalThenImageRuntime.poll();
  }
  if (streamingApprovalThenImageRuntime.isBusy()) {
    throw new Error(
      "streaming approval then image smoke did not finish within the expected rounds.",
    );
  }

  const streamingApprovalThenImageResult =
    streamingApprovalThenImageRuntime.takeCompletedTurnResult();
  if (
    !streamingApprovalThenImageResult ||
    streamingApprovalThenImageResult.kind !== "completed" ||
    streamingApprovalThenImageResult.assistantText !== "STREAM_APPROVAL_THEN_IMAGE_OK"
  ) {
    throw new Error("streaming approval then image smoke did not complete the final reply.");
  }
  if (streamingApprovalThenImageExecutor.executedCalls !== 1) {
    throw new Error("streaming approval then image smoke host tool execution count is incorrect.");
  }
  if (
    !streamingApprovalThenImageResult.toolExecutions.some(
      (execution) =>
        execution.toolName === "generate_image" &&
        execution.output.includes("[generated image] approval-follow-up ready"),
    )
  ) {
    throw new Error(
      "streaming approval then image smoke did not record the generate_image result.",
    );
  }

  const streamingGuidanceExecutor = new StreamingApprovalExecutor();
  const streamingGuidanceRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingApprovalGuidanceTransport(),
    toolExecutor: streamingGuidanceExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingGuidanceEvents.push(event),
  });

  await streamingGuidanceRuntime.startUserTurnStreaming(
    "Approve in streaming mode, then switch to summarizing",
  );
  await flushMicrotasks(4);
  await streamingGuidanceRuntime.poll();
  if (!streamingGuidanceRuntime.hasPendingApproval()) {
    throw new Error("streaming guidance smoke did not enter the pending-approval state.");
  }

  await streamingGuidanceRuntime.continuePendingApproval({
    kind: "guidance",
    userMessage: "Do not write the file, just summarize",
  });
  for (let index = 0; index < 12 && streamingGuidanceRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingGuidanceRuntime.poll();
  }
  if (streamingGuidanceRuntime.isBusy()) {
    throw new Error("streaming guidance smoke did not finish within the expected rounds.");
  }

  const drainedStreamingGuidanceEvents = streamingGuidanceRuntime.drainEvents();
  if (
    drainedStreamingGuidanceEvents.filter((event) => event.kind === "begin-assistant-response")
      .length < 2
  ) {
    throw new Error(
      "streaming guidance smoke should contain two begin events, before and after approval.",
    );
  }
  if (
    !drainedStreamingGuidanceEvents.some(
      (event) => event.kind === "approval-requested" && event.approval.toolName === "create_file",
    )
  ) {
    throw new Error("streaming guidance smoke is missing the approval-requested event.");
  }
  if (
    !drainedStreamingGuidanceEvents.some(
      (event) => event.kind === "assistant-chunk" && event.text === "STREAM_GUIDANCE_",
    )
  ) {
    throw new Error(
      "streaming guidance smoke is missing the streaming chunk after approval resume.",
    );
  }
  if (streamingGuidanceExecutor.executedCalls !== 1) {
    throw new Error("streaming guidance smoke should continue executing the queued tools.");
  }
  const streamingGuidanceTrace = streamingGuidanceRuntime.requestTrace();
  if (
    !streamingGuidanceTrace.some(
      (trace) => isJsonObject(trace) && trace.mode === "streaming-guidance-round-2",
    )
  ) {
    throw new Error(
      "streaming guidance smoke is missing the streaming trace after approval resume.",
    );
  }
  if (
    streamingGuidanceTrace.some(
      (trace) => isJsonObject(trace) && trace.mode === "streaming-guidance-sync-fallback",
    )
  ) {
    throw new Error("streaming guidance smoke incorrectly fell back to a non-streaming round.");
  }

  const streamingBackgroundExecutor = new PollingBackgroundExecutor();
  const streamingBackgroundRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new StreamingBackgroundRoundTransport(),
    toolExecutor: streamingBackgroundExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
    onEvent: (event) => streamingBackgroundEvents.push(event),
  });

  await streamingBackgroundRuntime.startUserTurnStreaming(
    "Use the background tool in streaming mode",
  );
  await flushMicrotasks(4);
  await streamingBackgroundRuntime.poll();
  if (!streamingBackgroundRuntime.isBusy()) {
    throw new Error("streaming background smoke should stay busy while the background tool runs.");
  }
  const streamingBackgroundAux = streamingBackgroundRuntime.pendingAuxState();
  if (
    !streamingBackgroundAux ||
    streamingBackgroundAux.kind !== "thinking" ||
    streamingBackgroundAux.detailText !== "Searching: runtime parity"
  ) {
    throw new Error("streaming background smoke did not expose the thinking aux state.");
  }

  streamingBackgroundExecutor.finish('background result for {"query":"runtime parity"}');
  for (let index = 0; index < 12 && streamingBackgroundRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingBackgroundRuntime.poll();
  }
  if (streamingBackgroundRuntime.isBusy()) {
    throw new Error("streaming background smoke did not finish within the expected rounds.");
  }
  const drainedStreamingBackgroundEvents = streamingBackgroundRuntime.drainEvents();
  if (
    drainedStreamingBackgroundEvents.filter((event) => event.kind === "begin-assistant-response")
      .length < 2
  ) {
    throw new Error("streaming background smoke should contain two begin events.");
  }
  if (
    !drainedStreamingBackgroundEvents.some(
      (event) => event.kind === "background-tool-status" && event.phase === "started",
    )
  ) {
    throw new Error("streaming background smoke is missing the background started event.");
  }
  if (
    !drainedStreamingBackgroundEvents.some(
      (event) => event.kind === "assistant-chunk" && event.text === "STREAM_BG_",
    )
  ) {
    throw new Error("streaming background smoke is missing the streaming chunk after resume.");
  }

  const streamingCompactionTransport = new StreamingCompactionTransport();
  const streamingCompactionRuntime = new AgentRuntime(
    {
      config: undefined,
      llmTransport: streamingCompactionTransport,
      toolExecutor: new CompactExecutor(),
      createToolAgentState: createScriptedState,
      appendToolResultMessage: appendScriptedToolResult,
      appendUserMessage: appendScriptedUserMessage,
      extractAssistantText: extractScriptedAssistantText,
      truncateStateForContextRetry: truncateScriptedStateForContextRetry,
      truncateHistoryForCompaction: truncateScriptedHistoryForCompaction,
      rebuildRetryStateAfterCompaction: rebuildScriptedStateAfterCompaction,
      maxAutoCompactRetries: 2,
      onEvent: (event) => streamingCompactionEvents.push(event),
    },
    [
      {
        role: "assistant",
        content: [],
        toolCalls: [{ id: "call-old-streaming", name: "read_file", argumentsJson: "{}" }],
      },
      {
        role: "tool",
        toolCallId: "call-old-streaming",
        content: createLlmMessageContentFromText("old tool output\n" + "x".repeat(5000)),
      },
      {
        role: "assistant",
        content: createLlmMessageContentFromText("Old answer."),
      },
    ],
  );

  await streamingCompactionRuntime.startUserTurnStreaming(
    "Handle the overlong context in streaming mode",
  );
  await flushMicrotasks(4);
  await streamingCompactionRuntime.poll();
  const streamingCompactionAux = streamingCompactionRuntime.pendingAuxState();
  if (!streamingCompactionAux || streamingCompactionAux.kind !== "compacting") {
    throw new Error("streaming compact smoke did not enter the compacting aux state.");
  }

  streamingCompactionTransport.finishCompaction();
  for (let index = 0; index < 12 && streamingCompactionRuntime.isBusy(); index += 1) {
    await flushMicrotasks(4);
    await streamingCompactionRuntime.poll();
  }
  if (streamingCompactionRuntime.isBusy()) {
    throw new Error("streaming compact smoke did not finish within the expected rounds.");
  }
  const drainedStreamingCompactionEvents = streamingCompactionRuntime.drainEvents();
  if (
    drainedStreamingCompactionEvents.filter((event) => event.kind === "begin-assistant-response")
      .length !== 1
  ) {
    throw new Error(
      "streaming compact smoke should not emit an extra begin event after the auto-compaction retry.",
    );
  }
  if (
    !drainedStreamingCompactionEvents.some(
      (event) =>
        event.kind === "update-pending-assistant-compaction" &&
        event.text.includes("compacted history"),
    )
  ) {
    throw new Error("streaming compact smoke is missing the compaction update event.");
  }
  if (
    !drainedStreamingCompactionEvents.some(
      (event) => event.kind === "assistant-chunk" && event.text === "STREAM_COMPACT_",
    )
  ) {
    throw new Error(
      "streaming compact smoke is missing the streaming chunk resumed after compaction.",
    );
  }

  const toolRoundTransport = new StreamingToolRoundTransport();
  const noTimeoutRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: toolRoundTransport,
    toolExecutor: new BackgroundExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  await noTimeoutRuntime.startUserTurnStreaming("This is a tool round");
  noTimeoutRuntime.handleStreamStallTimeout(Date.now() + 25_000);
  if (!noTimeoutRuntime.isBusy()) {
    throw new Error("tool round timeout smoke should not time out before the decision completes.");
  }
  toolRoundTransport.finish(
    createScriptedState(noTimeoutRuntime.history() as LlmMessage[], "This is a tool round"),
  );
  await flushMicrotasks();
  await noTimeoutRuntime.poll();

  return {
    drainedStreamingEvents,
    previewEarlyExecutionEvents,
    drainedAuthorizationFailureEvents,
    drainedTimeoutEvents,
    drainedStreamingFailureEvents,
    drainedStreamingApprovalEvents,
    drainedStreamingApprovalImageEvents,
    drainedStreamingGuidanceEvents,
    drainedStreamingBackgroundEvents,
    drainedStreamingCompactionEvents,
    drainedApprovalThenImageEvents,
  };
}

class StreamingApprovalThenGenerateImageTransport implements LlmTransport<
  undefined,
  ScriptedState
> {
  private rounds = 0;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    return {
      kind: "success",
      result: {
        state: {
          messages: [
            ...state.messages,
            { role: "assistant", content: "STREAM_APPROVAL_THEN_IMAGE_SYNC_FALLBACK" },
          ],
          steps: state.steps + 1,
        },
        step: { kind: "final-response-ready" },
        requestTrace: [{ mode: "streaming-approval-then-image-sync-fallback" }],
      },
    };
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: "success",
          result: {
            state: {
              messages: [
                ...state.messages,
                {
                  role: "assistant",
                  content: "Approve the file write first, then continue generating the image.",
                  tool_calls: [
                    {
                      id: "call-stream-approval-then-image-file",
                      type: "function",
                      function: {
                        name: "create_file",
                        arguments: '{"path":"demo.txt","content":"hello"}',
                      },
                    },
                    {
                      id: "call-stream-approval-then-image-generate",
                      type: "function",
                      function: {
                        name: "generate_image",
                        arguments: '{"prompt":"approval follow-up poster","size":"1024x1024"}',
                      },
                    },
                  ],
                },
              ],
              steps: state.steps + 1,
            },
            step: {
              kind: "tool-calls",
              calls: [
                {
                  id: "call-stream-approval-then-image-file",
                  name: "create_file",
                  argumentsJson: '{"path":"demo.txt","content":"hello"}',
                },
                {
                  id: "call-stream-approval-then-image-generate",
                  name: "generate_image",
                  argumentsJson: '{"prompt":"approval follow-up poster","size":"1024x1024"}',
                },
              ],
            },
            requestTrace: [{ mode: "streaming-approval-then-image-round-1" }],
          },
        }),
      };
    }

    const hasApprovedToolResult = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === "tool" &&
        message.tool_call_id === "call-stream-approval-then-image-file" &&
        typeof message.content === "string" &&
        message.content.includes("approved output for create_file"),
    );
    if (!hasApprovedToolResult) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: "failure",
          error:
            "streaming approval then image resume did not write back the approved tool result.",
          requestTrace: [{ mode: "streaming-approval-then-image-round-2-missing-approved-tool" }],
        }),
      };
    }

    const hasImageToolResult = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === "tool" &&
        message.tool_call_id === "call-stream-approval-then-image-generate" &&
        typeof message.content === "string" &&
        message.content.includes("[generated image] approval-follow-up ready"),
    );
    if (!hasImageToolResult) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: "failure",
          error:
            "streaming approval then image resume did not write back the generate_image result.",
          requestTrace: [{ mode: "streaming-approval-then-image-round-2-missing-image-tool" }],
        }),
      };
    }

    return {
      eventStream: streamFromEvents([
        { kind: "assistant-chunk", text: "STREAM_APPROVAL_THEN_IMAGE_" },
        { kind: "assistant-chunk", text: "OK" },
        { kind: "done" },
      ]),
      completion: Promise.resolve({
        kind: "success",
        result: {
          state: {
            messages: [
              ...state.messages,
              { role: "assistant", content: "STREAM_APPROVAL_THEN_IMAGE_OK" },
            ],
            steps: state.steps + 1,
          },
          step: { kind: "final-response-ready" },
          requestTrace: [{ mode: "streaming-approval-then-image-round-2" }],
        },
      }),
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes("context");
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class PreviewEarlyExecutionTransport implements LlmTransport<undefined, ScriptedState> {
  private rounds = 0;
  private firstRoundState: ScriptedState | undefined;
  private resolveFirstRound:
    | ((completion: ToolAgentRoundCompletion<ScriptedState>) => void)
    | undefined;
  toolCallRoundResolved = false;

  async startToolAgentRound(
    _config: undefined,
    _state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    throw new Error("preview early execution smoke should use the streaming transport.");
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      this.firstRoundState = state;
      return {
        eventStream: streamFromEvents([
          {
            kind: "streaming-tool-preview",
            toolCallId: "call-preview-read",
            toolName: "read_file",
            argumentsJson: '{"path":"preview.txt"}',
          },
        ]),
        completion: new Promise((resolve) => {
          this.resolveFirstRound = resolve;
        }),
      };
    }

    if (this.rounds === 2) {
      return {
        eventStream: streamFromEvents([
          { kind: "assistant-chunk", text: "PREVIEW_EARLY_" },
          { kind: "assistant-chunk", text: "OK" },
          { kind: "done" },
        ]),
        completion: Promise.resolve(this.buildFinalRound(state)),
      };
    }

    return {
      eventStream: streamFromEvents([]),
      completion: Promise.resolve({
        kind: "failure",
        error: "preview early execution smoke should not enter an extra round.",
        requestTrace: [{ mode: "preview-early-extra-round" }],
      }),
    };
  }

  resolveToolCallRound(): void {
    if (!this.firstRoundState || !this.resolveFirstRound) {
      throw new Error(
        "preview early execution smoke did not prepare the formal tool-calls completion.",
      );
    }
    this.toolCallRoundResolved = true;
    this.resolveFirstRound(this.buildToolCallRound(this.firstRoundState));
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes("context");
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }

  private buildToolCallRound(state: ScriptedState): ToolAgentRoundCompletion<ScriptedState> {
    return {
      kind: "success",
      result: {
        state: {
          messages: [
            ...state.messages,
            {
              role: "assistant",
              content: "Preparing to read the file.",
              tool_calls: [
                {
                  id: "call-preview-read",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: '{"path":"preview.txt"}',
                  },
                },
              ],
            },
          ],
          steps: state.steps + 1,
        },
        step: {
          kind: "tool-calls",
          calls: [
            {
              id: "call-preview-read",
              name: "read_file",
              argumentsJson: '{"path":"preview.txt"}',
            },
          ],
        },
        requestTrace: [{ mode: "preview-early-tool-round" }],
      },
    };
  }

  private buildFinalRound(state: ScriptedState): ToolAgentRoundCompletion<ScriptedState> {
    return {
      kind: "success",
      result: {
        state: {
          messages: [...state.messages, { role: "assistant", content: "PREVIEW_EARLY_OK" }],
          steps: state.steps + 1,
        },
        step: { kind: "final-response-ready" },
        requestTrace: [{ mode: "preview-early-final-round" }],
      },
    };
  }
}

class CountingReadFileExecutor extends HostExecutor {
  executedCalls: number = 0;

  override async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    this.executedCalls += 1;
    return super.execute(request);
  }
}

class AuthorizationFailureTransport implements LlmTransport<undefined, ScriptedState> {
  private rounds = 0;

  async startToolAgentRound(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      return {
        kind: "success",
        result: {
          state: {
            messages: [
              ...state.messages,
              {
                role: "assistant",
                content: "Let me read this file first.",
                tool_calls: [
                  {
                    id: "call-stream-auth-fail",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"D:\\Spirit\\apps\\cli\\src\\tool_runtime.rs"}',
                    },
                  },
                ],
              },
            ],
            steps: state.steps + 1,
          },
          step: {
            kind: "tool-calls",
            calls: [
              {
                id: "call-stream-auth-fail",
                name: "read_file",
                argumentsJson: '{"path":"D:\\Spirit\\apps\\cli\\src\\tool_runtime.rs"}',
              },
            ],
          },
          requestTrace: [{ mode: "authorization-failure-round-1" }],
        },
      };
    }

    const hasAuthorizationFailure = state.messages.some(
      (message) =>
        isJsonObject(message) &&
        message.role === "tool" &&
        message.tool_call_id === "call-stream-auth-fail" &&
        typeof message.content === "string" &&
        message.content.includes("[authorization error]"),
    );
    if (!hasAuthorizationFailure) {
      return {
        kind: "failure",
        error: "authorization failure state was not written back.",
        requestTrace: [{ mode: "authorization-failure-round-2-missing-tool" }],
      };
    }

    return {
      kind: "success",
      result: {
        state: {
          messages: [...state.messages, { role: "assistant", content: "AUTHORIZATION_FAILURE_OK" }],
          steps: state.steps + 1,
        },
        step: { kind: "final-response-ready" },
        requestTrace: [{ mode: "authorization-failure-round-2" }],
      },
    };
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes("context");
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class AuthorizationFailureExecutor extends HostExecutor {
  override async authorize(request: ScriptedToolRequest): Promise<{ kind: "allowed" }> {
    if (
      request.name === "read_file" &&
      request.argumentsJson.includes("D:\\Spirit\\apps\\cli\\src\\tool_runtime.rs")
    ) {
      throw new Error("path not found: D:\\Spirit\\apps\\cli\\src\\tool_runtime.rs");
    }

    return { kind: "allowed" };
  }
}

class PreviewBackgroundDeferredTransport implements LlmTransport<undefined, ScriptedState> {
  private rounds = 0;
  private firstRoundState: ScriptedState | undefined;
  private resolveFirstRound:
    | ((completion: ToolAgentRoundCompletion<ScriptedState>) => void)
    | undefined;

  async startToolAgentRound(
    _config: undefined,
    _state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    throw new Error("preview background smoke should use the streaming transport.");
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      this.firstRoundState = state;
      return {
        eventStream: streamFromEvents([
          {
            kind: "streaming-tool-preview",
            toolCallId: "call-preview-background",
            toolName: "grep",
            argumentsJson: '{"query":"runtime parity"}',
          },
        ]),
        completion: new Promise((resolve) => {
          this.resolveFirstRound = resolve;
        }),
      };
    }

    if (this.rounds === 2) {
      return {
        eventStream: streamFromEvents([
          { kind: "assistant-chunk", text: "PREVIEW_BACKGROUND_" },
          { kind: "assistant-chunk", text: "OK" },
          { kind: "done" },
        ]),
        completion: Promise.resolve({
          kind: "success",
          result: {
            state: {
              messages: [
                ...state.messages,
                { role: "assistant", content: "PREVIEW_BACKGROUND_OK" },
              ],
              steps: state.steps + 1,
            },
            step: { kind: "final-response-ready" },
            requestTrace: [{ mode: "preview-background-final-round" }],
          },
        }),
      };
    }

    return {
      eventStream: streamFromEvents([]),
      completion: Promise.resolve({
        kind: "failure",
        error: "preview background smoke should not enter an extra round.",
        requestTrace: [{ mode: "preview-background-extra-round" }],
      }),
    };
  }

  resolveToolCallRound(): void {
    if (!this.firstRoundState || !this.resolveFirstRound) {
      throw new Error("preview background smoke did not prepare the formal tool-calls completion.");
    }
    this.resolveFirstRound({
      kind: "success",
      result: {
        state: {
          messages: [
            ...this.firstRoundState.messages,
            {
              role: "assistant",
              content: "Preparing to search in the background.",
              tool_calls: [
                {
                  id: "call-preview-background",
                  type: "function",
                  function: {
                    name: "grep",
                    arguments: '{"query":"runtime parity"}',
                  },
                },
              ],
            },
          ],
          steps: this.firstRoundState.steps + 1,
        },
        step: {
          kind: "tool-calls",
          calls: [
            {
              id: "call-preview-background",
              name: "grep",
              argumentsJson: '{"query":"runtime parity"}',
            },
          ],
        },
        requestTrace: [{ mode: "preview-background-tool-round" }],
      },
    });
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes("context");
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}

class CountingBackgroundExecutor extends BackgroundExecutor {
  executedCalls: number = 0;

  override async execute(request: ScriptedToolRequest): Promise<ToolExecutionOutput> {
    this.executedCalls += 1;
    return super.execute(request);
  }
}

class PreviewSubagentDeferredTransport implements LlmTransport<undefined, ScriptedState> {
  private rounds = 0;
  private firstRoundState: ScriptedState | undefined;
  private resolveFirstRound:
    | ((completion: ToolAgentRoundCompletion<ScriptedState>) => void)
    | undefined;

  async startToolAgentRound(
    _config: undefined,
    _state: ScriptedState,
    _tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<ScriptedState>> {
    throw new Error("preview subagent smoke should use the streaming transport.");
  }

  async startToolAgentRoundStreaming(
    _config: undefined,
    state: ScriptedState,
    _tools: JsonValue,
  ): Promise<StartedToolAgentRound<ScriptedState>> {
    this.rounds += 1;

    if (this.rounds === 1) {
      this.firstRoundState = state;
      return {
        eventStream: streamFromEvents([
          {
            kind: "streaming-tool-preview",
            toolCallId: "call-preview-subagent",
            toolName: "subagent",
            argumentsJson: '{"task":"Output: OK, I am the SubAgent, hahaha"}',
          },
        ]),
        completion: new Promise((resolve) => {
          this.resolveFirstRound = resolve;
        }),
      };
    }

    if (this.rounds === 2) {
      const delegatedPromptPresent = state.messages.some(
        (message) =>
          isJsonObject(message) &&
          message.role === "user" &&
          typeof message.content === "string" &&
          message.content.includes("You are already inside the delegated child session."),
      );
      if (!delegatedPromptPresent) {
        return {
          eventStream: streamFromEvents([]),
          completion: Promise.resolve({
            kind: "failure",
            error: "preview subagent child round did not receive the delegated user turn.",
            requestTrace: [{ mode: "preview-subagent-child-round-missing-user-turn" }],
          }),
        };
      }

      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: "success",
          result: {
            state: {
              messages: [
                ...state.messages,
                { role: "assistant", content: "OK, I am the SubAgent, hahaha" },
              ],
              steps: state.steps + 1,
            },
            step: { kind: "final-response-ready" },
            requestTrace: [{ mode: "preview-subagent-child-round" }],
          },
        }),
      };
    }

    const toolResultMessage = state.messages.find(
      (message) =>
        isJsonObject(message) &&
        message.role === "tool" &&
        message.tool_call_id === "call-preview-subagent" &&
        typeof message.content === "string",
    );
    if (
      !toolResultMessage ||
      !isJsonObject(toolResultMessage) ||
      typeof toolResultMessage.content !== "string" ||
      !toolResultMessage.content.includes("OK, I am the SubAgent, hahaha")
    ) {
      return {
        eventStream: streamFromEvents([]),
        completion: Promise.resolve({
          kind: "failure",
          error: "preview subagent parent round did not receive the subagent result.",
          requestTrace: [{ mode: "preview-subagent-parent-round-missing-tool-result" }],
        }),
      };
    }

    if (this.rounds === 3) {
      return {
        eventStream: streamFromEvents([
          { kind: "assistant-chunk", text: "PREVIEW_SUBAGENT_" },
          { kind: "assistant-chunk", text: "OK" },
          { kind: "done" },
        ]),
        completion: Promise.resolve({
          kind: "success",
          result: {
            state: {
              messages: [...state.messages, { role: "assistant", content: "PREVIEW_SUBAGENT_OK" }],
              steps: state.steps + 1,
            },
            step: { kind: "final-response-ready" },
            requestTrace: [{ mode: "preview-subagent-parent-round-2" }],
          },
        }),
      };
    }

    return {
      eventStream: streamFromEvents([]),
      completion: Promise.resolve({
        kind: "failure",
        error: "preview subagent smoke should not enter an extra round.",
        requestTrace: [{ mode: "preview-subagent-extra-round" }],
      }),
    };
  }

  resolveToolCallRound(): void {
    if (!this.firstRoundState || !this.resolveFirstRound) {
      throw new Error("preview subagent smoke did not prepare the formal tool-calls completion.");
    }
    this.resolveFirstRound({
      kind: "success",
      result: {
        state: {
          messages: [
            ...this.firstRoundState.messages,
            {
              role: "assistant",
              content: "Preparing to delegate to the subagent.",
              tool_calls: [
                {
                  id: "call-preview-subagent",
                  type: "function",
                  function: {
                    name: "subagent",
                    arguments: '{"task":"Output: OK, I am the SubAgent, hahaha"}',
                  },
                },
              ],
            },
          ],
          steps: this.firstRoundState.steps + 1,
        },
        step: {
          kind: "tool-calls",
          calls: [
            {
              id: "call-preview-subagent",
              name: "subagent",
              argumentsJson: '{"task":"Output: OK, I am the SubAgent, hahaha"}',
            },
          ],
        },
        requestTrace: [{ mode: "preview-subagent-parent-round-1" }],
      },
    });
  }

  async compactHistoryManual(
    _config: undefined,
    history: LlmMessage[],
  ): Promise<{ droppedMessages: number; beforeLength: number; afterLength: number }> {
    return {
      droppedMessages: 0,
      beforeLength: history.length,
      afterLength: history.length,
    };
  }

  compactSummaryText(): string | undefined {
    return undefined;
  }

  isContextOverflowError(error: string): boolean {
    return error.includes("context");
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return historyAsPlainApiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {};
  }
}
