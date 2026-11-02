import type { ReactNode } from "react";

import type { SpiritChipPayload } from "../lexical/spirit-chip-payload.js";
import { useComposerChipLabels } from "../lexical/chip-labels-context.js";
import { AgentModeChip } from "./agent-mode-chip.js";
import {
  ElementChip,
  FileSnippetChip,
  GitCommitChip,
  MessageQuoteChip,
  PrDiffChip,
  TerminalSnippetChip,
} from "./attachment-chips.js";
import { LoopChip } from "./loop-chip.js";
import { SkillChip } from "./skill-chip.js";
import { WorkspaceFileChip } from "./workspace-file-chip.js";
import { SessionReferenceChip } from "./session-reference-chip.js";

type SpiritChipDecoratorLabels = {
  planLabel?: string;
  askLabel?: string;
  debugLabel?: string;
  loopLabel?: string;
};

export function SpiritChipDecorator({
  payload,
  labels: labelsOverride,
}: {
  payload: SpiritChipPayload;
  labels?: SpiritChipDecoratorLabels;
}): ReactNode {
  const contextLabels = useComposerChipLabels();
  const labels = labelsOverride ?? contextLabels;
  switch (payload.kind) {
    case "plan":
      return <AgentModeChip kind="plan" label={labels.planLabel} />;
    case "ask":
      return <AgentModeChip kind="ask" label={labels.askLabel} />;
    case "debug":
      return <AgentModeChip kind="debug" label={labels.debugLabel} />;
    case "loop":
      return <LoopChip label={labels.loopLabel} />;
    case "skill":
      return <SkillChip alias={payload.alias} />;
    case "workspaceFile":
      return (
        <WorkspaceFileChip
          path={payload.path}
          sourceTabId={payload.sourceTabId}
          isPlan={payload.isPlan}
        />
      );
    case "sessionReference":
      return <SessionReferenceChip path={payload.path} title={payload.title} />;
    case "element":
      return <ElementChip attachment={payload.attachment} />;
    case "prDiff":
      return <PrDiffChip attachment={payload.attachment} />;
    case "gitCommit":
      return <GitCommitChip attachment={payload.attachment} />;
    case "terminalSnippet":
      return <TerminalSnippetChip attachment={payload.attachment} />;
    case "fileSnippet":
      return <FileSnippetChip attachment={payload.attachment} />;
    case "messageQuote":
      return <MessageQuoteChip attachment={payload.attachment} />;
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}
