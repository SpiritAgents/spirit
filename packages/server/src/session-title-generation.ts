import {
  llmMessageImagePaths,
  llmMessageVideoPaths,
  type LlmMessage,
} from "@spiritagent/agent-core";

export function isFirstUserTurnInHistory(history: readonly LlmMessage[]): boolean {
  return history.filter((message) => message.role === "user").length === 1;
}

export function mediaPathsFromLatestUserMessage(history: readonly LlmMessage[]): {
  imagePaths: string[];
  videoPaths: string[];
} {
  const latestUser = [...history].reverse().find((message) => message.role === "user");
  if (!latestUser) {
    return { imagePaths: [], videoPaths: [] };
  }
  return {
    imagePaths: llmMessageImagePaths(latestUser.content),
    videoPaths: llmMessageVideoPaths(latestUser.content),
  };
}

export function shouldScheduleSessionTitleGeneration(input: {
  sessionKind?: string | undefined;
  conversationKey?: string | undefined;
  history: readonly LlmMessage[];
}): boolean {
  if (input.sessionKind === "dream-collector" || input.sessionKind === "subagent") {
    return false;
  }
  const conversationKey = input.conversationKey?.trim() ?? "";
  if (conversationKey.startsWith("ephemeral://")) {
    return false;
  }
  return isFirstUserTurnInHistory(input.history);
}
