import {
  buildActiveSkillsBlockContent,
  buildMcpAppContextBlockContent,
  type ToolAgentActiveSkill,
  type ToolAgentMcpAppContext,
} from "../tool-agent.js";

/** Prefix user turn content with a local-time anchor for the LLM (plain text, no separate metadata field). */
const USER_MESSAGE_AT_OPEN = "<user_message_at>";
const USER_MESSAGE_AT_CLOSE = "</user_message_at>";
const ACTIVE_SKILL_OPEN = "<active_skill>";
const ACTIVE_SKILL_CLOSE = "</active_skill>";
const MCP_APP_CONTEXT_OPEN = "<mcp_app_context>";
const MCP_APP_CONTEXT_CLOSE = "</mcp_app_context>";

export function formatActiveSkillUserMessageMeta(
  activeSkills: ToolAgentActiveSkill[],
): string | undefined {
  const block = buildActiveSkillsBlockContent(activeSkills);
  if (!block) {
    return undefined;
  }

  return `${ACTIVE_SKILL_OPEN}\n${block}\n${ACTIVE_SKILL_CLOSE}`;
}

export function formatMcpAppContextUserMessageMeta(
  mcpAppContexts: readonly ToolAgentMcpAppContext[],
): string | undefined {
  const block = buildMcpAppContextBlockContent(mcpAppContexts);
  if (!block) {
    return undefined;
  }

  return `${MCP_APP_CONTEXT_OPEN}\n${block}\n${MCP_APP_CONTEXT_CLOSE}`;
}

export function formatUserMessageContentForLlm(
  body: string,
  activeSkills: ToolAgentActiveSkill[] = [],
  mcpAppContexts: readonly ToolAgentMcpAppContext[] = [],
): string {
  const lines: string[] = [];
  const activeSkillMeta = formatActiveSkillUserMessageMeta(activeSkills);
  if (activeSkillMeta) {
    lines.push(activeSkillMeta);
  }
  const mcpAppContextMeta = formatMcpAppContextUserMessageMeta(mcpAppContexts);
  if (mcpAppContextMeta) {
    lines.push(mcpAppContextMeta);
  }
  lines.push(
    `${USER_MESSAGE_AT_OPEN}${formatLocalIsoWithOffset(new Date())}${USER_MESSAGE_AT_CLOSE}`,
  );
  lines.push(body);
  return lines.join("\n");
}

export function userMessageContentMatchesInput(content: string, input: string): boolean {
  if (content === input) {
    return true;
  }

  const body = bodyAfterUserMessageMeta(content);
  return body !== undefined && body === input;
}

function stripLeadingMetaBlock(
  content: string,
  openTag: string,
  closeTag: string,
): string | undefined {
  if (!content.startsWith(openTag)) {
    return content;
  }
  const closeIndex = content.indexOf(closeTag);
  if (closeIndex < 0) {
    return undefined;
  }
  const after = content.slice(closeIndex + closeTag.length);
  return after.startsWith("\n") ? after.slice(1) : after;
}

function bodyAfterUserMessageMeta(content: string): string | undefined {
  const afterSkill = stripLeadingMetaBlock(content, ACTIVE_SKILL_OPEN, ACTIVE_SKILL_CLOSE);
  if (afterSkill === undefined) {
    return undefined;
  }
  const remaining = stripLeadingMetaBlock(afterSkill, MCP_APP_CONTEXT_OPEN, MCP_APP_CONTEXT_CLOSE);
  if (remaining === undefined) {
    return undefined;
  }

  const firstLineEnd = remaining.indexOf("\n");
  if (firstLineEnd < 0) {
    return undefined;
  }

  const firstLine = remaining.slice(0, firstLineEnd);
  if (
    firstLine.startsWith(USER_MESSAGE_AT_OPEN) &&
    firstLine.endsWith(USER_MESSAGE_AT_CLOSE) &&
    firstLine.length > USER_MESSAGE_AT_OPEN.length + USER_MESSAGE_AT_CLOSE.length
  ) {
    return remaining.slice(firstLineEnd + 1);
  }

  return undefined;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/** e.g. 2026-04-21T15:30:45.123+08:00 (local calendar + UTC offset). */
function formatLocalIsoWithOffset(d: Date): string {
  const y = d.getFullYear();
  const mo = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const h = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  const s = pad2(d.getSeconds());
  const ms = pad3(d.getMilliseconds());
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  const oh = pad2(Math.floor(abs / 60));
  const om = pad2(abs % 60);
  return `${y}-${mo}-${day}T${h}:${mi}:${s}.${ms}${sign}${oh}:${om}`;
}
