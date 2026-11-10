import { useTranslation } from "react-i18next";

import { joinAnswersForLocale, type AskQuestionsAnswerGroup } from "@/lib/ask-questions-display";

/**
 * The ask_questions Q/A groups: small muted question labels with the answer below each. A group
 * submitted with no selection keeps its row with a muted no-selection placeholder (same size).
 */
export function AskQuestionsAnswerGroups({
  groups,
}: {
  groups: readonly AskQuestionsAnswerGroup[];
}) {
  const { t, i18n } = useTranslation();
  return (
    <ul className="space-y-2.5">
      {groups.map((group, index) => (
        // The answer list is the frozen result of one call; order is stable per card.
        <li key={index}>
          <p className="text-[10px] font-normal tracking-wide text-muted-foreground/70">
            {group.question}
          </p>
          {group.answers.length > 0 ? (
            <p className="mt-0.5 text-sm leading-snug">
              {joinAnswersForLocale(group.answers, i18n.language)}
            </p>
          ) : (
            <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
              {t("tool.askQuestionsNoSelection")}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
