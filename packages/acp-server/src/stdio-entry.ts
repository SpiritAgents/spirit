#!/usr/bin/env node

/**
 * ACP Server stdio entry point.
 *
 * Launches the Spirit ACP server using ndJSON over stdin/stdout.
 * All logging is redirected to stderr to avoid polluting the ndJSON stream.
 *
 * Usage:
 *   node dist/stdio-entry.js              — ACP ndJSON server
 *   node dist/stdio-entry.js --setup      — interactive provider setup (Terminal Auth)
 *
 * Environment variables:
 *   SPIRIT_ACP_WORKSPACE — Optional. Workspace root (default: cwd).
 *   SPIRIT_ACP_DATA_DIR  — Optional. Spirit data directory (same as SPIRIT_DATA_DIR).
 */

import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { createInitialAuthState } from "./auth/session-auth.js";
import { SpiritAcpAgent } from "./acp-agent.js";
import { loadBaseConfig } from "./config.js";

// Redirect console.log → stderr to prevent polluting the ndJSON stdout stream.
console.log = (...args: unknown[]) => {
  console.error(...args);
};

// Handle uncaught errors gracefully — write to stderr, never stdout
process.on("uncaughtException", (err) => {
  console.error("[acp-server] Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[acp-server] Unhandled rejection:", reason);
});

async function main(): Promise<void> {
  if (process.argv.includes("--setup")) {
    const { runSetup } = await import("./setup/run-setup.js");
    await runSetup();
    return;
  }

  const config = loadBaseConfig();
  const authState = createInitialAuthState(config);

  const output = Writable.toWeb(process.stdout);
  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(output, input);

  let agent: SpiritAcpAgent | undefined;
  const connection = new acp.AgentSideConnection((conn) => {
    agent = new SpiritAcpAgent(conn, config, authState);
    return agent;
  }, stream);
  let shutdown: Promise<void> | undefined;
  const stop = () => (shutdown ??= agent?.shutdown() ?? Promise.resolve());
  const onSignal = () => {
    void stop()
      .catch((error: unknown) => {
        console.error("[acp-server] Shutdown failed:", error);
        process.exitCode = 1;
      })
      .finally(() => process.exit(process.exitCode ?? 0));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await connection.closed;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await stop();
  }
}

main().catch((err) => {
  console.error("[acp-server] Fatal error:", err);
  process.exitCode = 1;
});
