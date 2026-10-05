import type { JsonValue, ToolApprovalPrompt, ToolApprovalRequest } from "@spiritagent/agent-core";

import type { DesktopAutomationTrigger } from "./automation-trigger.js";
import {
  formatDesktopAutomationTriggerLabel,
  isValidDesktopAutomationTrigger,
} from "./automation-trigger.js";
import {
  buildAutomationTriggerFormatLabels,
  type AutomationTriggerTranslate,
} from "./automation-trigger-i18n.js";

export type ApprovalPromptTranslate = AutomationTriggerTranslate;

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
      title: toolName,
      body: prompt.message ?? t("approval.hookFallback", { tool: toolName }),
    };
  }
  const request = prompt.request;
  return {
    title: approvalViewTitle(request, toolName),
    body: approvalViewBody(request, t),
  };
}

function approvalViewTitle(request: ToolApprovalRequest, toolName: string): string {
  if (request.kind === "shell") {
    const reason = request.reason?.trim();
    if (reason) {
      return reason;
    }
  }
  return toolName;
}

function approvalViewBody(request: ToolApprovalRequest, t: ApprovalPromptTranslate): string {
  switch (request.kind) {
    case "shell":
      return [
        t("approval.highRisk.shell"),
        t("approval.field.terminal", { name: request.terminal }),
        t("approval.field.command", { command: request.command }),
      ].join("\n");
    case "web_fetch":
      return [
        t("approval.highRisk.fetchWebPage"),
        t("approval.field.url", { url: request.url }),
        "",
        t("approval.webFetchWarning"),
      ].join("\n");
    case "read_path":
      return [
        request.operation === "ls"
          ? t("approval.highRisk.listDirectoryOutsideWorkspace")
          : t("approval.highRisk.readFileOutsideWorkspace"),
        t("approval.field.path", { path: request.path }),
      ].join("\n");
    case "create_file":
      return [
        t("approval.highRisk.createFile"),
        t("approval.field.path", { path: request.path }),
        t("approval.field.contentLength", { chars: request.contentChars }),
      ].join("\n");
    case "create_plan":
      return [
        t("approval.highRisk.createPlan"),
        t("approval.field.name", { name: request.planName }),
        t("approval.field.contentLength", { chars: request.contentChars }),
      ].join("\n");
    case "edit_file":
      return [
        t("approval.highRisk.editFileExactReplacement"),
        t("approval.field.path", { path: request.path }),
        t("approval.field.oldTextLength", { chars: request.oldChars }),
        t("approval.field.newTextLength", { chars: request.newChars }),
      ].join("\n");
    case "delete_file":
      return [
        t("approval.highRisk.deleteFile"),
        t("approval.field.path", { path: request.path }),
      ].join("\n");
    case "apply_patch":
      return [
        t("approval.highRisk.applyPatch", { operation: request.operation }),
        t("approval.field.path", { path: request.path }),
        ...(request.diffLines !== undefined
          ? [t("approval.field.diffLines", { lines: request.diffLines })]
          : []),
      ].join("\n");
    case "create_automation":
      return [
        t("approval.highRisk.createAutomation"),
        t("approval.field.title", { title: request.title }),
        t("approval.field.schedule", { schedule: automationScheduleLabel(request.trigger, t) }),
        t("approval.field.runApproval", { level: automationApprovalLevelLabel(request, t) }),
        t("approval.field.overviewLength", { characters: request.overviewChars }),
      ].join("\n");
    case "extension_tool":
      return [
        t("approval.highRisk.extensionTool"),
        t("approval.field.extension", { id: request.extensionId }),
        t("approval.field.tool", { tool: request.toolName }),
        "",
        t("approval.field.extensionArguments", { arguments: request.argumentsPreview }),
      ].join("\n");
    case "lazy_tool_call": {
      const argsText =
        request.arguments === undefined
          ? t("approval.field.noArguments")
          : JSON.stringify(request.arguments, null, 2);
      const headline =
        request.provider === "built-in"
          ? t("approval.highRisk.lazyBuiltInToolCall")
          : request.provider === "mcp"
            ? t("approval.highRisk.lazyMcpToolCall")
            : [
                t("approval.highRisk.lazyToolCall"),
                t("approval.field.provider", { provider: request.provider }),
              ].join("\n");
      return [
        headline,
        t("approval.field.server", { server: request.server }),
        t("approval.field.tool", { tool: request.tool }),
        t("approval.field.arguments", { arguments: argsText }),
      ].join("\n");
    }
  }
}

function automationScheduleLabel(trigger: JsonValue, t: ApprovalPromptTranslate): string {
  const parsed = desktopTriggerFromJson(trigger);
  if (!parsed) {
    return JSON.stringify(trigger);
  }
  return formatDesktopAutomationTriggerLabel(parsed, buildAutomationTriggerFormatLabels(t));
}

function desktopTriggerFromJson(value: JsonValue): DesktopAutomationTrigger | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as DesktopAutomationTrigger;
  return isValidDesktopAutomationTrigger(candidate) ? candidate : undefined;
}

function automationApprovalLevelLabel(
  request: Extract<ToolApprovalRequest, { kind: "create_automation" }>,
  t: ApprovalPromptTranslate,
): string {
  if (request.approvalLevel === "auto-approval") {
    return t("composer.approvalAuto");
  }
  if (request.approvalLevel === "bypass-approval") {
    return t("composer.approvalBypass");
  }
  return t("composer.approvalDefault");
}
