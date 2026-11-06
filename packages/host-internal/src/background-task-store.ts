import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  isBackgroundTaskTerminal,
  type BackgroundTaskCreateInput,
  type BackgroundTaskRecord,
  type BackgroundTaskStore,
} from "@spiritagent/agent-core";

import { BACKGROUND_TASK_ID_PATTERN, BACKGROUND_TASKS_DIR_NAME } from "./background-task-path.js";
import { resolveTranscriptSessionDir } from "./transcript.js";

const writes = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = writes.get(key) ?? Promise.resolve();
  const next = previous.then(action, action);
  writes.set(key, next);
  const release = (): void => {
    if (writes.get(key) === next) writes.delete(key);
  };
  void next.then(release, release);
  return next;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function writeTaskStateJson(filePath: string, record: unknown): Promise<void> {
  const temporary = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, filePath);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Task save and temporary-file cleanup failed.",
      );
    }
    throw error;
  }
}

const taskStatuses = new Set([
  "starting",
  "running",
  "blocked",
  "waiting-for-background",
  "completed",
  "failed",
  "stopped",
  "interrupted",
]);

function isTaskRecord(value: unknown): value is BackgroundTaskRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const strings = [
    "id",
    "ownerSessionId",
    "runtimeId",
    "toolCallId",
    "input",
    "argumentsJson",
    "outputPath",
  ];
  const numbers = ["startedAtUnixMs", "updatedAtUnixMs", "elapsedMs"];
  if (
    record.version !== 1 ||
    !strings.every((key) => typeof record[key] === "string") ||
    !numbers.every(
      (key) => typeof record[key] === "number" && Number.isFinite(record[key]) && record[key] >= 0,
    ) ||
    !BACKGROUND_TASK_ID_PATTERN.test(String(record.id)) ||
    (record.kind !== "shell" && record.kind !== "subagent") ||
    typeof record.background !== "boolean" ||
    typeof record.status !== "string" ||
    !taskStatuses.has(record.status)
  )
    return false;
  if (typeof record.owner !== "object" || record.owner === null || Array.isArray(record.owner))
    return false;
  const owner = record.owner as Record<string, unknown>;
  if (
    typeof owner.id !== "string" ||
    !owner.id ||
    typeof owner.pid !== "number" ||
    !Number.isInteger(owner.pid) ||
    owner.pid <= 0
  )
    return false;
  for (const key of [
    "parentTaskId",
    "error",
    "sessionId",
    "sessionTranscript",
    "worktreePath",
    "worktreeBranch",
    "terminalEventId",
  ]) {
    if (record[key] !== undefined && typeof record[key] !== "string") return false;
  }
  for (const key of ["endedAtUnixMs", "exitCode"]) {
    if (
      record[key] !== undefined &&
      (typeof record[key] !== "number" || !Number.isFinite(record[key]))
    )
      return false;
  }
  for (const key of ["elapsedApproximate", "notificationDelivered"]) {
    if (record[key] !== undefined && typeof record[key] !== "boolean") return false;
  }
  return true;
}

export interface FileBackgroundTaskStoreOptions {
  spiritDataDir: string;
  ownerSessionId: string;
  owner: BackgroundTaskRecord["owner"];
}

export class FileBackgroundTaskStore implements BackgroundTaskStore {
  readonly directory: string;

  constructor(private readonly options: FileBackgroundTaskStoreOptions) {
    if (!options.ownerSessionId.trim()) throw new Error("Background tasks require a session ID.");
    this.directory = path.join(
      resolveTranscriptSessionDir(options.spiritDataDir, options.ownerSessionId),
      BACKGROUND_TASKS_DIR_NAME,
    );
  }

  private recordPath(id: string): string {
    if (!BACKGROUND_TASK_ID_PATTERN.test(id)) throw new Error(`Invalid task ID: ${id}`);
    return path.join(this.directory, `${id}.json`);
  }

  private outputPath(record: Pick<BackgroundTaskRecord, "id" | "kind">): string {
    this.recordPath(record.id);
    return path.join(
      this.directory,
      `${record.kind}-${record.id}.${record.kind === "shell" ? "log" : "md"}`,
    );
  }

  private validateRecord(value: unknown, expectedId: string): BackgroundTaskRecord {
    if (!isTaskRecord(value)) throw new Error(`Invalid background task record: ${expectedId}`);
    if (
      value.id !== expectedId ||
      value.ownerSessionId !== this.options.ownerSessionId ||
      value.outputPath !== this.outputPath(value)
    )
      throw new Error(`Background task identity or path mismatch: ${expectedId}`);
    return value;
  }

  private async readRecord(id: string): Promise<BackgroundTaskRecord> {
    const text = await readFile(this.recordPath(id), "utf8");
    const parsed: unknown = JSON.parse(text);
    return this.validateRecord(parsed, id);
  }

  async create(input: BackgroundTaskCreateInput): Promise<BackgroundTaskRecord> {
    if (input.ownerSessionId !== this.options.ownerSessionId)
      throw new Error("Task session mismatch.");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (;;) {
      const id = `task_${randomBytes(6).toString("hex")}`;
      const file = this.recordPath(id);
      const lockPath = `${file}.lock`;
      let reservation;
      try {
        reservation = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if (hasCode(error, "EEXIST")) continue;
        throw error;
      }
      const now = Date.now();
      const record: BackgroundTaskRecord = {
        ...input,
        version: 1,
        id,
        owner: { ...this.options.owner },
        status: "starting",
        background: false,
        outputPath: this.outputPath({ id, kind: input.kind }),
        startedAtUnixMs: now,
        updatedAtUnixMs: now,
        elapsedMs: 0,
      };
      let createdOutput = false;
      try {
        try {
          await open(file, "r").then((handle) => handle.close());
          continue;
        } catch (error) {
          if (!hasCode(error, "ENOENT")) throw error;
        }
        const output = await open(record.outputPath, "wx", 0o600);
        createdOutput = true;
        await output.close();
        await writeTaskStateJson(file, record);
      } catch (error) {
        if (createdOutput) {
          try {
            await unlink(record.outputPath);
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Task creation and output cleanup failed.",
            );
          }
        }
        throw error;
      } finally {
        await reservation.close();
        await unlink(lockPath);
      }
      return record;
    }
  }

  async save(record: BackgroundTaskRecord): Promise<void> {
    const snapshot = structuredClone(this.validateRecord(record, record.id));
    return serialize(this.recordPath(record.id), async () => {
      const previous = await this.readRecord(record.id);
      if (
        previous.owner.id !== snapshot.owner.id ||
        previous.toolCallId !== snapshot.toolCallId ||
        previous.kind !== snapshot.kind ||
        previous.runtimeId !== snapshot.runtimeId
      )
        throw new Error(`Cannot change task identity: ${record.id}`);
      if (
        isBackgroundTaskTerminal(previous.status) &&
        (snapshot.status !== previous.status ||
          snapshot.terminalEventId !== previous.terminalEventId)
      )
        throw new Error(`Task ${record.id} is already ${previous.status}.`);
      if (snapshot.elapsedMs < previous.elapsedMs)
        throw new Error("Task elapsed time cannot decrease.");
      if (previous.notificationDelivered && !snapshot.notificationDelivered) {
        throw new Error("A delivered task notification cannot become pending.");
      }
      if (isBackgroundTaskTerminal(snapshot.status)) {
        const output = await open(
          snapshot.outputPath,
          constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
        );
        try {
          await output.sync();
        } finally {
          await output.close();
        }
      }
      await writeTaskStateJson(this.recordPath(record.id), snapshot);
    });
  }

  async appendOutput(taskId: string, text: string): Promise<void> {
    return serialize(this.recordPath(taskId), async () => {
      const record = await this.readRecord(taskId);
      if (isBackgroundTaskTerminal(record.status)) throw new Error(`Task ${taskId} has finished.`);
      const handle = await open(
        record.outputPath,
        constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        await handle.writeFile(text, "utf8");
      } finally {
        await handle.close();
      }
    });
  }

  async readOutputTail(taskId: string, maxChars: number): Promise<string> {
    if (!Number.isSafeInteger(maxChars) || maxChars < 1) {
      throw new Error("Output tail size must be a positive integer.");
    }
    const record = await this.readRecord(taskId);
    const handle = await open(record.outputPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const { size } = await handle.stat();
      const start = Math.max(0, size - Math.min(maxChars, Number.MAX_SAFE_INTEGER / 4) * 4);
      const buffer = Buffer.alloc(size - start);
      let read = 0;
      while (read < buffer.length) {
        const { bytesRead } = await handle.read(buffer, read, buffer.length - read, start + read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      let offset = 0;
      if (start > 0) {
        while (offset < read && (buffer[offset]! & 0xc0) === 0x80) offset += 1;
      }
      return Array.from(buffer.subarray(offset, read).toString("utf8")).slice(-maxChars).join("");
    } finally {
      await handle.close();
    }
  }

  async list(): Promise<BackgroundTaskRecord[]> {
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return [];
      throw error;
    }
    const records: BackgroundTaskRecord[] = [];
    for (const file of files.sort()) {
      if (/^task_[a-f0-9]{12}\.json$/u.test(file)) {
        records.push(await this.readRecord(file.slice(0, -5)));
      }
    }
    return records;
  }

  async recoverInterrupted(
    isOwnerAlive: (owner: BackgroundTaskRecord["owner"]) => Promise<boolean>,
  ): Promise<BackgroundTaskRecord[]> {
    const recovered: BackgroundTaskRecord[] = [];
    for (const record of await this.list()) {
      if (isBackgroundTaskTerminal(record.status) || (await isOwnerAlive(record.owner))) continue;
      const interrupted: BackgroundTaskRecord = {
        ...record,
        status: "interrupted",
        endedAtUnixMs: record.updatedAtUnixMs,
        elapsedApproximate: true,
        terminalEventId: `${record.id}:interrupted`,
        notificationDelivered: false,
      };
      delete interrupted.exitCode;
      await this.save(interrupted);
      recovered.push(interrupted);
    }
    return recovered;
  }
}
