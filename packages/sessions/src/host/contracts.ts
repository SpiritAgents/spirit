import type { ChatArchive } from "@spiritagent/agent-core";
import type { ApprovalLevel } from "@spiritagent/api/approval-level";
import type { ConversationContextUsageSnapshot } from "../types.js";
import type { PersistedDesktopTimelineTurnSnapshot } from "./chat-schema.js";
import type { StoredDesktopRewindMetadata } from "./rewind.js";

export type {
  DesktopHostCommitRequest,
  DesktopToolRequest,
  HostCommandName,
} from "@spiritagent/api/commands";

export type SessionTitleSource = "seed" | "llm" | "manual";

export interface StoredDesktopSession {
  chatSchemaVersion: 2;
  llmHistory: ChatArchive["llmHistory"];
  subagentSessions?: ChatArchive["subagentSessions"];
  loopEnabled?: boolean;
  approvalLevel?: ApprovalLevel;
  activeModel?: string;
  desktopMessageTimeline: PersistedDesktopTimelineTurnSnapshot[];
  savedAtUnixMs: number;
  sessionDisplayName?: string;
  sessionTitleSource?: SessionTitleSource;
  pinnedAtUnixMs?: number;
  workspaceRoot?: string;
  gitBranch?: string;
  workLocation?: import("@spiritagent/api/work-location").WorkLocationKind;
  worktreePath?: string;
  worktreeBranch?: string;
  activePlanPath?: string;
  rewind?: StoredDesktopRewindMetadata;
  contextUsage?: ConversationContextUsageSnapshot;
  subagentDesktopTimelines?: Record<string, PersistedDesktopTimelineTurnSnapshot[]>;
  queuedUserTurns?: import("./message-queue.js").QueuedUserTurn[];
  automationId?: string;
  automationRunId?: string;
}
