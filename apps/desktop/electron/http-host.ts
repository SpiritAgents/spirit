import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import path from "node:path";

import {
  parseModelProviderId,
  parsePresetModelProviderId,
} from "@spiritagent/host-internal/model-provider-presets";

import type { HostCommandName } from "../src/host/contracts.js";

import i18nHost from "../src/lib/i18n-host.js";
import { parseChipNavigateMeta } from "../src/lib/composer-chip-navigate-meta.js";

export const DEFAULT_DESKTOP_WEB_HOST = "127.0.0.1";
export const DEFAULT_DESKTOP_WEB_PORT = 7788;

export type DesktopHostCommandInvoker = (
  command: HostCommandName,
  payload?: unknown,
) => Promise<unknown>;

export type DesktopHostCommandResultHandler = (
  command: HostCommandName,
  payload: unknown,
  result: unknown,
) => void | Promise<void>;

export type DesktopHostUpdateSubscriber = (listener: (snapshot: unknown) => void) => () => void;

export interface DesktopHttpHostState {
  host: string;
  port: number;
  running: boolean;
  url?: string;
  error?: string;
}

export interface DesktopHttpAuthOptions {
  getTokenHash(): string | undefined;
  getPairingCode(): string;
  completePairing(authTokenHash: string): Promise<void>;
  /** Called when the pairing failure limit is reached; the host should void the current pairing code and regenerate it after restarting the Web Host. */
  onPairingLockout?(): void;
}

export interface DesktopHttpStaticOptions {
  root: string;
  spaFallback?: boolean;
}

export interface DesktopHttpHostOptions {
  host: string;
  port: number;
  invokeHostCommand: DesktopHostCommandInvoker;
  onHostCommandResult?: DesktopHostCommandResultHandler;
  subscribeHostUpdates?: DesktopHostUpdateSubscriber;
  auth?: DesktopHttpAuthOptions;
  static?: DesktopHttpStaticOptions;
  logger?: Pick<Console, "error" | "log">;
}

export interface DesktopHttpHost {
  getState(): DesktopHttpHostState;
  isRunning(): boolean;
  start(): Promise<DesktopHttpHostState>;
  stop(): Promise<DesktopHttpHostState>;
}

export function createDesktopHttpHost(options: DesktopHttpHostOptions): DesktopHttpHost {
  const logger = options.logger ?? console;
  let server: Server | undefined;
  let state: DesktopHttpHostState = {
    host: options.host,
    port: options.port,
    running: false,
  };

  return {
    getState() {
      return { ...state };
    },
    isRunning() {
      return server?.listening === true;
    },
    async start() {
      if (server?.listening) {
        return { ...state };
      }

      const nextServer = createServer(
        createDesktopHttpRequestHandler({
          host: options.host,
          invokeHostCommand: options.invokeHostCommand,
          onHostCommandResult: options.onHostCommandResult,
          subscribeHostUpdates: options.subscribeHostUpdates,
          auth: options.auth,
          static: options.static,
        }),
      );
      server = nextServer;

      try {
        await new Promise<void>((resolve, reject) => {
          const handleError = (error: Error) => {
            nextServer.off("listening", handleListening);
            reject(error);
          };
          const handleListening = () => {
            nextServer.off("error", handleError);
            resolve();
          };

          nextServer.once("error", handleError);
          nextServer.once("listening", handleListening);
          nextServer.listen(options.port, options.host);
        });

        state = {
          host: options.host,
          port: options.port,
          running: true,
          url: `http://${options.host}:${options.port}`,
        };
        logger.log(`Spirit desktop web host listening on ${state.url}`);
        return { ...state };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state = {
          host: options.host,
          port: options.port,
          running: false,
          error: message,
        };
        server = undefined;
        throw error;
      }
    },
    async stop() {
      const current = server;
      if (!current) {
        state = { ...state, running: false };
        return { ...state };
      }

      await new Promise<void>((resolve, reject) => {
        current.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      server = undefined;
      state = {
        host: options.host,
        port: options.port,
        running: false,
      };
      return { ...state };
    },
  };
}

export const MAX_PAIRING_FAILURES = 5;

export function createDesktopHttpRequestHandler({
  host,
  invokeHostCommand,
  onHostCommandResult,
  subscribeHostUpdates,
  auth,
  static: staticOptions,
}: {
  /** The host the service listens on; used for Host header validation (DNS rebinding protection). */
  host: string;
  invokeHostCommand: DesktopHostCommandInvoker;
  onHostCommandResult?: DesktopHostCommandResultHandler;
  subscribeHostUpdates?: DesktopHostUpdateSubscriber;
  auth?: DesktopHttpAuthOptions;
  static?: DesktopHttpStaticOptions;
}) {
  // The pairing failure count lives with the handler (i.e. a single Web Host run cycle);
  // it only resets when the Web Host is restarted.
  let pairingFailureCount = 0;

  return async (request: IncomingMessage, response: ServerResponse) => {
    const runHostCommand = async (command: HostCommandName, payload?: unknown) => {
      const result = await invokeHostCommand(command, payload);
      if (onHostCommandResult) {
        response.once("finish", () => {
          void onHostCommandResult(command, payload, result);
        });
      }
      return result;
    };

    try {
      if (!request.url) {
        writeJson(request, response, 400, { error: i18nHost.t("webHost.error.missingPath") });
        return;
      }

      const { pathname } = new URL(request.url, "http://localhost");

      if (pathname.startsWith("/api/") && !isAllowedRequestHostHeader(request.headers.host, host)) {
        writeJson(request, response, 403, { error: "Host header is not allowed." });
        return;
      }

      if (request.method === "OPTIONS") {
        if (!writeCors(request, response)) {
          writeJson(request, response, 403, { error: "CORS origin is not allowed." });
          return;
        }
        response.writeHead(204);
        response.end();
        return;
      }

      if (pathname.startsWith("/api/")) {
        await handleApiRequest({
          request,
          response,
          pathname,
          runHostCommand,
          auth,
          subscribeHostUpdates,
          onPairingFailure: () => {
            pairingFailureCount += 1;
            if (pairingFailureCount === MAX_PAIRING_FAILURES) {
              auth?.onPairingLockout?.();
            }
          },
          isPairingLocked: () => pairingFailureCount >= MAX_PAIRING_FAILURES,
        });
        return;
      }

      if (staticOptions) {
        await serveStaticRequest(request, response, pathname, staticOptions);
        return;
      }

      writeJson(request, response, 404, { error: `Unknown route: ${request.method} ${pathname}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(request, response, 500, { error: message });
    }
  };
}

export function resolveDesktopWebHostFromEnv(): { host: string; port: number } {
  const host = process.env.SPIRIT_WEB_HOST?.trim() || DEFAULT_DESKTOP_WEB_HOST;
  const parsedPort = Number.parseInt(process.env.SPIRIT_WEB_PORT ?? "", 10);
  const port = Number.isFinite(parsedPort) ? parsedPort : DEFAULT_DESKTOP_WEB_PORT;
  return { host, port };
}

export function createDesktopWebPairingCode(): string {
  return String(randomInt(100000, 1000000));
}

export function createDesktopWebAuthToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDesktopWebAuthToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function handleApiRequest({
  request,
  response,
  pathname,
  runHostCommand,
  auth,
  subscribeHostUpdates,
  onPairingFailure,
  isPairingLocked,
}: {
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
  runHostCommand: (command: HostCommandName, payload?: unknown) => Promise<unknown>;
  auth?: DesktopHttpAuthOptions;
  subscribeHostUpdates?: DesktopHostUpdateSubscriber;
  onPairingFailure: () => void;
  isPairingLocked: () => boolean;
}): Promise<void> {
  if (request.method === "GET" && pathname === "/api/pairing/status") {
    writeJson(request, response, 200, {
      authMode: "pairing",
      paired: Boolean(auth?.getTokenHash()),
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/pairing") {
    if (!auth) {
      writeJson(request, response, 404, { error: `Unknown route: ${request.method} ${pathname}` });
      return;
    }

    if (isPairingLocked()) {
      writeJson(request, response, 429, {
        code: "PAIRING_LOCKED",
        error: i18nHost.t("webHost.error.pairingLocked"),
      });
      return;
    }

    const body = await readJsonBody(request);
    const jsonBody = isJsonObject(body) ? body : undefined;
    const code = typeof jsonBody?.code === "string" ? jsonBody.code.trim() : "";
    const expectedCode = auth.getPairingCode();
    if (!code || !expectedCode || !safePairingCodeEquals(code, expectedCode)) {
      onPairingFailure();
      writeJson(request, response, 401, {
        code: "PAIRING_FAILED",
        error: i18nHost.t("webHost.error.pairingFailed"),
      });
      return;
    }

    const token = createDesktopWebAuthToken();
    await auth.completePairing(hashDesktopWebAuthToken(token));
    writeJson(request, response, 200, { token });
    return;
  }

  if (auth && !isAuthorizedRequest(request, auth.getTokenHash())) {
    writeJson(request, response, 401, {
      code: "PAIRING_REQUIRED",
      error: i18nHost.t("webHost.error.pairingRequired"),
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/events") {
    if (!subscribeHostUpdates) {
      writeJson(request, response, 404, { error: "Host updates are unavailable." });
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    response.write("\n");
    const unsubscribe = subscribeHostUpdates((snapshot) => {
      if (!response.destroyed) {
        response.write(`${JSON.stringify(snapshot)}\n`);
      }
    });
    await new Promise<void>((resolve) => {
      let closed = false;
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        unsubscribe();
        resolve();
      };
      response.once("close", close);
      request.once("aborted", close);
    });
    return;
  }

  const body = request.method === "GET" ? undefined : await readJsonBody(request);
  const jsonBody = isJsonObject(body) ? body : undefined;

  if (request.method === "GET" && pathname === "/api/health") {
    writeJson(request, response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && pathname === "/api/sessions") {
    writeJson(request, response, 200, await runHostCommand("listSessions"));
    return;
  }

  if (request.method === "GET" && pathname === "/api/dreams") {
    writeJson(request, response, 200, await runHostCommand("listDreamsOverview"));
    return;
  }

  if (request.method === "POST" && pathname === "/api/bootstrap") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("bootstrap", { request: jsonBody ?? {} }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/config") {
    writeJson(request, response, 200, await runHostCommand("updateConfig", { request: jsonBody }));
    return;
  }

  if (request.method === "POST" && pathname === "/api/models/preview") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("previewModels", {
        request: {
          apiBase: typeof jsonBody?.apiBase === "string" ? jsonBody.apiBase : "",
          apiKey: typeof jsonBody?.apiKey === "string" ? jsonBody.apiKey : "",
          forceRefresh: jsonBody?.forceRefresh === true,
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/models/add-provider") {
    const modelIds = Array.isArray(jsonBody?.modelIds)
      ? jsonBody.modelIds.filter((id: unknown): id is string => typeof id === "string")
      : [];
    const provider = parseModelProviderId(jsonBody?.provider);
    writeJson(
      request,
      response,
      200,
      await runHostCommand("addProviderModels", {
        request: {
          apiBase: typeof jsonBody?.apiBase === "string" ? jsonBody.apiBase : "",
          apiKey: typeof jsonBody?.apiKey === "string" ? jsonBody.apiKey : "",
          modelIds,
          ...(provider ? { provider } : {}),
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/models") {
    writeJson(request, response, 200, await runHostCommand("addModel", { request: jsonBody }));
    return;
  }

  if (request.method === "POST" && pathname === "/api/models/remove") {
    const name = typeof jsonBody?.name === "string" ? jsonBody.name : "";
    writeJson(request, response, 200, await runHostCommand("removeModel", { request: { name } }));
    return;
  }

  if (request.method === "POST" && pathname === "/api/models/remove-provider") {
    const provider = parsePresetModelProviderId(jsonBody?.provider);
    if (!provider) {
      writeJson(request, response, 400, { error: i18nHost.t("webHost.error.invalidProvider") });
      return;
    }
    writeJson(
      request,
      response,
      200,
      await runHostCommand("removeProviderModels", { request: { provider } }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/mcps") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("addMcpServer", {
        request: {
          name: typeof jsonBody?.name === "string" ? jsonBody.name : "",
          scope: jsonBody?.scope === "workspace" ? "workspace" : "user",
          transportType: jsonBody?.transportType === "http" ? "http" : "stdio",
          endpoint: typeof jsonBody?.endpoint === "string" ? jsonBody.endpoint : "",
          metadata: typeof jsonBody?.metadata === "string" ? jsonBody.metadata : "",
          capabilities:
            typeof jsonBody?.capabilities === "object" && jsonBody?.capabilities !== null
              ? jsonBody.capabilities
              : undefined,
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/mcps/remove") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("deleteMcpServer", {
        request: {
          name: typeof jsonBody?.name === "string" ? jsonBody.name : "",
          scope: jsonBody?.scope === "workspace" ? "workspace" : "user",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/hooks") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("saveHookEntry", {
        request: jsonBody ?? {},
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/hooks/remove") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("deleteHookEntry", {
        request: jsonBody ?? {},
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/mcps/inspect") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("inspectMcpServer", {
        name: typeof jsonBody?.name === "string" ? jsonBody.name : "",
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/extensions") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("importExtension", {
        request: {
          archiveBase64: typeof jsonBody?.archiveBase64 === "string" ? jsonBody.archiveBase64 : "",
          fileName: typeof jsonBody?.fileName === "string" ? jsonBody.fileName : undefined,
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/extensions/install-built-in") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("installBuiltInExtension", {
        request: {
          id: typeof jsonBody?.id === "string" ? jsonBody.id : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/extensions/install") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("installMarketplaceExtension", {
        request: {
          name: typeof jsonBody?.name === "string" ? jsonBody.name : "",
          marketplace: typeof jsonBody?.marketplace === "string" ? jsonBody.marketplace : undefined,
          reviewAcknowledged: jsonBody?.reviewAcknowledged === true,
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/extensions/update") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("updateExtension", {
        request: {
          id: typeof jsonBody?.id === "string" ? jsonBody.id : "",
          reviewAcknowledged: jsonBody?.reviewAcknowledged === true,
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/marketplaces/add") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("addMarketplaceSource", {
        request: {
          locator: typeof jsonBody?.locator === "string" ? jsonBody.locator : "",
          ref: typeof jsonBody?.ref === "string" ? jsonBody.ref : undefined,
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/marketplaces/remove") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("removeMarketplaceSource", {
        request: {
          name: typeof jsonBody?.name === "string" ? jsonBody.name : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/extensions/enabled") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("setExtensionEnabled", {
        request: {
          id: typeof jsonBody?.id === "string" ? jsonBody.id : "",
          enabled: jsonBody?.enabled === true,
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/extensions/remove") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("deleteExtension", {
        request: {
          id: typeof jsonBody?.id === "string" ? jsonBody.id : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/extensions/run") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("runExtension", {
        request: {
          id: typeof jsonBody?.id === "string" ? jsonBody.id : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/skills") {
    const rootKind = parseSkillRootKind(jsonBody?.rootKind);
    writeJson(
      request,
      response,
      200,
      await runHostCommand("createSkill", {
        request: {
          name: typeof jsonBody?.name === "string" ? jsonBody.name : "",
          rootKind,
          summary: typeof jsonBody?.summary === "string" ? jsonBody.summary : "",
          content: typeof jsonBody?.content === "string" ? jsonBody.content : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/skills/remove") {
    const name = typeof jsonBody?.name === "string" ? jsonBody.name : "";
    const rootKind = parseSkillRootKind(jsonBody?.rootKind);
    writeJson(
      request,
      response,
      200,
      await runHostCommand("deleteSkill", { request: { name, rootKind } }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/rules") {
    const rootKind = parseSkillRootKind(jsonBody?.rootKind);
    writeJson(
      request,
      response,
      200,
      await runHostCommand("createRule", {
        request: {
          rootKind,
          description: typeof jsonBody?.description === "string" ? jsonBody.description : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/rules/remove") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("deleteRule", {
        request: {
          id: typeof jsonBody?.id === "string" ? jsonBody.id : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/skills/submit") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("submitSkillSlash", {
        request: {
          skillName: typeof jsonBody?.skillName === "string" ? jsonBody.skillName : "",
          rawText: typeof jsonBody?.rawText === "string" ? jsonBody.rawText : "",
          extraNote: typeof jsonBody?.extraNote === "string" ? jsonBody.extraNote : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/git/chip") {
    const action = jsonBody?.action;
    if (action !== "commit" && action !== "push" && action !== "merge") {
      writeJson(request, response, 400, { error: "Invalid git chip action" });
      return;
    }
    writeJson(
      request,
      response,
      200,
      await runHostCommand("submitGitChip", {
        request: {
          action,
          ...(typeof jsonBody?.extraNote === "string" && jsonBody.extraNote.trim()
            ? { extraNote: jsonBody.extraNote }
            : {}),
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/start-implementing") {
    writeJson(request, response, 200, await runHostCommand("submitStartImplementing"));
    return;
  }

  if (request.method === "POST" && pathname === "/api/compact") {
    writeJson(request, response, 200, await runHostCommand("compactHistory"));
    return;
  }

  if (request.method === "POST" && pathname === "/api/submit") {
    const submitSessionPath =
      typeof jsonBody?.sessionPath === "string" ? jsonBody.sessionPath.trim() : "";
    writeJson(
      request,
      response,
      200,
      await runHostCommand("submitUserTurn", {
        text: typeof jsonBody?.text === "string" ? jsonBody.text : "",
        ...(submitSessionPath ? { sessionPath: submitSessionPath } : {}),
        ...(Array.isArray(jsonBody?.localFilePaths)
          ? { localFilePaths: jsonBody.localFilePaths }
          : {}),
        ...(Array.isArray(jsonBody?.referencedWorkspaceFilePaths)
          ? { referencedWorkspaceFilePaths: jsonBody.referencedWorkspaceFilePaths }
          : {}),
        ...(Array.isArray(jsonBody?.skillChipAliases)
          ? { skillChipAliases: jsonBody.skillChipAliases }
          : {}),
        ...optionalChipNavigateMetaFromBody(jsonBody?.chipNavigateMeta),
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/loop") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("setLoopEnabled", {
        enabled: jsonBody?.enabled === true,
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/approval") {
    if (jsonBody?.decision !== undefined) {
      writeJson(
        request,
        response,
        200,
        await runHostCommand("replyPendingApproval", {
          request: {
            decision: normalizeApprovalDecisionPayload(jsonBody.decision),
            ...(typeof jsonBody.sessionPath === "string"
              ? { sessionPath: jsonBody.sessionPath }
              : {}),
          },
        }),
      );
      return;
    }

    writeJson(
      request,
      response,
      200,
      await runHostCommand("setApprovalLevel", {
        approvalLevel: jsonBody?.approvalLevel,
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspace-capability-trust") {
    const decision = jsonBody?.decision;
    if (decision !== "allowOnce" && decision !== "deny" && decision !== "alwaysTrust") {
      writeJson(request, response, 400, { error: "invalid workspace capability trust decision" });
      return;
    }
    writeJson(
      request,
      response,
      200,
      await runHostCommand("replyWorkspaceCapabilityTrust", {
        request: { decision },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/git/pending-branch") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("setPendingGitBranch", {
        branch: typeof jsonBody?.branch === "string" ? jsonBody.branch : "",
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/git/work-location") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("setWorkLocation", {
        workLocation: jsonBody?.workLocation,
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/git/checkout") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("checkoutGitBranch", {
        branch: typeof jsonBody?.branch === "string" ? jsonBody.branch : "",
        discardLocalChanges: jsonBody?.discardLocalChanges === true,
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/git/merge-worktree") {
    writeJson(request, response, 200, await runHostCommand("mergeWorktreeToMain"));
    return;
  }

  if (request.method === "POST" && pathname === "/api/git/push") {
    writeJson(request, response, 200, await runHostCommand("pushGitBranch"));
    return;
  }

  if (request.method === "POST" && pathname === "/api/git/refresh-snapshot") {
    writeJson(request, response, 200, await runHostCommand("refreshGitSnapshot"));
    return;
  }

  if (request.method === "POST" && pathname === "/api/git/commit") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("commitChanges", {
        request: typeof jsonBody?.message === "string" ? { message: jsonBody.message } : {},
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/git/working-tree") {
    writeJson(request, response, 200, await runHostCommand("readGitWorkingTree"));
    return;
  }

  if (request.method === "POST" && pathname === "/api/git/history") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("readGitHistory", {
        request: {
          ...(typeof jsonBody?.maxCount === "number" ? { maxCount: jsonBody.maxCount } : {}),
          ...(typeof jsonBody?.skip === "number" ? { skip: jsonBody.skip } : {}),
          ...(Array.isArray(jsonBody?.existingLogCommits)
            ? { existingLogCommits: jsonBody.existingLogCommits }
            : {}),
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/git/commit-message") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("readGitCommitMessage", {
        request: {
          oid: typeof jsonBody?.oid === "string" ? jsonBody.oid : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/rewind-submit") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("rewindAndSubmitMessage", {
        request: {
          messageId: typeof jsonBody?.messageId === "number" ? jsonBody.messageId : NaN,
          text: typeof jsonBody?.text === "string" ? jsonBody.text : "",
          ...(Array.isArray(jsonBody?.localFilePaths)
            ? {
                localFilePaths: jsonBody.localFilePaths.filter(
                  (item): item is string => typeof item === "string",
                ),
              }
            : {}),
          ...optionalChipNavigateMetaFromBody(jsonBody?.chipNavigateMeta),
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/fork-session") {
    const listIndex =
      typeof jsonBody?.listIndex === "number" && Number.isFinite(jsonBody.listIndex)
        ? jsonBody.listIndex
        : undefined;
    writeJson(
      request,
      response,
      200,
      await runHostCommand("forkSession", {
        request: {
          messageId: typeof jsonBody?.messageId === "number" ? jsonBody.messageId : NaN,
          ...(listIndex !== undefined ? { listIndex } : {}),
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/queue/reorder") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("reorderQueuedUserTurn", {
        request: {
          queueId: typeof jsonBody?.queueId === "string" ? jsonBody.queueId : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/queue/send-now") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("sendQueuedUserTurnNow", {
        request: {
          queueId: typeof jsonBody?.queueId === "string" ? jsonBody.queueId : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/queue/remove") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("removeQueuedUserTurn", {
        request: {
          queueId: typeof jsonBody?.queueId === "string" ? jsonBody.queueId : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/poll") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand(
        "poll",
        typeof jsonBody?.sessionPath === "string"
          ? { sessionPath: jsonBody.sessionPath }
          : undefined,
      ),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/subagent-viewer-target") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("setSubagentViewerTarget", {
        parentToolCallId:
          typeof jsonBody?.parentToolCallId === "string" || jsonBody?.parentToolCallId === null
            ? jsonBody.parentToolCallId
            : null,
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/abort") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand(
        "abortConversation",
        typeof jsonBody?.sessionPath === "string" && jsonBody.sessionPath.trim()
          ? { sessionPath: jsonBody.sessionPath.trim() }
          : {},
      ),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/abort-shell-command") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("abortShell", {
        toolCallId: typeof jsonBody?.toolCallId === "string" ? jsonBody.toolCallId : "",
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/continue") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("continueAssistantCompletion", {
        messageId: typeof jsonBody?.messageId === "number" ? jsonBody.messageId : NaN,
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/questions") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("replyPendingQuestions", {
        request: {
          result: jsonBody?.result,
          ...(typeof jsonBody?.sessionPath === "string"
            ? { sessionPath: jsonBody.sessionPath }
            : {}),
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/reset") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("resetSession", {
        activate: false,
        ...(jsonBody?.clientHost ? { clientHost: jsonBody.clientHost } : {}),
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/open") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("openSession", {
        path: typeof jsonBody?.path === "string" ? jsonBody.path : "",
        // HTTP clients are remote viewers; never steal the desktop foreground session.
        activate: false,
        ...(jsonBody?.clientHost ? { clientHost: jsonBody.clientHost } : {}),
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/split/begin") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("beginSplitPaneSession", {
        request: {
          paneId: typeof jsonBody?.paneId === "string" ? jsonBody.paneId : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/side-chat/begin") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("beginSideChatPaneSession", {
        request: {
          paneId: typeof jsonBody?.paneId === "string" ? jsonBody.paneId : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/side-chat/fork") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("forkSessionIntoSideChat", {
        request: {
          sourceSessionPath:
            typeof jsonBody?.sourceSessionPath === "string" ? jsonBody.sourceSessionPath : "",
          targetPaneId: typeof jsonBody?.targetPaneId === "string" ? jsonBody.targetPaneId : "",
          messageId: typeof jsonBody?.messageId === "number" ? jsonBody.messageId : Number.NaN,
          listIndex: typeof jsonBody?.listIndex === "number" ? jsonBody.listIndex : undefined,
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/split/visible") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("setVisiblePaneSessions", {
        request: {
          sessionPaths: Array.isArray(jsonBody?.sessionPaths)
            ? jsonBody.sessionPaths.filter((entry): entry is string => typeof entry === "string")
            : [],
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/split/sync") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("syncSplitPaneSessions", {
        request: {
          sessionPaths: Array.isArray(jsonBody?.sessionPaths)
            ? jsonBody.sessionPaths.filter((entry): entry is string => typeof entry === "string")
            : [],
          focusSessionPath:
            typeof jsonBody?.focusSessionPath === "string" ? jsonBody.focusSessionPath : undefined,
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/split/focus") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("focusPaneSession", {
        request: {
          sessionPath: typeof jsonBody?.sessionPath === "string" ? jsonBody.sessionPath : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/split/close") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("closeSplitPaneSession", {
        request: {
          sessionPath: typeof jsonBody?.sessionPath === "string" ? jsonBody.sessionPath : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/split/workspace") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("switchPaneWorkspace", {
        request: {
          sessionPath: typeof jsonBody?.sessionPath === "string" ? jsonBody.sessionPath : "",
          workspaceRoot:
            typeof jsonBody?.workspaceRoot === "string" ? jsonBody.workspaceRoot : undefined,
          workspaceBinding:
            jsonBody?.workspaceBinding === "none" || jsonBody?.workspaceBinding === "project"
              ? jsonBody.workspaceBinding
              : "project",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/split/model") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("switchPaneModel", {
        request: {
          sessionPath: typeof jsonBody?.sessionPath === "string" ? jsonBody.sessionPath : "",
          modelRef:
            typeof jsonBody?.modelRef === "object" && jsonBody.modelRef !== null
              ? {
                  groupId:
                    typeof (jsonBody.modelRef as { groupId?: unknown }).groupId === "string"
                      ? (jsonBody.modelRef as { groupId: string }).groupId
                      : "",
                  name:
                    typeof (jsonBody.modelRef as { name?: unknown }).name === "string"
                      ? (jsonBody.modelRef as { name: string }).name
                      : "",
                }
              : { groupId: "", name: "" },
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/split/pending-branch") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("setPanePendingGitBranch", {
        request: {
          sessionPath: typeof jsonBody?.sessionPath === "string" ? jsonBody.sessionPath : "",
          branch: typeof jsonBody?.branch === "string" ? jsonBody.branch : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/split/work-location") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("setPaneWorkLocation", {
        request: {
          sessionPath: typeof jsonBody?.sessionPath === "string" ? jsonBody.sessionPath : "",
          workLocation:
            jsonBody?.workLocation === "worktree" || jsonBody?.workLocation === "local"
              ? jsonBody.workLocation
              : "local",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/split/checkout-branch") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("checkoutPaneGitBranch", {
        request: {
          sessionPath: typeof jsonBody?.sessionPath === "string" ? jsonBody.sessionPath : "",
          branch: typeof jsonBody?.branch === "string" ? jsonBody.branch : "",
          ...(jsonBody?.discardLocalChanges === true ? { discardLocalChanges: true } : {}),
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/delete") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("deleteSession", {
        path: typeof jsonBody?.path === "string" ? jsonBody.path : "",
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/sessions/rename") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("renameSession", {
        path: typeof jsonBody?.path === "string" ? jsonBody.path : "",
        displayName: typeof jsonBody?.displayName === "string" ? jsonBody.displayName : "",
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspace/explorer") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("listWorkspaceExplorerChildren", {
        relativePath: typeof jsonBody?.relativePath === "string" ? jsonBody.relativePath : "",
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspace/file-reference-suggestions") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("listWorkspaceFileReferenceSuggestions", {
        request: {
          input: typeof jsonBody?.input === "string" ? jsonBody.input : "",
          cursorChars: typeof jsonBody?.cursorChars === "number" ? jsonBody.cursorChars : 0,
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspace/code-completion/request") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("requestCodeCompletion", { request: jsonBody }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspace/code-completion/abort") {
    writeJson(request, response, 200, await runHostCommand("abortCodeCompletion"));
    return;
  }

  if (
    request.method === "POST" &&
    pathname === "/api/workspace/code-completion/record-file-state"
  ) {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("recordCodeCompletionFileState", { request: jsonBody }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspace/code-completion/reset-journal") {
    writeJson(request, response, 200, await runHostCommand("resetCodeCompletionJournal"));
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspace/file-reference-index/prime") {
    writeJson(request, response, 200, await runHostCommand("primeWorkspaceFileReferenceIndex"));
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspace/file-reference-index") {
    writeJson(request, response, 200, await runHostCommand("getWorkspaceFileReferenceIndex"));
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspace/file") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("readWorkspaceTextFile", {
        relativePath: typeof jsonBody?.relativePath === "string" ? jsonBody.relativePath : "",
        ...(jsonBody?.optional === true ? { optional: true } : {}),
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspace/search") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("searchWorkspaceContent", {
        request: {
          query: typeof jsonBody?.query === "string" ? jsonBody.query : "",
          caseSensitive: jsonBody?.caseSensitive === true,
          wholeWord: jsonBody?.wholeWord === true,
          isRegexp: jsonBody?.isRegexp === true,
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspace/file/write") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("writeWorkspaceTextFile", {
        request: {
          relativePath: typeof jsonBody?.relativePath === "string" ? jsonBody.relativePath : "",
          text: typeof jsonBody?.text === "string" ? jsonBody.text : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/host/file") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("readHostTextFile", {
        absolutePath: typeof jsonBody?.absolutePath === "string" ? jsonBody.absolutePath : "",
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/host/file/write") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("writeHostTextFile", {
        request: {
          absolutePath: typeof jsonBody?.absolutePath === "string" ? jsonBody.absolutePath : "",
          text: typeof jsonBody?.text === "string" ? jsonBody.text : "",
        },
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/host/file/stat") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("statHostTextFile", {
        absolutePath: typeof jsonBody?.absolutePath === "string" ? jsonBody.absolutePath : "",
      }),
    );
    return;
  }

  if (request.method === "POST" && pathname === "/api/host/file/classify-composer-route") {
    writeJson(
      request,
      response,
      200,
      await runHostCommand("classifyLocalFileComposerRoute", {
        absolutePath: typeof jsonBody?.absolutePath === "string" ? jsonBody.absolutePath : "",
      }),
    );
    return;
  }

  writeJson(request, response, 404, { error: `Unknown route: ${request.method} ${pathname}` });
}

async function serveStaticRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  options: DesktopHttpStaticOptions,
): Promise<void> {
  const root = path.resolve(options.root);
  const decodedPath = decodeURIComponent(pathname);
  const requestedRelativePath =
    decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const requestedPath = path.resolve(root, requestedRelativePath);

  if (!isPathUnderRoot(root, requestedPath)) {
    writeJson(request, response, 403, { error: "Forbidden path." });
    return;
  }

  if (await writeFileIfExists(response, requestedPath)) {
    return;
  }

  if (options.spaFallback !== false) {
    const indexPath = path.join(root, "index.html");
    if (await writeFileIfExists(response, indexPath)) {
      return;
    }
  }

  writeJson(request, response, 404, { error: `Unknown route: ${request.method} ${pathname}` });
}

async function writeFileIfExists(response: ServerResponse, filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return false;
    }
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypeForPath(filePath),
    });
    response.end(body);
    return true;
  } catch {
    return false;
  }
}

function isPathUnderRoot(root: string, filePath: string): boolean {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isAuthorizedRequest(request: IncomingMessage, tokenHash: string | undefined): boolean {
  if (!tokenHash) {
    return false;
  }
  const token = authorizationBearerToken(request);
  if (!token) {
    return false;
  }
  return safeTokenHashEquals(hashDesktopWebAuthToken(token), tokenHash);
}

function authorizationBearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (!header) {
    return undefined;
  }
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(.+)$/iu.exec(value.trim());
  return match?.[1]?.trim() || undefined;
}

function safeTokenHashEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/** Constant-time pairing code comparison; the length is fixed at 6 digits, so length differences leak no useful information. */
function safePairingCodeEquals(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

/**
 * DNS rebinding protection: API requests only allow a Host header matching the configured
 * listen host or a loopback form.
 * When bound to 0.0.0.0 / ::, clients reach the service via any local IP, so the Host header
 * is an IP literal; a rebinding attack's Host must be an attacker domain (not an IP), so
 * allowing IP literals in that case does not weaken the protection.
 */
export function isAllowedRequestHostHeader(
  hostHeader: string | string[] | undefined,
  configuredHost: string,
): boolean {
  const raw = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!raw) {
    return false;
  }

  let hostname: string;
  try {
    hostname = new URL(`http://${raw.trim()}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bareHostname = hostname.replace(/^\[|\]$/gu, "");

  const configured = configuredHost.trim().toLowerCase();
  if (bareHostname === configured || hostname === configured) {
    return true;
  }
  if (bareHostname === "localhost" || bareHostname === "127.0.0.1" || bareHostname === "::1") {
    return true;
  }
  if ((configured === "0.0.0.0" || configured === "::") && isIP(bareHostname) !== 0) {
    return true;
  }
  return false;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return undefined;
  }

  return JSON.parse(text) as unknown;
}

function writeJson(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  writeCors(request, response);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function writeCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }

  const host = request.headers.host;
  if (!host) {
    return false;
  }

  const requestOrigin = `http://${host}`;
  if (origin !== requestOrigin) {
    return false;
  }

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return true;
}

function contentTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeApprovalDecisionPayload(value: unknown): unknown {
  if (!isJsonObject(value)) {
    return undefined;
  }
  switch (value.kind) {
    case "allow":
      return {
        kind: "allow",
        ...(value.remember === "session" || value.remember === "config"
          ? { remember: value.remember }
          : {}),
      };
    case "deny":
      return {
        kind: "deny",
        ...(typeof value.resultText === "string" ? { resultText: value.resultText } : {}),
      };
    case "guidance":
      return {
        kind: "guidance",
        userMessage: typeof value.userMessage === "string" ? value.userMessage : "",
        ...(typeof value.resultText === "string" ? { resultText: value.resultText } : {}),
      };
    default:
      return undefined;
  }
}

function parseSkillRootKind(value: unknown): "user" | "workspaceSpirit" | "workspaceAgents" {
  if (value === "workspaceSpirit" || value === "workspaceAgents") {
    return value;
  }
  return "user";
}

function optionalChipNavigateMetaFromBody(value: unknown) {
  const chipNavigateMeta = parseChipNavigateMeta(value);
  return chipNavigateMeta ? { chipNavigateMeta } : {};
}
