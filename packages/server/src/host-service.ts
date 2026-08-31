import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { JsonValue } from "@spiritagent/agent-core";
import type { AgentMode } from "@spiritagent/agent-core";
import {
  createHostExtensionManager,
  createHostTodoStore,
  deleteHookEntry,
  discoverRuleEntries,
  discoverSkillEntries,
  evaluateReadFilePermission,
  evaluateShellPermission,
  listCachedWorkspaceFileReferenceSuggestions,
  listHookListItems,
  loadPermissionConfig,
  planMetadataSnapshot,
  primeWorkspaceFileReferenceIndexCache,
  resolveInstructionPaths,
  saveHookEntry,
  saveToggleState,
  validateHooksConfig,
  type PermissionEvalResult,
} from "@spiritagent/host-internal";

import { serializeHostExtension } from "./host-serializers.js";
import type { SessionManager } from "./session-manager.js";

/**
 * Workspace/config management RPC surface (`host.*`) — the daemon-side home
 * of what the legacy CLI bridge exposed as `hostInternal.*`. These operate
 * on the shared Spirit data dir + the caller's workspace; no session runtime
 * is involved (todo stores are session-scoped by key).
 */
export class HostService {
  constructor(
    private readonly spiritDataDir: string,
    private readonly sessions: SessionManager,
  ) {}

  private extensionManager(hostKind: "cli" | "desktop") {
    return createHostExtensionManager({ spiritDataDir: this.spiritDataDir, hostKind });
  }

  private static readWorkspaceRoot(params: Record<string, unknown>): string {
    const workspaceRoot = params["workspaceRoot"];
    if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
      throw new Error("missing workspaceRoot");
    }
    return workspaceRoot;
  }

  private static readHostKind(params: Record<string, unknown>): "cli" | "desktop" {
    return params["hostKind"] === "desktop" ? "desktop" : "cli";
  }

  private context(params: Record<string, unknown>) {
    return {
      workspaceRoot: HostService.readWorkspaceRoot(params),
      spiritDataDir: this.spiritDataDir,
    };
  }

  async handle(method: string, rawParams: unknown): Promise<unknown> {
    const params = (rawParams ?? {}) as Record<string, unknown>;
    switch (method) {
      // ------------------------------------------------ instructions (rules/skills/plan)
      case "host.loadCliMetadata": {
        const context = this.context(params);
        const agentMode = (
          typeof params["agentMode"] === "string" ? params["agentMode"] : "agent"
        ) as AgentMode;
        const activePlanPath =
          typeof params["activePlanPath"] === "string" ? params["activePlanPath"] : undefined;
        return {
          ruleEntries: await discoverRuleEntries(context),
          skillEntries: await discoverSkillEntries(context),
          planMetadata: planMetadataSnapshot(
            context,
            agentMode,
            activePlanPath ? { activePlanPath } : undefined,
          ),
          hooksSummary: validateHooksConfig({
            spiritDataDir: context.spiritDataDir,
            workspaceRoot: context.workspaceRoot,
          }).summary,
        };
      }
      case "host.loadPlanMetadata": {
        const context = this.context(params);
        const agentMode = (
          typeof params["agentMode"] === "string" ? params["agentMode"] : "agent"
        ) as AgentMode;
        const activePlanPath =
          typeof params["activePlanPath"] === "string" ? params["activePlanPath"] : undefined;
        return planMetadataSnapshot(
          context,
          agentMode,
          activePlanPath ? { activePlanPath } : undefined,
        );
      }
      case "host.writeRuleState":
      case "host.writeSkillState": {
        const context = this.context(params);
        const paths = resolveInstructionPaths(context);
        const filePath =
          method === "host.writeRuleState" ? paths.rulesStateFile : paths.skillsStateFile;
        const enabledOverrides = (params["enabledOverrides"] ?? {}) as Record<string, boolean>;
        await saveToggleState(filePath, { enabledOverrides });
        return filePath;
      }

      // ------------------------------------------------ workspace file references
      case "host.listWorkspaceFileReferenceSuggestions": {
        const workspaceRoot = HostService.readWorkspaceRoot(params);
        const input = typeof params["input"] === "string" ? params["input"] : "";
        const cursorChars = typeof params["cursorChars"] === "number" ? params["cursorChars"] : 0;
        return (
          (await listCachedWorkspaceFileReferenceSuggestions(workspaceRoot, input, cursorChars)) ??
          null
        );
      }
      case "host.primeWorkspaceFileReferenceIndex": {
        await primeWorkspaceFileReferenceIndexCache(HostService.readWorkspaceRoot(params));
        return null;
      }

      // ------------------------------------------------------------- hooks
      case "host.validateHooks": {
        const context = this.context(params);
        return validateHooksConfig(context);
      }
      case "host.listHookEntries": {
        const context = this.context(params);
        const workspaceBinding = params["workspaceBinding"] === "none" ? "none" : "project";
        return listHookListItems({ ...context, workspaceBinding });
      }
      case "host.saveHookEntry": {
        const context = this.context(params);
        const workspaceBinding = params["workspaceBinding"] === "none" ? "none" : "project";
        const request = params["request"] as Parameters<typeof saveHookEntry>[1];
        if (!request) {
          throw new Error("missing request");
        }
        await saveHookEntry({ ...context, workspaceBinding }, request);
        return { ok: true };
      }
      case "host.deleteHookEntry": {
        const context = this.context(params);
        const workspaceBinding = params["workspaceBinding"] === "none" ? "none" : "project";
        const request = params["request"] as Parameters<typeof deleteHookEntry>[1];
        if (!request) {
          throw new Error("missing request");
        }
        await deleteHookEntry({ ...context, workspaceBinding }, request);
        return { ok: true };
      }

      // --------------------------------------------------------- permissions
      case "host.checkPermission": {
        const domain = params["domain"];
        if (domain !== "shell" && domain !== "read_file") {
          throw new Error('invalid domain (expected "shell" | "read_file")');
        }
        const value = typeof params["value"] === "string" ? params["value"].trim() : "";
        if (!value) {
          throw new Error("missing value");
        }
        const workspaceRoot =
          typeof params["workspaceRoot"] === "string" && params["workspaceRoot"].trim()
            ? params["workspaceRoot"]
            : undefined;
        const { config, warnings } = loadPermissionConfig(this.spiritDataDir);
        if (domain === "shell") {
          const result: HostCheckPermissionResult = {
            ...evaluateShellPermission(value, config.shell ?? {}),
            warnings,
          };
          return result;
        }
        const filePath = normalizeReadFileCheckPath(value, workspaceRoot);
        const result: HostCheckPermissionResult = {
          ...evaluateReadFilePermission(filePath, config.read_file ?? {}, {
            workspaceRoot: workspaceRoot ?? process.cwd(),
          }),
          warnings,
        };
        return result;
      }

      // --------------------------------------------------------- extensions
      case "host.listExtensions": {
        const items = await this.extensionManager(HostService.readHostKind(params)).list();
        return items.map((item) => serializeHostExtension(item));
      }
      case "host.importExtension": {
        const archiveBase64 =
          typeof params["archiveBase64"] === "string" ? params["archiveBase64"].trim() : "";
        if (!archiveBase64) {
          throw new Error("extension archive is empty");
        }
        const manager = this.extensionManager(HostService.readHostKind(params));
        const item = await manager.importArchive({
          archiveBase64,
          ...(typeof params["fileName"] === "string" && params["fileName"].trim()
            ? { fileName: params["fileName"].trim() }
            : {}),
        });
        await this.sessions.refreshExtensions();
        return serializeHostExtension(item);
      }
      case "host.deleteExtension": {
        const id = typeof params["id"] === "string" ? params["id"].trim() : "";
        if (!id) {
          throw new Error("missing extension id");
        }
        await this.extensionManager(HostService.readHostKind(params)).remove(id);
        await this.sessions.refreshExtensions();
        return { id };
      }
      case "host.setExtensionEnabled": {
        const id = typeof params["id"] === "string" ? params["id"].trim() : "";
        if (!id) {
          throw new Error("missing extension id");
        }
        if (typeof params["enabled"] !== "boolean") {
          throw new Error("missing enabled");
        }
        const enabled = params["enabled"];
        await this.extensionManager(HostService.readHostKind(params)).setEnabled(id, enabled);
        await this.sessions.refreshExtensions();
        return { id, enabled };
      }
      // -------------------------------------------------------------- todos
      case "host.listSessionTodos": {
        const sessionId = HostService.readSessionId(params);
        const store = createHostTodoStore({
          spiritDataDir: this.spiritDataDir,
          scope: { sessionKey: sessionId },
        });
        return { todos: await store.list({ includeCompleted: true }) };
      }
      case "host.replaceSessionTodos": {
        const sessionId = HostService.readSessionId(params);
        const store = createHostTodoStore({
          spiritDataDir: this.spiritDataDir,
          scope: { sessionKey: sessionId },
        });
        const records = Array.isArray(params["records"]) ? params["records"] : [];
        return { todos: await store.replaceAll(records as never[]) };
      }

      // ---------------------------------------------------------------- MCP
      case "host.mcp": {
        const workspaceRoot = HostService.readWorkspaceRoot(params);
        const service = this.sessions.mcpRegistry.forWorkspace(workspaceRoot);
        const action = String(params["action"] ?? "");
        const inner = (params["params"] ?? {}) as Record<string, unknown>;
        switch (action) {
          case "listMcpServers":
            return service.listServers();
          case "inspectMcpServer":
            return service.inspectServer(String(inner["name"] ?? ""));
          case "listMcpTools":
            return service.listTools(String(inner["name"] ?? ""));
          case "listMcpResources":
            return service.listResources(String(inner["name"] ?? ""));
          case "listMcpPrompts":
            return service.listPrompts(String(inner["name"] ?? ""));
          case "listCachedMcpPrompts":
            return service.listCachedPrompts(String(inner["name"] ?? ""));
          case "getMcpPrompt":
            return service.getPrompt(
              String(inner["server"] ?? ""),
              String(inner["prompt"] ?? ""),
              typeof inner["argsJson"] === "string" ? inner["argsJson"] : undefined,
            );
          case "callMcpTool":
            return service.callTool(
              String(inner["server"] ?? ""),
              String(inner["tool"] ?? ""),
              typeof inner["argsJson"] === "string" ? inner["argsJson"] : undefined,
            );
          case "readMcpResource":
            return service.readResource(String(inner["server"] ?? ""), String(inner["uri"] ?? ""));
          case "mcpStatusSnapshot":
            return service.statusSnapshot();
          case "startMcpBackgroundRefresh":
            service.startBackgroundRefreshInBackground(true);
            return service.statusSnapshot();
          default:
            throw new Error(`unknown mcp action: ${action}`);
        }
      }

      default:
        throw new Error(`unknown host method: ${method}`);
    }
  }

  private static readSessionId(params: Record<string, unknown>): string {
    const sessionId = params["sessionId"];
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      throw new Error("missing sessionId");
    }
    return sessionId;
  }
}

export type HostCheckPermissionResult = PermissionEvalResult & { warnings: string[] };

/**
 * Best-effort path normalization for the offline read_file checker (NOT the
 * enforcement path): expands a leading `~`, resolves relative input against
 * the workspace root (or cwd), and canonicalizes via realpath when the path
 * exists. Non-existent paths keep the resolved form.
 */
function normalizeReadFileCheckPath(value: string, workspaceRoot: string | undefined): string {
  let normalized = value;
  if (normalized === "~" || normalized.startsWith("~/") || normalized.startsWith("~\\")) {
    normalized = homedir() + normalized.slice(1);
  }
  if (!path.isAbsolute(normalized)) {
    normalized = path.resolve(workspaceRoot ?? process.cwd(), normalized);
  }
  try {
    return realpathSync.native(normalized);
  } catch {
    return normalized;
  }
}

export const HOST_METHODS = new Set([
  "host.loadCliMetadata",
  "host.loadPlanMetadata",
  "host.writeRuleState",
  "host.writeSkillState",
  "host.listWorkspaceFileReferenceSuggestions",
  "host.primeWorkspaceFileReferenceIndex",
  "host.validateHooks",
  "host.listHookEntries",
  "host.saveHookEntry",
  "host.deleteHookEntry",
  "host.checkPermission",
  "host.listExtensions",
  "host.importExtension",
  "host.deleteExtension",
  "host.setExtensionEnabled",
  "host.listSessionTodos",
  "host.replaceSessionTodos",
  "host.mcp",
]);

export type { JsonValue };
