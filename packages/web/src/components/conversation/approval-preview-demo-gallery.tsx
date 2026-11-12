import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ToolApprovalPrompt } from "@spiritagent/agent-core";

import { PendingApprovalCard } from "@/components/pending-approval-card";
import { PendingQuestionsCard } from "@/components/pending-questions-card";
import { AskQuestionsAnswerGroups } from "@/components/ask-questions-answer-groups";
import type { QuestionDraft } from "@/hooks/useDesktopRuntime";
import {
  fileContentPreviewForApprovalRequest,
  fileDiffPreviewsForApprovalRequest,
} from "@/lib/approval-file-previews";
import { buildApprovalPromptView } from "@/lib/approval-prompt";
import { resolveAskQuestionsAnswerGroups } from "@/lib/ask-questions-display";
import {
  buildApprovalPreviewDemoQuestions,
  type ApprovalPreviewDemoEntry,
} from "@/lib/approval-preview-demo";
import { CONVERSATION_GUTTER_X, CONVERSATION_MAX_W } from "@/lib/conversation-layout-constants";
import { cn } from "@/lib/utils";
import type { PendingToolApprovalSnapshot } from "@/types";

export function ApprovalPreviewDemoGallery({
  approvals,
  useTranslucency = false,
  showReasonNotes = true,
}: {
  approvals: readonly ApprovalPreviewDemoEntry[];
  useTranslucency?: boolean;
  showReasonNotes?: boolean;
}) {
  return (
    <div
      data-spirit-surface="approval-preview-demo-gallery"
      className={cn("mx-auto w-full py-6", CONVERSATION_GUTTER_X, CONVERSATION_MAX_W)}
    >
      <div className="flex flex-col gap-10">
        {approvals.map((entry, index) => (
          <ApprovalPreviewDemoCard
            // Static demo list, order never changes within a session of the demo.
            key={index}
            entry={entry}
            useTranslucency={useTranslucency}
            showReasonNotes={showReasonNotes}
          />
        ))}
        <ApprovalPreviewDemoQuestionsCard useTranslucency={useTranslucency} />
      </div>
    </div>
  );
}

/**
 * The real interactive questions form driven by the demo fixture. Submitting resolves the drafts
 * through the same Q/A resolver the message-list card uses; skipping shows the runtime's
 * `{"status":"skipped"}` output, exactly what the completed card would fall back to.
 */
function ApprovalPreviewDemoQuestionsCard({ useTranslucency }: { useTranslucency: boolean }) {
  const pendingQuestions = useMemo(() => buildApprovalPreviewDemoQuestions(), []);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
  const [outcome, setOutcome] = useState<
    | { kind: "answered"; groups: { question: string; answers: string[] }[] }
    | { kind: "raw"; raw: string }
    | null
  >(null);

  if (outcome?.kind === "answered") {
    return (
      <div className="overflow-hidden rounded-md border border-border/20 bg-muted/15 p-2">
        <AskQuestionsAnswerGroups groups={outcome.groups} />
      </div>
    );
  }
  if (outcome?.kind === "raw") {
    return (
      <pre
        data-spirit-selectable="text"
        className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border/20 bg-muted/15 p-2 font-mono text-xs leading-relaxed text-muted-foreground"
      >
        {outcome.raw}
      </pre>
    );
  }

  return (
    <PendingQuestionsCard
      pendingQuestions={pendingQuestions}
      questionDrafts={questionDrafts}
      questionsBusy={false}
      useTranslucency={useTranslucency}
      onUpdateDraft={(questionId, updater) =>
        setQuestionDrafts((current) => ({
          ...current,
          [questionId]: updater(current[questionId] ?? { selectedOptionIds: [], customText: "" }),
        }))
      }
      onSubmitQuestions={() => {
        const answers = pendingQuestions.request.questions.map((question) => {
          const draft = questionDrafts[question.id] ?? { selectedOptionIds: [], customText: "" };
          return {
            questionId: question.id,
            selectedOptionIds: draft.selectedOptionIds,
            ...(draft.customText.trim() ? { customText: draft.customText.trim() } : {}),
          };
        });
        const resultJson = JSON.stringify({ status: "answered", answers }, null, 2);
        const groups = resolveAskQuestionsAnswerGroups({
          argsExcerpt: JSON.stringify(pendingQuestions.request),
          outputExcerpt: resultJson,
        });
        setOutcome(groups ? { kind: "answered", groups } : { kind: "raw", raw: resultJson });
      }}
      onSkipQuestions={() => {
        const raw = JSON.stringify({ status: "skipped" }, null, 2);
        const groups = resolveAskQuestionsAnswerGroups({
          argsExcerpt: JSON.stringify(pendingQuestions.request),
          outputExcerpt: raw,
        });
        setOutcome(groups ? { kind: "answered", groups } : { kind: "raw", raw });
      }}
    />
  );
}

function ApprovalPreviewDemoCard({
  entry,
  useTranslucency,
  showReasonNotes,
}: {
  entry: ApprovalPreviewDemoEntry;
  useTranslucency: boolean;
  showReasonNotes: boolean;
}) {
  const { t } = useTranslation();
  const [guidance, setGuidance] = useState("");
  const prompt: ToolApprovalPrompt =
    entry.hookMessage !== undefined
      ? { kind: "hook", message: entry.hookMessage, request: entry.approval }
      : { kind: "tool", request: entry.approval };
  const view = buildApprovalPromptView(prompt, entry.toolName, t);
  const fileDiffPreviews = fileDiffPreviewsForApprovalRequest(entry.approval);
  const fileContentPreview = fileContentPreviewForApprovalRequest(entry.approval);
  const pendingApproval: PendingToolApprovalSnapshot = {
    toolName: view.title,
    prompt: view.body,
    autoReviewBlockReason: entry.autoReviewBlockReason,
    ...(entry.approval.kind === "lazy_tool_call" &&
    entry.approval.provider === "mcp" &&
    entry.approval.arguments !== undefined
      ? { mcpToolCallArgumentsJson: JSON.stringify(entry.approval.arguments, null, 2) }
      : {}),
    ...(entry.approval.kind === "create_automation"
      ? {
          automationApprovalLevel:
            entry.approval.approvalLevel === "auto-approval" ||
            entry.approval.approvalLevel === "bypass-approval"
              ? entry.approval.approvalLevel
              : ("default" as const),
        }
      : {}),
    ...(entry.hookMessage !== undefined ? { hookMessage: entry.hookMessage } : {}),
    ...(entry.approval.kind === "shell" ? { shellCommand: entry.approval.command } : {}),
    ...(fileDiffPreviews !== undefined ? { fileDiffPreviews } : {}),
    ...(fileContentPreview !== undefined ? { fileContentPreview } : {}),
    ...(entry.rememberTarget !== undefined ? { rememberTarget: entry.rememberTarget } : {}),
  };
  return (
    <PendingApprovalCard
      pendingApproval={pendingApproval}
      approvalGuidance={guidance}
      approveBusy={false}
      useTranslucency={useTranslucency}
      hideReasonNotes={!showReasonNotes}
      onApprovalGuidanceChange={setGuidance}
      onSubmitApproval={() => {}}
    />
  );
}
