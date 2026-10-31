import type { JsonValue, ToolApprovalPrompt, ToolApprovalRequest } from "@spiritagent/agent-core";

/**
 * ACP-side display text for a pending approval. ACP has no localization layer, so the
 * permission bridge builds the English text itself from the structured prompt.
 */
export function buildApprovalPromptText(
  prompt: ToolApprovalPrompt,
  toolName: string,
): { title: string; body: string } {
  if (prompt.kind === "hook") {
    const message = prompt.message?.trim();
    const body = message || `Hook requested approval for ${toolName}.`;
    return { title: body, body };
  }
  const body = approvalRequestText(prompt.request);
  return { title: body, body };
}

function approvalRequestText(request: ToolApprovalRequest): string {
  switch (request.kind) {
    case "shell":
      return [
        ...(request.reason?.trim() ? [`Reason: ${request.reason.trim()}`] : []),
        "High-risk tool call: shell",
        `Terminal: ${request.terminal}`,
        `Command: ${request.command}`,
      ].join("\n");
    case "web_fetch":
      return (
        `High-risk tool call: fetch web page\nURL: ${request.url}\n\n` +
        "The body will enter the conversation; confirm the source is trustworthy — malicious pages may attempt prompt injection."
      );
    case "read_path":
      return `High-risk tool call: ${
        request.operation === "ls"
          ? "List directory outside the workspace"
          : "Read file outside the workspace"
      }\nPath: ${request.path}`;
    case "create_file":
      return `High-risk tool call: create file\nPath: ${request.path}\nContent length: ${request.contentChars} chars`;
    case "create_plan":
      return `High-risk tool call: create plan\nName: ${request.planName}\nContent length: ${request.contentChars} chars`;
    case "edit_file":
      return `High-risk tool call: edit file (exact replacement)\nPath: ${request.path}\nOld text length: ${request.oldChars} chars\nNew text length: ${request.newChars} chars`;
    case "delete_file":
      return `High-risk tool call: delete file\nPath: ${request.path}`;
    case "apply_patch":
      return (
        `High-risk tool call: apply_patch (${request.operation})\n` +
        `Path: ${request.path}` +
        (request.diffLines !== undefined ? `\nDiff lines: ${request.diffLines}` : "")
      );
    case "create_automation":
      return (
        `High-risk tool call: Create automation\n` +
        `Title: ${request.title}\n` +
        `Schedule: ${automationTriggerLabel(request.trigger)}\n` +
        `Run approval: ${automationApprovalLevelLabel(request.approvalLevel)}\n` +
        `Overview length: ${request.overviewChars} characters`
      );
    case "extension_tool":
      return (
        `Extension tool requires confirmation\n` +
        `Extension: ${request.extensionId}\n` +
        `Tool: ${request.toolName}\n\n` +
        `Arguments\n${request.argumentsPreview}`
      );
    case "lazy_tool_call": {
      const argsText =
        request.arguments === undefined ? "(none)" : JSON.stringify(request.arguments, null, 2);
      const headline =
        request.provider === "built-in"
          ? "High-risk tool call: built-in tool_call"
          : request.provider === "mcp"
            ? "High-risk tool call: MCP tool_call"
            : `High-risk tool call: tool_call\nprovider: ${request.provider}`;
      return `${headline}\nServer: ${request.server}\nTool: ${request.tool}\nArguments:\n${argsText}`;
    }
  }
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function automationApprovalLevelLabel(approvalLevel: string): string {
  if (approvalLevel === "auto-approval") {
    return "Auto-approval";
  }
  if (approvalLevel === "bypass-approval") {
    return "Bypass approval";
  }
  return "Default approval";
}

function automationTriggerLabel(trigger: JsonValue): string {
  if (typeof trigger !== "object" || trigger === null || Array.isArray(trigger)) {
    return JSON.stringify(trigger);
  }
  const record = trigger as Record<string, unknown>;
  if (record.kind === "time") {
    const schedule = (
      typeof record.schedule === "object" && record.schedule !== null ? record.schedule : {}
    ) as Record<string, unknown>;
    if (schedule.kind === "hourly") {
      return "Hourly";
    }
    const hour = typeof schedule.hour === "number" ? schedule.hour : 0;
    const minute = typeof schedule.minute === "number" ? schedule.minute : 0;
    const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    if (schedule.kind === "daily") {
      return `Daily ${time}`;
    }
    if (schedule.kind === "weekly") {
      const weekday =
        WEEKDAY_LABELS[typeof schedule.weekday === "number" ? schedule.weekday : 0] ??
        String(schedule.weekday);
      return `Weekly ${weekday} ${time}`;
    }
  }
  if (record.kind === "github") {
    const eventLabel = record.event === "pull_request_created" ? "PR created" : "Issue created";
    return `GitHub · ${String(record.owner ?? "")}/${String(record.repo ?? "")} · ${eventLabel}`;
  }
  return JSON.stringify(trigger);
}
