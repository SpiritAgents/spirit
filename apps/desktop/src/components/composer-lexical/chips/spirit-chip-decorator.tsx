import type { ReactNode } from "react";

import type { SpiritChipPayload } from "@/lib/composer-lexical/spirit-chip-payload";
import { useComposerChipLabels } from "@/lib/composer-lexical/chip-labels-context";
import { AgentModeChip } from "@/components/composer-lexical/chips/agent-mode-chip";
import {
  ElementChip,
  FileSnippetChip,
  GitCommitChip,
  MessageQuoteChip,
  PrDiffChip,
  TerminalSnippetChip,
} from "@/components/composer-lexical/chips/attachment-chips";
import { LoopChip } from "@/components/composer-lexical/chips/loop-chip";
import { SkillChip } from "@/components/composer-lexical/chips/skill-chip";
import { WorkspaceFileChip } from "@/components/composer-lexical/chips/workspace-file-chip";
import { SessionReferenceChip } from "@/components/composer-lexical/chips/session-reference-chip";

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
