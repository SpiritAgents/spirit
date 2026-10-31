import type {
  AgentRuntime,
  LlmActiveSkill,
  LlmEnabledSkillCatalogEntry,
  LlmTransportConfig,
  AgentMode,
} from "@spiritagent/agent-core";
import type { HostToolExecutorProxy } from "@spiritagent/agent-core/host-bridge";
import type { JsonValue } from "@spiritagent/agent-core";

/**
 * ACP Server runtime paths. LLM transport is resolved from shared Spirit config + keyring.
 */
export interface AcpServerConfig {
  /** Workspace root path (default: process.cwd()) */
  workspaceRoot: string;
  /** Shared data directory, defaulting to the build's product directory under the user home. */
  spiritDataDir: string;
}

/**
 * Per-session state for an ACP session.
 */
export interface AcpSessionState {
  readonly sessionId: string;
  readonly runtime: AgentRuntime<LlmTransportConfig, unknown, JsonValue>;
  readonly toolExecutor: HostToolExecutorProxy;
  readonly workspaceRoot: string;
  currentMode: AgentMode;
  /** AbortController for the currently running prompt turn (null if idle) */
  pendingPrompt: AbortController | null;
  /** Mutable active skills array — shared with runtime factory closures */
  readonly activeSkills: LlmActiveSkill[];
  /** Skill catalog entries discovered at session creation */
  readonly enabledSkillCatalog: LlmEnabledSkillCatalogEntry[];
  /** Switch agent mode: updates tool exposure + system prompt planMetadata */
  readonly setAgentMode: (mode: AgentMode) => Promise<void>;
}

/**
 * Available ACP session modes advertised by Spirit.
 */
export const AVAILABLE_MODES = [
  { id: "agent" as const, name: "Agent", description: "Full tool access, autonomous coding" },
  { id: "plan" as const, name: "Plan", description: "Design and plan without making changes" },
  { id: "ask" as const, name: "Ask", description: "Ask permission before every change" },
  { id: "debug" as const, name: "Debug", description: "Systematic bug investigation" },
] as const;

/**
 * Maps an ACP mode ID string to an AgentMode, with fallback to 'agent'.
 */
export function normalizeModeId(modeId: string): AgentMode {
  switch (modeId) {
    case "agent":
    case "plan":
    case "ask":
    case "debug":
      return modeId;
    default:
      return "agent";
  }
}
