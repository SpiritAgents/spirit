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
  restoreHostFileChanges,
  type HostRecordedFileChange,
} from "@spiritagent/workspace/file-rewind";

export async function executeStoredSessionCommand(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case "session.listStored":
      return listStoredSessions();
    case "session.loadStored":
      return loadStoredSession(requiredPath(params));
    case "session.saveStored": {
      const path = await saveStoredSession(
        typeof params["path"] === "string" ? params["path"] : undefined,
        params["session"] as never,
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
    default:
      throw new Error(`unknown stored session command: ${method}`);
  }
}

function requiredPath(params: Record<string, unknown>): string {
  const value = params["path"];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("missing path");
  }
  return value;
}
