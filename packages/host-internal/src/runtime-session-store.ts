import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentMode, ChatArchive, RuntimeEvent } from "@spiritagent/agent-core";
import { writeTaskStateJson } from "./background-task-store.js";
import { resolveTranscriptSessionDir } from "./transcript.js";
import type { WorkLocationKind } from "./work-location.js";

export type RuntimePresentationPayload =
  | { kind: "runtime"; event: RuntimeEvent<unknown> }
  | { kind: "user"; text: string; explicitWorkspaceFiles?: unknown[]; clientTurnId?: string };

export type RuntimePresentationEntry = RuntimePresentationPayload & { sequence: number };

export interface RuntimePresentationState {
  sequence: number;
  entries: RuntimePresentationEntry[];
}

export interface RuntimeSessionState {
  version: 1;
  sessionKey: string;
  workspaceRoot: string;
  agentMode: AgentMode;
  modelRef?: import("./config.js").ModelRef;
  sessionKind?: "default" | "dream-collector" | "subagent";
  subagentOrigin?: import("@spiritagent/agent-core").SubagentSessionOrigin;
  workLocation?: WorkLocationKind;
  worktreePath?: string;
  worktreeBranch?: string;
  activePlanPath?: string;
  initialized: boolean;
  archive: ChatArchive;
  presentation?: RuntimePresentationState;
  desktopTimeline?: {
    revision: number;
    timeline: unknown[];
    updatedAtUnixMs: number;
    presentationSequence?: number;
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
      Number(timeline.revision) < 0 ||
      !("timeline" in timeline) ||
      !Array.isArray(timeline.timeline) ||
      !("updatedAtUnixMs" in timeline) ||
      typeof timeline.updatedAtUnixMs !== "number" ||
      ("presentationSequence" in timeline &&
        (!Number.isSafeInteger(timeline.presentationSequence) ||
          Number(timeline.presentationSequence) < 0))
    )
      return false;
  }
  if ("activePlanPath" in value && typeof value.activePlanPath !== "string") return false;
  if (
    "modelRef" in value &&
    (typeof value.modelRef !== "object" ||
      value.modelRef === null ||
      !("providerId" in value.modelRef) ||
      typeof value.modelRef.providerId !== "string" ||
      !("name" in value.modelRef) ||
      typeof value.modelRef.name !== "string")
  )
    return false;
  if (
    "workLocation" in value &&
    value.workLocation !== "local" &&
    value.workLocation !== "worktree"
  )
    return false;
  if ("worktreePath" in value && typeof value.worktreePath !== "string") return false;
  if ("worktreeBranch" in value && typeof value.worktreeBranch !== "string") return false;
  if ("presentation" in value) {
    const presentation = value.presentation;
    if (
      !presentation ||
      typeof presentation !== "object" ||
      !("sequence" in presentation) ||
      !Number.isSafeInteger(presentation.sequence) ||
      Number(presentation.sequence) < 0 ||
      !("entries" in presentation) ||
      !Array.isArray(presentation.entries)
    )
      return false;
    const cursor =
      "desktopTimeline" in value &&
      typeof value.desktopTimeline === "object" &&
      value.desktopTimeline !== null &&
      "presentationSequence" in value.desktopTimeline
        ? Number(value.desktopTimeline.presentationSequence)
        : 0;
    if (cursor > Number(presentation.sequence)) return false;
    let previous = cursor;
    for (const entry of presentation.entries) {
      if (
        !entry ||
        typeof entry !== "object" ||
        !Number.isSafeInteger(entry.sequence) ||
        entry.sequence <= previous ||
        entry.sequence > Number(presentation.sequence) ||
        (entry.kind !== "runtime" && entry.kind !== "user") ||
        (entry.kind === "runtime" && (!entry.event || typeof entry.event.kind !== "string")) ||
        (entry.kind === "user" && typeof entry.text !== "string")
      )
        return false;
      previous = entry.sequence;
    }
  }
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
