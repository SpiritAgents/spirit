import type { ToolBlockSnapshot } from "@/types";

export type AskQuestionsAnswerGroup = {
  question: string;
  /** Readable answers in card order: option labels resolved from ids, then any custom text. */
  answers: string[];
};

type AskQuestionsRequestRecord = {
  questions?: Array<{
    id?: string;
    title?: string;
    options?: Array<{ id?: string; label?: string }>;
  }>;
};

type AskQuestionsResultRecord = {
  status?: string;
  answers?: Array<{
    questionId?: string;
    selectedOptionIds?: string[];
    customText?: string;
  }>;
};

function parseJsonRecord(raw: string | undefined): Record<string, unknown> | undefined {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The ask_questions card's structured Q&A groups: answer ids resolved back to their readable
 * question titles / option labels via the request (unresolvable ids pass through verbatim — old
 * snapshots predate full-fidelity args). Questions submitted with no selection keep their group
 * with an empty `answers` list (the UI renders the localized no-selection placeholder); a skipped
 * form lists its questions the same way. Returns undefined only when there is nothing to show
 * (still streaming, or the request is missing).
 */
export function resolveAskQuestionsAnswerGroups(
  tool: Pick<ToolBlockSnapshot, "argsExcerpt" | "outputExcerpt">,
): AskQuestionsAnswerGroup[] | undefined {
  const request = parseJsonRecord(tool.argsExcerpt) as AskQuestionsRequestRecord | undefined;
  const result = parseJsonRecord(tool.outputExcerpt) as AskQuestionsResultRecord | undefined;
  const questions = Array.isArray(request?.questions) ? request.questions : [];

  // A skipped form still shows its questions, each with the no-selection placeholder.
  if (result?.status === "skipped") {
    const skippedGroups = questions
      .filter((question) => typeof question?.title === "string" && question.title.trim())
      .map((question) => ({ question: (question?.title ?? "").trim(), answers: [] }));
    return skippedGroups.length > 0 ? skippedGroups : undefined;
  }

  const answers = result?.answers;
  if (!Array.isArray(answers) || answers.length === 0) {
    return undefined;
  }

  const groups: AskQuestionsAnswerGroup[] = [];
  for (const answer of answers) {
    if (!answer || typeof answer !== "object") {
      continue;
    }
    const question = questions.find((entry) => entry?.id === answer.questionId);
    const optionLabelById = new Map(
      (question?.options ?? [])
        .filter((option) => typeof option?.id === "string")
        .map((option) => [option.id as string, option.label ?? (option.id as string)]),
    );
    const selected = (Array.isArray(answer.selectedOptionIds) ? answer.selectedOptionIds : [])
      .filter((id): id is string => typeof id === "string")
      .map((id) => optionLabelById.get(id) ?? id);
    const customText = typeof answer.customText === "string" ? answer.customText.trim() : "";
    const resolved = customText ? [...selected, customText] : selected;
    groups.push({
      question: question?.title?.trim() || (answer.questionId ?? ""),
      answers: resolved,
    });
  }
  return groups.length > 0 ? groups : undefined;
}

/** Joins multi-select answers with the locale's official list conjunction (CLDR via Intl). */
export function joinAnswersForLocale(answers: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, { type: "conjunction", style: "long" }).format(answers);
}
