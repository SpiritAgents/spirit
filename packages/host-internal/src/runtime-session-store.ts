import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentMode, ChatArchive } from "@spiritagent/agent-core";
import { writeTaskStateJson } from "./background-task-store.js";
import { resolveTranscriptSessionDir } from "./transcript.js";

export interface RuntimeSessionState {
  version: 1;
  sessionKey: string;
  workspaceRoot: string;
  agentMode: AgentMode;
  activePlanPath?: string;
  initialized: boolean;
  archive: ChatArchive;
  desktopTimeline?: {
    revision: number;
    timeline: unknown[];
    updatedAtUnixMs: number;
  };
}

export class RuntimeSessionStore {
  private readonly file: string;
  private writes = Promise.resolve();

  constructor(
    private readonly spiritDataDir: string,
    private readonly sessionKey: string,
  ) {
    this.file = path.join(
      resolveTranscriptSessionDir(spiritDataDir, sessionKey),
      "background-tasks",
      "runtime-session.json",
    );
  }

  async read(): Promise<RuntimeSessionState | undefined> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
    if (
      !isRuntimeSessionState(value) ||
      resolveTranscriptSessionDir(this.spiritDataDir, value.sessionKey) !==
        resolveTranscriptSessionDir(this.spiritDataDir, this.sessionKey)
    ) {
      throw new Error("Invalid persisted runtime session.");
    }
    return value;
  }

  save(snapshot: RuntimeSessionState): Promise<void> {
    const captured = structuredClone(snapshot);
    const write = async (): Promise<void> => {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await writeTaskStateJson(this.file, captured);
    };
    this.writes = this.writes.then(write, write);
    return this.writes;
  }
}

function isRuntimeSessionState(value: unknown): value is RuntimeSessionState {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("sessionKey" in value) ||
    typeof value.sessionKey !== "string" ||
    !("workspaceRoot" in value) ||
    typeof value.workspaceRoot !== "string" ||
    !("agentMode" in value) ||
    typeof value.agentMode !== "string" ||
    !["agent", "plan", "ask", "debug"].includes(value.agentMode) ||
    !("initialized" in value) ||
    typeof value.initialized !== "boolean" ||
    !("archive" in value) ||
    typeof value.archive !== "object" ||
    value.archive === null
  )
    return false;
  if ("desktopTimeline" in value) {
    const timeline = value.desktopTimeline;
    if (
      typeof timeline !== "object" ||
      timeline === null ||
      !("revision" in timeline) ||
      !Number.isSafeInteger(timeline.revision) ||
      !("timeline" in timeline) ||
      !Array.isArray(timeline.timeline) ||
      !("updatedAtUnixMs" in timeline) ||
      typeof timeline.updatedAtUnixMs !== "number"
    )
      return false;
  }
  if ("activePlanPath" in value && typeof value.activePlanPath !== "string") return false;
  const archive = value.archive;
  return (
    "llmHistory" in archive &&
    Array.isArray(archive.llmHistory) &&
    "messages" in archive &&
    Array.isArray(archive.messages) &&
    "assistantAux" in archive &&
    Array.isArray(archive.assistantAux) &&
    (!("subagentSessions" in archive) || Array.isArray(archive.subagentSessions)) &&
    (!("loopEnabled" in archive) || typeof archive.loopEnabled === "boolean")
  );
}
