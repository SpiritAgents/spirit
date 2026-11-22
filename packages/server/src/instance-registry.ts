import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Instance registry: each running daemon writes one JSON record under
 * `{dataDir}/server/instances/`. Clients attach to a live instance by
 * reading these records; stale records (dead pid) are pruned on read.
 */

export interface ServerInstanceRecord {
  instanceId: string;
  pid: number;
  host: string;
  port: number;
  startedAt: string;
  version: string;
}

export function instancesDir(dataDir: string): string {
  return join(dataDir, "server", "instances");
}

export function instanceFilePath(dataDir: string, instanceId: string): string {
  return join(instancesDir(dataDir), `${instanceId}.json`);
}

export async function registerInstance(
  dataDir: string,
  record: ServerInstanceRecord,
): Promise<void> {
  await mkdir(instancesDir(dataDir), { recursive: true });
  await writeFile(
    instanceFilePath(dataDir, record.instanceId),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
}

export async function unregisterInstance(dataDir: string, instanceId: string): Promise<void> {
  await rm(instanceFilePath(dataDir, instanceId), { force: true });
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseRecord(raw: string): ServerInstanceRecord | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record["instanceId"] !== "string" ||
      typeof record["pid"] !== "number" ||
      typeof record["host"] !== "string" ||
      typeof record["port"] !== "number" ||
      typeof record["startedAt"] !== "string" ||
      typeof record["version"] !== "string"
    ) {
      return null;
    }
    return record as unknown as ServerInstanceRecord;
  } catch {
    return null;
  }
}

export interface ListInstancesOptions {
  /** Remove records whose pid is no longer alive (default true). */
  prune?: boolean;
}

export async function listInstances(
  dataDir: string,
  options: ListInstancesOptions = {},
): Promise<ServerInstanceRecord[]> {
  const prune = options.prune ?? true;
  let files: string[];
  try {
    files = await readdir(instancesDir(dataDir));
  } catch {
    return [];
  }
  const records: ServerInstanceRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }
    let raw: string;
    try {
      raw = await readFile(join(instancesDir(dataDir), file), "utf8");
    } catch (err) {
      // A daemon shutting down concurrently may unregister its record between readdir and readFile.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw err;
    }
    const record = parseRecord(raw);
    if (!record) {
      continue;
    }
    if (prune && !isProcessAlive(record.pid)) {
      await rm(join(instancesDir(dataDir), file), { force: true });
      continue;
    }
    records.push(record);
  }
  records.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return records;
}
