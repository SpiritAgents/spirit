import type {
  JsonValue,
  RuntimeApprovalDecision,
  RuntimePendingApproval,
} from "@spiritagent/agent-core";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import { mapToolNameToKind } from "./tool-call-mapper.js";
import { buildApprovalPromptText } from "./approval-text.js";

/**
 * Handles a runtime approval request by asking the ACP client for permission.
 *
 * Converts agent-core's RuntimePendingApproval into an ACP requestPermission call,
 * then maps the client's response back to a RuntimeApprovalDecision.
 */
export async function handleApprovalRequest(
  connection: AgentSideConnection,
  sessionId: string,
  approval: RuntimePendingApproval<JsonValue>,
): Promise<RuntimeApprovalDecision> {
  try {
    const toolCallId = approval.toolCallId ?? `approval_${Date.now()}`;
    const kind = mapToolNameToKind(approval.toolName);

    // Build the descriptive text from the structured approval prompt
    const { title, body } = buildApprovalPromptText(approval.prompt, approval.toolName);

    const response = await connection.requestPermission({
      sessionId,
      toolCall: {
        toolCallId,
        title,
        kind: kind as schema.ToolKind,
        status: "pending",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: body || `Tool ${approval.toolName} requires permission.`,
            },
          },
        ],
      },
      options: buildPermissionOptions(approval),
    });

    return mapPermissionResponse(response);
  } catch {
    // If permission request fails (e.g. connection closed), deny the operation
    return { kind: "deny", resultText: "Permission request failed." };
  }
}

/**
 * Handles a questions-requested event by degrading to a simple allow/deny prompt.
 *
 * The full questions UI is not supported; the questions are presented as text
 * with an allow/deny prompt.
 */
export async function handleQuestionsRequest(
  connection: AgentSideConnection,
  sessionId: string,
  questions: { prompt?: string; questions?: unknown[] },
): Promise<boolean> {
  try {
    const description = questions.prompt ?? "The agent needs additional input.";
    const response = await connection.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: `questions_${Date.now()}`,
        title: "Agent needs input",
        kind: "other",
        status: "pending",
        content: [
          {
            type: "content",
            content: { type: "text", text: description },
          },
        ],
      },
      options: [
        { optionId: "allow", name: "Continue", kind: "allow_once" },
        { optionId: "reject", name: "Cancel", kind: "reject_once" },
      ],
    });

    return response.outcome.outcome !== "cancelled" && response.outcome.optionId === "allow";
  } catch {
    return false;
  }
}

/**
 * Builds permission options based on whether the tool has a remember target.
 */
function buildPermissionOptions(
  approval: RuntimePendingApproval<JsonValue>,
): schema.PermissionOption[] {
  const options: schema.PermissionOption[] = [
    {
      optionId: "allow",
      name: "Allow",
      kind: "allow_once",
    },
  ];

  // If there's a remember target, offer "always allow"
  if (approval.rememberTarget !== undefined) {
    options.push({
      optionId: "allow-always",
      name: "Always Allow",
      kind: "allow_always",
    });
  }

  options.push({
    optionId: "reject",
    name: "Reject",
    kind: "reject_once",
  });

  return options;
}

/**
 * Maps an ACP permission response to a RuntimeApprovalDecision.
 */
function mapPermissionResponse(
  response: schema.RequestPermissionResponse,
): RuntimeApprovalDecision {
  const outcome = response.outcome;

  if (outcome.outcome === "cancelled") {
    return { kind: "deny", resultText: "Operation cancelled." };
  }

  switch (outcome.optionId) {
    case "allow":
      return { kind: "allow" };
    case "allow-always":
      // Session-scoped on purpose: ACP has no third allow-kind option, so
      // the persistent "Always Allow" choice is intentionally not exposed
      // over ACP; allow-always only remembers for this session.
      return { kind: "allow", remember: "session" };
    case "reject":
      return { kind: "deny", resultText: "User rejected this operation." };
    default:
      return { kind: "deny", resultText: `Unknown permission option: ${outcome.optionId}` };
  }
}
