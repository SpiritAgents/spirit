import {
  AgentRuntime,
  HostExecutor,
  ToolImageProjectionExecutor,
  ToolImageProjectionTransport,
  WorkspaceContextTransport,
  appendScriptedToolResult,
  appendScriptedUserLlmMessage,
  appendScriptedUserMessage,
  createScriptedState,
  extractScriptedAssistantText,
  join,
  llmMessageTextContent,
  mkdir,
  mkdtemp,
  pendingWorkspaceFilesFromInput,
  rm,
  tmpdir,
  type JsonValue,
  type RuntimeParityCaseResult,
  writeFile,
} from "./harness.js";
import { CONTEXT_INJECTION_MAX_BYTES } from "../../../../context-budget.js";

export async function runContextProjectionCase(): Promise<RuntimeParityCaseResult> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "spirit-runtime-"));
  let workspaceFileSmoke: JsonValue;
  try {
    await mkdir(join(workspaceRoot, "src"), { recursive: true });
    await writeFile(join(workspaceRoot, "src", "runtime.ts"), "export const runtime = true;\n");
    await writeFile(join(workspaceRoot, "README.md"), "hello from readme\n");
    await writeFile(join(workspaceRoot, "large.txt"), "x".repeat(CONTEXT_INJECTION_MAX_BYTES + 50));

    const referencedFiles = await pendingWorkspaceFilesFromInput(
      workspaceRoot,
      "@src/runtime.ts please refer to @README.md and @missing.rs as well as @large.txt",
    );
    const referencedPaths = referencedFiles.map((file) => file.path);
    if (referencedPaths.join("|") !== "src/runtime.ts|README.md|large.txt") {
      throw new Error(
        "workspace file helper smoke did not extract existing references as expected.",
      );
    }

    const largeFile = referencedFiles.find((file) => file.path === "large.txt");
    if (
      !largeFile ||
      largeFile.kind !== "text" ||
      !largeFile.truncated ||
      largeFile.content !==
        `${"x".repeat(CONTEXT_INJECTION_MAX_BYTES)}\n\n...<file content truncated>`
    ) {
      throw new Error(
        "workspace file helper smoke did not truncate the oversized file as expected.",
      );
    }

    const workspaceRuntime = new AgentRuntime({
      config: undefined,
      llmTransport: new WorkspaceContextTransport(),
      toolExecutor: new HostExecutor(),
      createToolAgentState: createScriptedState,
      appendToolResultMessage: appendScriptedToolResult,
      appendUserMessage: appendScriptedUserMessage,
      extractAssistantText: extractScriptedAssistantText,
      resolveWorkspaceFilesFromInput: (text) => pendingWorkspaceFilesFromInput(workspaceRoot, text),
    });

    const workspaceResult = await workspaceRuntime.submitUserTurn(
      "@src/runtime.ts please summarize together with @README.md",
    );
    if (
      workspaceResult.kind !== "completed" ||
      workspaceResult.assistantText !== "WORKSPACE_CONTEXT_OK"
    ) {
      throw new Error("workspace file context smoke did not complete the turn loop.");
    }

    const injectedContexts = workspaceRuntime
      .history()
      .filter(
        (message) =>
          message.role === "system" &&
          llmMessageTextContent(message.content).startsWith("[WORKSPACE_FILE]"),
      );
    if (injectedContexts.length !== 2) {
      throw new Error(
        "workspace file context smoke injected an incorrect number of system contexts.",
      );
    }

    workspaceFileSmoke = {
      referencedPaths,
      truncatedLargeFile: largeFile.truncated,
      injectedContexts: injectedContexts.length,
      assistantText: workspaceResult.assistantText,
    };
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }

  const toolImageProjectionRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new ToolImageProjectionTransport(),
    toolExecutor: new ToolImageProjectionExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    appendUserLlmMessage: appendScriptedUserLlmMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const toolImageProjectionResult = await toolImageProjectionRuntime.submitUserTurn(
    "Please read the image, then continue the analysis.",
  );
  if (
    toolImageProjectionResult.kind !== "completed" ||
    toolImageProjectionResult.assistantText !== "TOOL_IMAGE_PROJECTION_OK"
  ) {
    throw new Error("tool image projection smoke did not complete the turn loop.");
  }

  return { workspaceFileSmoke, toolImageProjectionResult };
}
