import { randomBytes } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import path from "node:path";
import type { BackgroundTaskRecord } from "@spiritagent/agent-core";

type TaskOwner = BackgroundTaskRecord["owner"];

function ownerEndpoint(spiritDataDir: string, id: string): string {
  if (!/^[a-f0-9]{16}$/u.test(id)) throw new Error("Invalid background task owner identity.");
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\spirit-task-${id}`
      : path.join(spiritDataDir, "task-owners", `${id}.sock`);
  const limit = process.platform === "darwin" ? 103 : 107;
  if (process.platform !== "win32" && Buffer.byteLength(endpoint) > limit) {
    throw new Error(
      "The Spirit data directory is too long for local task IPC. Choose a shorter data directory.",
    );
  }
  return endpoint;
}

export interface BackgroundTaskOwner {
  owner: TaskOwner;
  close(): Promise<void>;
}

/** An instance-specific local IPC endpoint proves ownership without relying on a reusable PID. */
export async function createBackgroundTaskOwner(
  spiritDataDir: string,
): Promise<BackgroundTaskOwner> {
  const owner = { id: randomBytes(8).toString("hex"), pid: process.pid };
  const endpoint = ownerEndpoint(spiritDataDir, owner.id);
  if (process.platform !== "win32") {
    await mkdir(path.dirname(endpoint), { recursive: true, mode: 0o700 });
  }
  const server = createServer((socket) => {
    socket.on("error", (error) => {
      console.error("[background-task-owner] IPC response failed:", error.message);
    });
    socket.end(JSON.stringify(owner));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  if (process.platform !== "win32") {
    try {
      await chmod(endpoint, 0o600);
    } catch (error) {
      await new Promise<void>((resolve, reject) =>
        server.close((closeError) =>
          closeError
            ? reject(
                new AggregateError(
                  [error, closeError],
                  "Task owner initialization and cleanup failed.",
                ),
              )
            : resolve(),
        ),
      );
      throw error;
    }
  }
  server.unref();
  return {
    owner,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export async function isBackgroundTaskOwnerAlive(
  spiritDataDir: string,
  owner: TaskOwner,
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const socket = createConnection(ownerEndpoint(spiritDataDir, owner.id));
    let text = "";
    socket.setTimeout(2000, () => {
      socket.destroy(new Error("Background task owner did not answer its local IPC probe."));
    });
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      if (text.length > 1024) socket.destroy(new Error("Invalid task owner response."));
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
    socket.once("end", () => {
      try {
        const response: unknown = JSON.parse(text);
        if (
          typeof response !== "object" ||
          response === null ||
          !("id" in response) ||
          response.id !== owner.id ||
          !("pid" in response) ||
          response.pid !== owner.pid
        )
          throw new Error("Background task owner identity mismatch.");
        resolve(true);
      } catch (error) {
        reject(error);
      } finally {
        socket.destroy();
      }
    });
  });
}
