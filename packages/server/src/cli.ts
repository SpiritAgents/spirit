import { resolveSpiritDataDir, resolveServerVersion } from "./config.js";
import { product } from "@spiritagent/product";
import { rotateToken, tokenFilePath } from "./auth-token.js";
import { isProcessAlive, listInstances } from "./instance-registry.js";
import { startDaemon } from "./daemon.js";

const USAGE = `spirit-server — ${product.name} shared daemon

Usage:
  spirit-server [serve] [--hostname <host>] [--port <port>]
  spirit-server ps
  spirit-server kill [instanceId]
  spirit-server rotate-token
  spirit-server --version

Commands:
  serve          Run the daemon in the foreground (default command)
  ps             List registered daemon instances (stale entries pruned)
  kill           SIGTERM one instance, or all when instanceId is omitted
  rotate-token   Replace the home-level bearer token; applies to new connections

Options:
  --hostname     Bind hostname (default 127.0.0.1; 0.0.0.0 exposes LAN — use with care)
  --port         Bind port (default 0 = OS-assigned random port)
`;

interface ServeFlags {
  hostname?: string;
  port?: number;
}

function parseServeFlags(args: string[]): ServeFlags {
  const flags: ServeFlags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--hostname") {
      const value = args[++i];
      if (!value) {
        throw new Error("--hostname requires a value");
      }
      flags.hostname = value;
    } else if (arg === "--port") {
      const value = args[++i];
      if (!value) {
        throw new Error("--port requires a value");
      }
      const port = Number.parseInt(value, 10);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`invalid --port: ${value}`);
      }
      flags.port = port;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return flags;
}

async function runServe(args: string[]): Promise<void> {
  process.stderr.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") {
      return;
    }
    throw err;
  });
  const flags = parseServeFlags(args);
  const dataDir = resolveSpiritDataDir();
  const version = resolveServerVersion();
  const daemon = await startDaemon({
    dataDir,
    version,
    ...(flags.hostname !== undefined ? { host: flags.hostname } : {}),
    ...(flags.port !== undefined ? { port: flags.port } : {}),
    onIdleExit: () => {
      process.exit(0);
    },
  });
  console.error(`[spirit-server] data dir: ${dataDir}`);
  console.error(`[spirit-server] token file: ${tokenFilePath(dataDir)}`);

  const shutdown = (signal: string): void => {
    console.error(`[spirit-server] received ${signal}, shutting down`);
    void daemon.close().then(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function runPs(): Promise<void> {
  const dataDir = resolveSpiritDataDir();
  const instances = await listInstances(dataDir);
  if (instances.length === 0) {
    console.log("no running instances");
    return;
  }
  console.log("INSTANCE ID                             PID      PORT   STARTED");
  for (const instance of instances) {
    console.log(
      `${instance.instanceId}  ${String(instance.pid).padEnd(8)} ${String(instance.port).padEnd(6)} ${instance.startedAt}`,
    );
  }
}

async function runKill(args: string[]): Promise<void> {
  const dataDir = resolveSpiritDataDir();
  const targetId = args[0];
  const instances = await listInstances(dataDir);
  const targets = targetId
    ? instances.filter((instance) => instance.instanceId === targetId)
    : instances;
  if (targets.length === 0) {
    console.error(targetId ? `no such instance: ${targetId}` : "no running instances");
    process.exitCode = 1;
    return;
  }
  for (const target of targets) {
    if (!isProcessAlive(target.pid)) {
      continue;
    }
    process.kill(target.pid, "SIGTERM");
    console.log(`sent SIGTERM to instance ${target.instanceId} (pid ${target.pid})`);
  }
}

async function runRotateToken(): Promise<void> {
  const dataDir = resolveSpiritDataDir();
  await rotateToken(dataDir);
  console.log(`rotated token at ${tokenFilePath(dataDir)}`);
  console.log(
    "running daemons pick up the new token for new connections; existing connections are unaffected",
  );
}

export async function runCli(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case "serve":
      await runServe(rest);
      return;
    case "ps":
      await runPs();
      return;
    case "kill":
      await runKill(rest);
      return;
    case "rotate-token":
      await runRotateToken();
      return;
    case "--help":
    case "-h":
      console.log(USAGE);
      return;
    case "--version":
    case "-v":
      console.log(resolveServerVersion());
      return;
    default:
      console.error(`unknown command: ${command}\n\n${USAGE}`);
      process.exitCode = 1;
  }
}
