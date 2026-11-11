import {
  buildTruncatedChatArchiveForFork,
  truncateMessagesThroughIndex,
} from "@spiritagent/sessions/host/fork-session";
import { createDesktopRewindMetadata } from "@spiritagent/sessions/host/rewind";
import {
  listStoredSessions,
  loadStoredSession,
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

export async function executeStoredSessionCommand(
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
      const path = await saveStoredSession(
        typeof params["path"] === "string" ? params["path"] : undefined,
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
            } as never)
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
