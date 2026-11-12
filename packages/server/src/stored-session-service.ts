import {
  buildTruncatedChatArchiveForFork,
  truncateMessagesThroughIndex,
} from "@spiritagent/sessions/host/fork-session";
import { createDesktopRewindMetadata } from "@spiritagent/sessions/host/rewind";
import {
  listStoredSessions,
  loadStoredSession,
  runWithSpiritDataDir,
  saveStoredSession,
} from "@spiritagent/sessions/host/storage";
import {
  loadRewindCheckpointSnapshot,
  loadRewindFileChange,
  saveRewindCheckpointSnapshot,
  saveRewindFileChange,
} from "@spiritagent/sessions/host/rewind";
import {
  restoreHostFileChanges,
  type HostRecordedFileChange,
} from "@spiritagent/workspace/file-rewind";
import { readCurrentGitBranch } from "@spiritagent/workspace/git-workspace";
import type { StoredDesktopSession } from "@spiritagent/sessions/host/contracts";

export async function executeStoredSessionCommand(
  method: string,
  params: Record<string, unknown>,
  spiritDataDir: string,
): Promise<unknown> {
  return runWithSpiritDataDir(spiritDataDir, () =>
    executeStoredSessionCommandInScope(method, params, spiritDataDir),
  );
}

async function executeStoredSessionCommandInScope(
  method: string,
  params: Record<string, unknown>,
  spiritDataDir: string,
): Promise<unknown> {
  switch (method) {
    case "session.listStored":
      return listStoredSessions();
    case "session.loadStored":
      return loadStoredSession(requiredPath(params));
    case "session.saveStored": {
      const archive = params["archive"] as Record<string, unknown> | undefined;
      const requestedPath = typeof params["path"] === "string" ? params["path"] : undefined;
      const existing = await loadExistingStoredSession(requestedPath);
      const requestedWorkspaceRoot = optionalString(params["workspaceRoot"]);
      const workspaceRoot = requestedWorkspaceRoot ?? existing?.workspaceRoot;
      const gitBranch = requestedWorkspaceRoot
        ? await readCurrentGitBranch(requestedWorkspaceRoot)
        : existing?.gitBranch;
      const path = await saveStoredSession(
        requestedPath,
        archive
          ? ({
              chatSchemaVersion: 2,
              llmHistory: archive["llmHistory"] ?? [],
              subagentSessions: archive["subagentSessions"] ?? [],
              loopEnabled: archive["loopEnabled"] === true,
              approvalLevel: archive["approvalLevel"],
              desktopMessageTimeline: archive["desktopMessageTimeline"] ?? [],
              savedAtUnixMs: Date.now(),
              sessionDisplayName: archive["sessionDisplayName"],
              sessionTitleSource: archive["sessionTitleSource"],
              rewind: archive["rewind"],
              ...(existing?.pinnedAtUnixMs ? { pinnedAtUnixMs: existing.pinnedAtUnixMs } : {}),
              ...(workspaceRoot ? { workspaceRoot } : {}),
              ...(gitBranch ? { gitBranch } : {}),
            } as StoredDesktopSession)
          : (params["session"] as never),
      );
      return { path };
    }
    case "session.fork": {
      const sourceArchive = params["archive"] as never;
      const sourceDesktopMessages = params["desktopMessages"] as never[];
      const anchorIndex = Number(params["anchorIndex"]);
      if (!Number.isSafeInteger(anchorIndex) || anchorIndex < 0) {
        throw new Error("invalid anchorIndex");
      }
      return {
        archive: buildTruncatedChatArchiveForFork(
          sourceArchive,
          sourceDesktopMessages,
          anchorIndex,
        ),
        desktopMessages: truncateMessagesThroughIndex(sourceDesktopMessages, anchorIndex),
        rewind: createDesktopRewindMetadata(),
      };
    }
    case "session.rewind":
      return restoreHostFileChanges((params["changes"] as HostRecordedFileChange[]) ?? []);
    case "session.saveRewindCheckpoint":
      return saveRewindCheckpointSnapshot(
        spiritDataDir,
        requiredStringParam(params, "sessionId"),
        requiredStringParam(params, "checkpointId"),
        params["snapshot"] as never,
      );
    case "session.loadRewindCheckpoint":
      return loadRewindCheckpointSnapshot(
        spiritDataDir,
        requiredStringParam(params, "sessionId"),
        requiredStringParam(params, "checkpointId"),
      );
    case "session.saveRewindFileChange":
      return saveRewindFileChange(
        spiritDataDir,
        requiredStringParam(params, "sessionId"),
        params["change"] as never,
      );
    case "session.loadRewindFileChange":
      return loadRewindFileChange(
        spiritDataDir,
        requiredStringParam(params, "sessionId"),
        requiredStringParam(params, "changeId"),
      );
    default:
      throw new Error(`unknown stored session command: ${method}`);
  }
}

function requiredStringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`missing ${key}`);
  }
  return value;
}

function requiredPath(params: Record<string, unknown>): string {
  const value = params["path"];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("missing path");
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function loadExistingStoredSession(
  filePath: string | undefined,
): Promise<StoredDesktopSession | undefined> {
  if (!filePath?.trim()) {
    return undefined;
  }
  try {
    return await loadStoredSession(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
