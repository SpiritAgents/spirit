/**
 * Desktop-only host UI Markdown capabilities (Streamdown Mermaid).
 * Reply-level hints go through session.create → hostUiPromptSection (system
 * message); tool-targeted hints go through hostToolDescriptionHints and are
 * merged into tool descriptions by agent-core. CLI / ACP omit both.
 */
import type { HostToolDescriptionHint } from "@spiritagent/agent-core";

export function buildDesktopUiMarkdownPromptSection(): string {
  return "When a diagram helps (architecture, data flow, sequence), use a fenced mermaid code block; the host renders it.";
}

export function buildDesktopToolDescriptionHints(): HostToolDescriptionHint[] {
  return [
    {
      toolName: "create_plan",
      parameterName: "content",
      text: "If architecture or dataflow is non-obvious, include one short mermaid diagram; the host renders it.",
    },
  ];
}
