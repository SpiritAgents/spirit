import { type LlmActiveSkill, type LlmToolAgentBasicInfo } from "@spiritagent/agent-core";
import { resolveTranscriptSessionDir } from "@spiritagent/host-internal";

import { spiritDataDir } from "./storage.js";
import type { DesktopToolExecutor } from "./tool-executor.js";

export type { RemoteDesktopRuntime as DesktopHostRuntime } from "./remote-runtime.js";

export function buildDesktopRuntimeBasicInfo(
  workspaceRoot: string,
  toolExecutor: DesktopToolExecutor,
  gitBranch?: string,
  sessionKey?: string,
): LlmToolAgentBasicInfo {
  const shell = toolExecutor.toolDefinitionEnvironment();
  const normalizedGitBranch = gitBranch?.trim();
  const normalizedSessionKey = sessionKey?.trim();
  const sessionTranscript = normalizedSessionKey
    ? resolveTranscriptSessionDir(spiritDataDir(), normalizedSessionKey)
    : undefined;
  return {
    workspaceRoot,
    ...(normalizedGitBranch ? { gitBranch: normalizedGitBranch } : {}),
    ...(sessionTranscript ? { sessionTranscript } : {}),
    terminal: shell.shellDisplayName,
    system: toolExecutor.operatingSystemInfo(),
    host: { kind: "Desktop" },
  };
}

export function cloneActiveSkills(skills: LlmActiveSkill[]): LlmActiveSkill[] {
  return skills.map((skill) => ({
    ...skill,
    resources: skill.resources.map((resource) => ({ ...resource })),
  }));
}
