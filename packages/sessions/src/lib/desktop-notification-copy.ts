const NOTIFICATION_BODY_MAX = 240;
const APPROVAL_BODY_MAX = 200;

export function formatSessionPrefixedTitle(sessionName: string, body: string): string {
  const trimmedSession = sessionName.trim() || "Session";
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    return `[${trimmedSession}]`;
  }
  return `[${trimmedSession}] ${trimmedBody}`;
}

export function truncateNotificationBody(text: string, max = NOTIFICATION_BODY_MAX): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Approval notification body from the mapped snapshot fields. A bare "shell" title means the
 * request carried no reason, so the body is the prompt alone; everything else is title + prompt.
 */
export function approvalNotificationBody(toolName: string, prompt: string): string {
  const label = toolName.trim();
  const detail = prompt.trim();
  if (label && label !== "shell" && detail) {
    return truncateNotificationBody(`${label}\n${detail}`, APPROVAL_BODY_MAX);
  }
  return truncateNotificationBody(detail || label, APPROVAL_BODY_MAX);
}
