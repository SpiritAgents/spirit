/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, test, vi } from "vitest";

import { PendingQuestionsCard } from "@/components/pending-questions-card";
import type { QuestionDraft } from "@/hooks/useDesktopRuntime";
import type { PendingQuestionsSnapshot } from "@/types";

const pendingQuestions: PendingQuestionsSnapshot = {
  toolCallId: "questions-1",
  toolName: "ask_questions",
  request: {
    questions: [
      {
        id: "single",
        title: "Single choice",
        allowMultiple: false,
        options: [{ id: "alpha", label: "Alpha" }],
      },
      {
        id: "multi",
        title: "Multiple choice",
        allowMultiple: true,
        options: [
          { id: "beta", label: "Beta" },
          { id: "gamma", label: "Gamma" },
        ],
      },
    ],
  },
};

function Harness({
  onSubmit,
  onSkip,
  snapshot = pendingQuestions,
}: {
  onSubmit: (drafts: Record<string, QuestionDraft>) => void;
  onSkip: () => void;
  snapshot?: PendingQuestionsSnapshot;
}) {
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  return (
    <PendingQuestionsCard
      pendingQuestions={snapshot}
      questionDrafts={drafts}
      questionsBusy={false}
      onUpdateDraft={(questionId, updater) =>
        setDrafts((current) => ({
          ...current,
          [questionId]: updater(current[questionId] ?? { selectedOptionIds: [], customText: "" }),
        }))
      }
      onSubmitQuestions={() => onSubmit(drafts)}
      onSkipQuestions={onSkip}
    />
  );
}

test("places Skip in the header and Continue/Done beside the custom answer", () => {
  const onSubmit = vi.fn();
  const onSkip = vi.fn();
  render(<Harness onSubmit={onSubmit} onSkip={onSkip} />);

  const skipButton = screen.getByRole("button", { name: "Skip" });
  const nextButton = screen.getByRole("button", { name: "Next question" });
  expect(nextButton.nextElementSibling).toBe(skipButton);
  expect(skipButton.className).toBe(nextButton.className);

  let customAnswer = screen.getByPlaceholderText("Add details or an unlisted option");
  expect(screen.getByRole("button", { name: "Continue" }).parentElement).toBe(
    customAnswer.parentElement,
  );

  fireEvent.click(screen.getByRole("button", { name: /Alpha$/ }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText("Multiple choice")).toBeTruthy();

  const multiCustomAnswer = screen.getByPlaceholderText("Add details or an unlisted option");
  fireEvent.change(multiCustomAnswer, { target: { value: "Preset and custom" } });
  fireEvent.keyDown(multiCustomAnswer, { key: "Enter" });
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText("Multiple choice")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /Beta$/ }));
  fireEvent.click(screen.getByRole("button", { name: /Gamma$/ }));
  expect(onSubmit).not.toHaveBeenCalled();

  customAnswer = screen.getByPlaceholderText("Add details or an unlisted option");
  const doneButton = screen.getByRole("button", { name: "Done" });
  expect(doneButton.parentElement).toBe(customAnswer.parentElement);
  fireEvent.click(doneButton);
  expect(onSubmit).toHaveBeenCalledWith({
    single: { selectedOptionIds: ["alpha"], customText: "" },
    multi: { selectedOptionIds: ["beta", "gamma"], customText: "Preset and custom" },
  });

  fireEvent.click(skipButton);
  expect(onSkip).toHaveBeenCalledTimes(1);
});

test("submits a single-choice custom answer with Enter but not during IME composition", () => {
  const onSubmit = vi.fn();
  render(
    <Harness
      onSubmit={onSubmit}
      onSkip={() => {}}
      snapshot={{
        ...pendingQuestions,
        request: { questions: [pendingQuestions.request.questions[0]!] },
      }}
    />,
  );

  const customAnswer = screen.getByPlaceholderText("Add details or an unlisted option");
  fireEvent.change(customAnswer, { target: { value: "Custom only" } });
  fireEvent.keyDown(customAnswer, { key: "Enter", isComposing: true });
  expect(onSubmit).not.toHaveBeenCalled();

  fireEvent.keyDown(customAnswer, { key: "Enter" });
  expect(onSubmit).toHaveBeenCalledWith({
    single: { selectedOptionIds: [], customText: "Custom only" },
  });
});
