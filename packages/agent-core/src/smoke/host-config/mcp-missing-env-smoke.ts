import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

import { McpService } from "../../mcp/service.js";
import { parseMcpConfigFile } from "../../mcp/config.js";

const MISSING_ENV_NAME = "SPIRIT_AGENT_MCP_MISSING_ENV_SMOKE_TOKEN";

runMcpMissingEnvSmoke().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`mcp missing env smoke failed: ${message}`);
  process.exitCode = 1;
});

async function runMcpMissingEnvSmoke(): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "spirit-mcp-missing-env-"));
  const originalAppData = process.env.APPDATA;
  const originalUserProfile = process.env.USERPROFILE;
  const originalMissingEnv = process.env[MISSING_ENV_NAME];

  try {
    const appData = join(tempRoot, "AppData");
    const dataDir = join(appData, "Spirit");
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, "mcp.json"),
      JSON.stringify(
        {
          servers: {
            smoke: {
              transport: {
                type: "http",
                url: "https://example.invalid/mcp",
                headers: {
                  Authorization: `Bearer ${"${env:" + MISSING_ENV_NAME + "}"}`,
                },
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    process.env.APPDATA = appData;
    delete process.env.USERPROFILE;
    delete process.env[MISSING_ENV_NAME];

    const service = new McpService(tempRoot, false, {
      configSource: {
        scopeKey: dataDir,
        read: () => ({
          user: parseMcpConfigFile(JSON.parse(readFileSync(join(dataDir, "mcp.json"), "utf8"))),
          workspace: { servers: {} },
        }),
      },
    });
    service.startBackgroundRefreshInBackground(true);

    const backgroundSnapshot = await waitForSnapshot(
      service,
      (snapshot) => snapshot.state === "error",
      "background refresh should degrade into MCP error state",
    );

    if (backgroundSnapshot.configuredServers !== 1) {
      throw new Error(
        `background refresh should keep 1 configured server, got ${backgroundSnapshot.configuredServers}`,
      );
    }
    if (
      !backgroundSnapshot.lastError?.includes(`Missing environment variable ${MISSING_ENV_NAME}`)
    ) {
      throw new Error(
        `background refresh error message is incorrect: ${backgroundSnapshot.lastError ?? "<none>"}`,
      );
    }
    if (service.toolDefinitionsJson().length !== 0) {
      throw new Error("background refresh should not keep any MCP tool definitions after failure.");
    }

    let explicitError: unknown;
    try {
      await service.ensureToolingCache();
    } catch (error) {
      explicitError = error;
    }

    if (!(explicitError instanceof Error) || !explicitError.message.includes(MISSING_ENV_NAME)) {
      throw new Error(
        "explicitly awaiting ensureToolingCache() should still surface the missing environment variable error.",
      );
    }

    const explicitSnapshot = service.statusSnapshot();
    if (explicitSnapshot.state !== "error") {
      throw new Error(
        `MCP state should stay error after explicit await failure, got ${explicitSnapshot.state}`,
      );
    }

    console.log("mcp missing env smoke OK", explicitSnapshot);
  } finally {
    restoreEnv("APPDATA", originalAppData);
    restoreEnv("USERPROFILE", originalUserProfile);
    restoreEnv(MISSING_ENV_NAME, originalMissingEnv);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function waitForSnapshot(
  service: McpService,
  predicate: (snapshot: ReturnType<McpService["statusSnapshot"]>) => boolean,
  description: string,
): Promise<ReturnType<McpService["statusSnapshot"]>> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const snapshot = service.statusSnapshot();
    if (predicate(snapshot)) {
      return snapshot;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`${description}; final snapshot=${JSON.stringify(service.statusSnapshot())}`);
}
