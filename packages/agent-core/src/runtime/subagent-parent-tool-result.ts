export function buildParentSubagentToolResultText(
  outputText: string,
  failed: boolean,
  sessionId?: string,
  sessionTranscript?: string,
): string {
  const normalizedOutput = outputText.trim();
  const header = failed ? "[subagent failed]" : "[subagent completed]";
  const lines = [header];
  const normalizedSessionId = sessionId?.trim();
  if (normalizedSessionId) {
    lines.push(`sessionId=${normalizedSessionId}`);
  }
  const normalizedTranscript = sessionTranscript?.trim();
  if (normalizedTranscript) {
    lines.push(`sessionTranscript=${normalizedTranscript}`);
  }
  if (!normalizedOutput) {
    return lines.join("\n");
  }

  const label = failed ? "error:" : "final_output:";
  return `${lines.join("\n")}\n${label}\n${normalizedOutput}`;
}
