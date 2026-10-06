import type { JsonValue, ToolApprovalPrompt, ToolApprovalRequest } from "@spiritagent/agent-core";
import { formatTitleFromId } from "@spiritagent/host-internal/id-display-title";
import { WELL_KNOWN_CASING_OVERRIDES } from "@spiritagent/host-internal/well-known-casing";

import { formatDesktopAutomationTimeOfDay } from "./automation-schedule.js";
import type { DesktopAutomationTrigger } from "./automation-trigger.js";
import { isValidDesktopAutomationTrigger } from "./automation-trigger.js";

export type ApprovalPromptTranslate = (key: string, options?: Record<string, unknown>) => string;

export type ApprovalPromptView = {
  title: string;
  body: string;
};

/**
 * Host-side display strings for a pending tool approval. Pure string building with the translator
 * injected, so the host process (i18n-host) and the renderer can both use it.
 */
export function buildApprovalPromptView(
  prompt: ToolApprovalPrompt,
  toolName: string,
  t: ApprovalPromptTranslate,
): ApprovalPromptView {
  if (prompt.kind === "hook") {
    return {
      // A hook ask that carries the host's structured request renders with the same localized
      // title as a direct tool approval; the hook message stays the body.
      title: prompt.request ? approvalViewTitle(prompt.request, toolName, t) : toolName,
      body: prompt.message ?? t("approval.hookFallback", { tool: toolName }),
    };
  }
  const request = prompt.request;
  return {
    title: approvalViewTitle(request, toolName, t),
    body: approvalViewBody(request, t),
  };
}

function approvalViewTitle(
  request: ToolApprovalRequest,
  toolName: string,
  t: ApprovalPromptTranslate,
): string {
  if (request.kind === "shell") {
    const reason = request.reason?.trim();
    if (reason) {
      return reason;
    }
    return toolName;
  }
  switch (request.kind) {
    case "web_fetch":
      return t("approval.title.fetchWebPage", { url: request.url });
    case "read_path":
      if (request.operation === "ls") {
        return t("approval.title.listDirectory", { path: request.path });
      }
      // Ask rules and hook gates can also target workspace files; the "outside the workspace"
      // title only fits truly external reads.
      return request.workspaceExternal === false
        ? t("approval.title.readFile")
        : t("approval.title.readFileOutsideWorkspace");
    case "create_file":
      return t("approval.title.createFile");
    case "create_plan":
      return t("approval.title.createPlan");
    case "edit_file":
      return t("approval.title.editFile");
    case "delete_file":
      return t("approval.title.deleteFile");
    case "apply_patch":
      // Titled by the operation, matching the single-purpose file tool forms; the generic
      // "Apply Patch" key remains the fallback for unknown operations.
      if (request.operation === "create_file") {
        return t("approval.title.createFile");
      }
      if (request.operation === "update_file") {
        return t("approval.title.editFile");
      }
      if (request.operation === "delete_file") {
        return t("approval.title.deleteFile");
      }
      return t("approval.title.applyPatch");
    case "create_automation":
      return automationStructuredTitle(request, t);
    case "lazy_tool_call":
      // MCP titles read "{Server} {Tool}" in UI casing (well-known overrides keep `ai` → `AI`);
      // the built-in and unknown-provider forms keep their localized generic titles.
      if (request.provider === "mcp") {
        return `${formatTitleFromId(request.server, { casingOverrides: WELL_KNOWN_CASING_OVERRIDES })} ${formatTitleFromId(request.tool, { casingOverrides: WELL_KNOWN_CASING_OVERRIDES })}`;
      }
      return request.provider === "built-in"
        ? t("approval.title.lazyBuiltInToolCall")
        : t("approval.title.lazyToolCall");
    default:
      return toolName;
  }
}

function approvalViewBody(request: ToolApprovalRequest, t: ApprovalPromptTranslate): string {
  switch (request.kind) {
    // Shell cards render the command as a Shiki block; the body stays the raw command for the
    // timeline detail lines and notifications (the shell card filters the duplicated line).
    case "shell":
      return request.command;
    case "web_fetch":
      // The URL lives in the title; the body stays empty (the card skips an empty body).
      return "";
    case "read_path":
      return t("approval.field.path", { path: request.path });
    case "create_file":
      return [
        t("approval.field.path", { path: request.path }),
        t("approval.field.contentLength", { chars: request.contentChars }),
      ].join("\n");
    case "create_plan":
      return [
        t("approval.field.name", { name: request.planName }),
        t("approval.field.contentLength", { chars: request.contentChars }),
      ].join("\n");
    case "edit_file":
      return [
        t("approval.field.path", { path: request.path }),
        t("approval.field.oldTextLength", { chars: request.oldChars }),
        t("approval.field.newTextLength", { chars: request.newChars }),
      ].join("\n");
    case "delete_file":
      return t("approval.field.path", { path: request.path });
    case "apply_patch":
      return [
        t("approval.field.path", { path: request.path }),
        ...(request.diffLines !== undefined
          ? [t("approval.field.diffLines", { lines: request.diffLines })]
          : []),
      ].join("\n");
    case "create_automation":
      // The overview is the card's body; the schedule lives in the structured title and the run
      // approval level in its own note line, so the body carries the overview verbatim.
      return request.overview;
    case "extension_tool":
      return [
        t("approval.extensionToolConfirmation"),
        t("approval.field.extension", { id: request.extensionId }),
        t("approval.field.tool", { tool: request.toolName }),
        "",
        t("approval.field.extensionArguments", { arguments: request.argumentsPreview }),
      ].join("\n");
    case "lazy_tool_call": {
      // MCP cards render the arguments as a Shiki JSON block; the body is that same pretty JSON
      // for the timeline detail lines and notifications (empty when there are no arguments).
      if (request.provider === "mcp") {
        return request.arguments === undefined ? "" : JSON.stringify(request.arguments, null, 2);
      }
      const argsText =
        request.arguments === undefined
          ? t("approval.field.noArguments")
          : JSON.stringify(request.arguments, null, 2);
      return [
        // Unknown providers keep their provider line since the title cannot carry it.
        ...(request.provider !== "built-in" && request.provider !== "mcp"
          ? [t("approval.field.provider", { provider: request.provider })]
          : []),
        t("approval.field.server", { server: request.server }),
        t("approval.field.tool", { tool: request.tool }),
        t("approval.field.arguments", { arguments: argsText }),
      ].join("\n");
    }
  }
}

function desktopTriggerFromJson(value: JsonValue): DesktopAutomationTrigger | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as DesktopAutomationTrigger;
  return isValidDesktopAutomationTrigger(candidate) ? candidate : undefined;
}

/** "Create {title} to run {schedule}" titles, composed from the trigger's structured fields. */
function automationStructuredTitle(
  request: Extract<ToolApprovalRequest, { kind: "create_automation" }>,
  t: ApprovalPromptTranslate,
): string {
  const trigger = desktopTriggerFromJson(request.trigger);
  if (!trigger) {
    return t("approval.title.createAutomation");
  }
  const title = request.title;
  if (trigger.kind === "time") {
    const schedule = trigger.schedule;
    if (schedule.kind === "hourly") {
      return t("approval.title.createAutomationHourly", { title });
    }
    const time = formatDesktopAutomationTimeOfDay(schedule.hour, schedule.minute);
    if (schedule.kind === "daily") {
      return t("approval.title.createAutomationDaily", { title, time });
    }
    const weekday = t(`automations.schedule.weekday${schedule.weekday}`);
    return t("approval.title.createAutomationWeekly", { title, weekday, time });
  }
  const repo = `${trigger.owner}/${trigger.repo}`;
  return trigger.event === "pull_request_created"
    ? t("approval.title.createAutomationGithubPullRequest", { title, repo })
    : t("approval.title.createAutomationGithubIssue", { title, repo });
}
