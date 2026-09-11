import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { McpService, type McpExtraConfigProvider } from "../../mcp/service.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "../../..");
const fixtureServer = join(packageRoot, "src/mcp/test-fixtures/relative-stdio-server.mjs");

runMcpStdioCwdSmoke().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mcp stdio cwd smoke failed: ${message}`);
  process.exitCode = 1;
});

async function runMcpStdioCwdSmoke(): Promise<void> {
  const desktopPath = await withTempRoots(async ({ workspaceRoot, dataDir, serverDir }) =>
    loadViaExtraConfigs(workspaceRoot, dataDir, () => ({
      servers: {
        bundled: {
          displayName: "Bundled",
          transport: {
            type: "stdio",
            command: "node",
            args: ["server.mjs"],
            cwd: serverDir,
          },
        },
      },
    })),
  );
  assertLoad("desktop-rewritten-cwd", desktopPath, { tools: 1 });

  const deletedParentWithCwd = await withDeletedParentCwd(
    async (serverDir, workspaceRoot, dataDir) =>
      loadViaExtraConfigs(workspaceRoot, dataDir, () => ({
        servers: {
          bundled: {
            transport: {
              type: "stdio",
              command: "node",
              args: ["server.mjs"],
              cwd: serverDir,
            },
          },
        },
      })),
  );
  assertLoad("deleted-parent-cwd-with-spawn-cwd", deletedParentWithCwd, { tools: 1 });

  const deletedParentAbsoluteEntry = await withDeletedParentCwd(
    async (serverDir, workspaceRoot, dataDir) =>
      loadViaExtraConfigs(workspaceRoot, dataDir, () => ({
        servers: {
          bundled: {
            transport: {
              type: "stdio",
              command: "node",
              args: [join(serverDir, "server.mjs")],
            },
          },
        },
      })),
  );
  assertLoad("deleted-parent-cwd-absolute-entry", deletedParentAbsoluteEntry, { tools: 1 });

  const deletedParentNoCwd = await withDeletedParentCwd(
    async (_serverDir, workspaceRoot, dataDir) =>
      loadViaExtraConfigs(workspaceRoot, dataDir, () => ({
        servers: {
          bundled: {
            transport: {
              type: "stdio",
              command: "node",
              args: ["server.mjs"],
            },
          },
        },
      })),
  );
  if (hasUvCwd(deletedParentNoCwd.lastError)) {
    throw new Error(
      `deleted-parent-cwd-relative-entry should not fail with uv_cwd after spawn cwd fallback, lastError=${deletedParentNoCwd.lastError}`,
    );
  }

  const staleCwd = await withTempRoots(async ({ workspaceRoot, dataDir, serverDir }) => {
    const backupDir = `${serverDir}.renamed`;
    await rename(serverDir, backupDir);
    try {
      return await loadViaExtraConfigs(workspaceRoot, dataDir, () => ({
        servers: {
          bundled: {
            transport: {
              type: "stdio",
              command: "node",
              args: [join(backupDir, "server.mjs")],
              cwd: serverDir,
            },
          },
        },
      }));
    } finally {
      await rename(backupDir, serverDir);
    }
  });
  assertLoad("stale-spawn-cwd-absolute-entry", staleCwd, { tools: 1 });

  const rawDeadParentNoCwd = await withDeletedParentCwd(async () => spawnRelativeNode({}));
  if (!hasUvCwd(rawDeadParentNoCwd.stderr)) {
    throw new Error(
      "raw-spawn-dead-parent-no-cwd should still document Node uv_cwd on a relative entry",
    );
  }

  console.log("mcp stdio cwd smoke OK", {
    desktopPath,
    deletedParentWithCwd,
    deletedParentAbsoluteEntry,
    deletedParentNoCwd,
    staleCwd,
  });
}

async function loadViaExtraConfigs(
  workspaceRoot: string,
  dataDir: string,
  extraConfigs: McpExtraConfigProvider,
): Promise<{ tools: number; state: string; lastError?: string }> {
  const previousDataDir = process.env.SPIRIT_DATA_DIR;
  process.env.SPIRIT_DATA_DIR = dataDir;
  try {
    const service = new McpService(workspaceRoot, true, { extraConfigs });
    await service.ensureToolingCache();
    const snapshot = service.statusSnapshot();
    const catalog = service.catalogSnapshot();
    const server = catalog.servers[0];
    return {
      tools: snapshot.cachedTools,
      state: server?.state ?? snapshot.state,
      ...(server?.lastError
        ? { lastError: server.lastError }
        : snapshot.lastError
          ? { lastError: snapshot.lastError }
          : {}),
    };
  } finally {
    restoreEnv("SPIRIT_DATA_DIR", previousDataDir);
  }
}

async function spawnRelativeNode(options: { cwd?: string }): Promise<{
  started: boolean;
  exitCode: number | null;
  stderr: string;
}> {
  return await new Promise((resolve) => {
    const child = spawn("node", ["server.mjs"], {
      stdio: ["ignore", "ignore", "pipe"],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    const chunks: string[] = [];
    let started = false;
    child.stderr.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    child.on("spawn", () => {
      started = true;
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, 400);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        started,
        exitCode: 1,
        stderr: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ started, exitCode, stderr: chunks.join("") });
    });
  });
}

async function withTempRoots<T>(
  run: (paths: { workspaceRoot: string; dataDir: string; serverDir: string }) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "spirit-mcp-stdio-cwd-"));
  const workspaceRoot = join(root, "workspace");
  const dataDir = join(root, "data");
  const serverDir = join(root, "extension");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(serverDir, { recursive: true });
  await copyFile(fixtureServer, join(serverDir, "server.mjs"));
  try {
    return await run({ workspaceRoot, dataDir, serverDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withDeletedParentCwd<T>(
  run: (serverDir: string, workspaceRoot: string, dataDir: string) => Promise<T>,
): Promise<T> {
  const previousCwd = safeCwd();
  return withTempRoots(async ({ workspaceRoot, dataDir, serverDir }) => {
    const doomed = await mkdtemp(join(tmpdir(), "spirit-mcp-dead-cwd-"));
    process.chdir(doomed);
    await rm(doomed, { recursive: true, force: true });
    try {
      return await run(serverDir, workspaceRoot, dataDir);
    } finally {
      if (previousCwd) {
        process.chdir(previousCwd);
      }
    }
  });
}

function assertLoad(
  name: string,
  result: { tools: number; state: string; lastError?: string },
  expected: { tools: number },
): void {
  if (result.tools !== expected.tools || hasUvCwd(result.lastError)) {
    throw new Error(
      `${name} expected tools=${expected.tools} without uv_cwd, got tools=${result.tools} state=${result.state} lastError=${result.lastError ?? "<none>"}`,
    );
  }
}

function safeCwd(): string | undefined {
  try {
    return process.cwd();
  } catch {
    return undefined;
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function hasUvCwd(text: string | undefined): boolean {
  return Boolean(text?.includes("uv_cwd") || text?.includes("process.cwd failed"));
}
