import { spawn } from "node:child_process";
import { product } from "@spiritagent/product";
import { fileURLToPath } from "node:url";

import { readCurrentToken } from "./auth-token.js";
import { listInstances, type ServerInstanceRecord } from "./instance-registry.js";
import type {
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcSuccessResponse,
} from "./protocol/index.js";

export interface ServerRpcClientOptions {
  url: string;
  token: string;
}

export type ServerNotificationListener = (notification: JsonRpcNotification) => void;
export type ServerDisconnectListener = (error: Error) => void;

export interface ConnectOrSpawnServerOptions {
  dataDir: string;
  entryPath?: string;
  connectTimeoutMs?: number;
  /** Pipe spawned daemon stderr into the parent process (dev ergonomics). */
  forwardStderr?: boolean;
}

export interface ConnectedServer {
  client: ServerRpcClient;
  instance: ServerInstanceRecord;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export class ServerRpcClient {
  private readonly pending = new Map<
    JsonRpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly notificationListeners = new Set<ServerNotificationListener>();
  private readonly disconnectListeners = new Set<ServerDisconnectListener>();
  private nextRequestId = 1;
  private socket: WebSocket | undefined;

  constructor(private readonly options: ServerRpcClientOptions) {}

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    // Node's WebSocket API cannot set Authorization headers; the daemon also
    // accepts ?token= on the upgrade URL (see daemon.ts extractPresentedToken).
    const url = new URL(this.options.url);
    url.searchParams.set("token", this.options.token);
    const socket = new WebSocket(url);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(`failed to connect to ${product.name} Server at ${url.host}`));
      };
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });

    socket.addEventListener("message", (event) => {
      this.handleMessage(String(event.data));
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) {
        this.socket = undefined;
      }
      const error = new Error(`${product.name} Server connection closed`);
      this.rejectPending(error);
      for (const listener of this.disconnectListeners) {
        listener(error);
      }
    });
  }

  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async call<Result = unknown>(method: string, params?: unknown): Promise<Result> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`${product.name} Server is not connected`);
    }
    const id = this.nextRequestId++;
    const response = new Promise<Result>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
      });
    });
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        ...(params === undefined ? {} : { params }),
      }),
    );
    return response;
  }

  onNotification(listener: ServerNotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onDisconnect(listener: ServerDisconnectListener): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  close(): void {
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.rejectPending(new Error(`${product.name} Server client closed`));
  }

  private handleMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") {
      return;
    }
    const record = message as Record<string, unknown>;
    if (record["id"] !== undefined) {
      this.handleResponse(message as JsonRpcResponse);
      return;
    }
    if (typeof record["method"] === "string") {
      for (const listener of this.notificationListeners) {
        listener(message as JsonRpcNotification);
      }
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id as JsonRpcId);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id as JsonRpcId);
    if ("error" in response) {
      pending.reject(new Error(response.error.message));
      return;
    }
    pending.resolve(response.result);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function connectOrSpawnServer(
  options: ConnectOrSpawnServerOptions,
): Promise<ConnectedServer> {
  const dataDir = process.env["SPIRIT_SERVER_DATA_DIR"]?.trim() || options.dataDir;
  const existing = await connectToRegisteredServer(dataDir);
  if (existing) {
    return existing;
  }

  const entryPath = options.entryPath ?? fileURLToPath(new URL("./entry.js", import.meta.url));
  const forwardStderr = options.forwardStderr === true;
  const child = spawn(process.execPath, [entryPath, "serve"], {
    detached: true,
    stdio: forwardStderr ? ["ignore", "ignore", "pipe"] : "ignore",
    env: {
      ...process.env,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      SPIRIT_SERVER_DATA_DIR: dataDir,
    },
  });
  if (forwardStderr && child.stderr) {
    child.stderr.on("data", (chunk: Buffer | string) => {
      process.stderr.write(chunk);
    });
  }
  child.unref();

  const deadline = Date.now() + (options.connectTimeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const connected = await connectToRegisteredServer(dataDir, child.pid);
    if (connected) {
      return connected;
    }
  }
  throw new Error(`timed out waiting for ${product.name} Server to start`);
}

async function connectToRegisteredServer(
  dataDir: string,
  preferredPid?: number,
): Promise<ConnectedServer | undefined> {
  const token = await readCurrentToken(dataDir);
  if (!token) {
    return undefined;
  }
  const instances = await listInstances(dataDir);
  const ordered =
    preferredPid === undefined
      ? [...instances].reverse()
      : [
          ...instances.filter((instance) => instance.pid === preferredPid),
          ...instances.filter((instance) => instance.pid !== preferredPid).reverse(),
        ];
  for (const instance of ordered) {
    if (!isLoopbackHost(instance.host)) {
      continue;
    }
    const client = new ServerRpcClient({
      url: `ws://${instance.host}:${instance.port}`,
      token,
    });
    try {
      await client.connect();
      const health = await client.call<{ instanceId: string }>("server.health");
      if (health.instanceId !== instance.instanceId) {
        throw new Error("daemon health instanceId mismatch");
      }
      return { client, instance };
    } catch {
      client.close();
    }
  }
  return undefined;
}
