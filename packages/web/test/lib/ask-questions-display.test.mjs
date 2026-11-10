import assert from "node:assert/strict";
import { test } from "vitest";

import {
  joinAnswersForLocale,
  resolveAskQuestionsAnswerGroups,
} from "../../src/lib/ask-questions-display.ts";

const REQUEST = JSON.stringify({
  questions: [
    {
      id: "release-strategy",
      title: "Ship the approval frame refresh as one release?",
      options: [
        { id: "ship", label: "Ship it" },
        { id: "split", label: "Split into two releases" },
      ],
    },
    {
      id: "gallery-scope",
      title: "Which cards stay in the demo gallery?",
      allowMultiple: true,
      options: [
        { id: "shell", label: "Shell" },
        { id: "mcp", label: "MCP" },
        { id: "todo", label: "TODO" },
      ],
    },
  ],
});

function toolWith(output) {
  return { argsExcerpt: REQUEST, outputExcerpt: JSON.stringify(output) };
}

test("answer ids resolve back to readable question titles and option labels", () => {
  const groups = resolveAskQuestionsAnswerGroups(
    toolWith({
      status: "answered",
      answers: [
        { questionId: "release-strategy", selectedOptionIds: ["ship"] },
        { questionId: "gallery-scope", selectedOptionIds: ["shell", "todo"] },
      ],
    }),
  );
  assert.deepEqual(groups, [
    { question: "Ship the approval frame refresh as one release?", answers: ["Ship it"] },
    { question: "Which cards stay in the demo gallery?", answers: ["Shell", "TODO"] },
  ]);
});

test("customText rides as its own answer, after any selected options", () => {
  const groups = resolveAskQuestionsAnswerGroups(
    toolWith({
      status: "answered",
      answers: [{ questionId: "gallery-scope", selectedOptionIds: ["mcp"], customText: "Diffs" }],
    }),
  );
  assert.deepEqual(groups, [
    { question: "Which cards stay in the demo gallery?", answers: ["MCP", "Diffs"] },
  ]);
});

test("unknown option ids pass through verbatim (legacy or truncated snapshots)", () => {
  const groups = resolveAskQuestionsAnswerGroups(
    toolWith({
      status: "answered",
      answers: [{ questionId: "gallery-scope", selectedOptionIds: ["gone"] }],
    }),
  );
  assert.deepEqual(groups?.[0]?.answers, ["gone"]);
});

test("skipped forms list their questions with the no-selection placeholder", () => {
  assert.deepEqual(resolveAskQuestionsAnswerGroups(toolWith({ status: "skipped" })), [
    { question: "Ship the approval frame refresh as one release?", answers: [] },
    { question: "Which cards stay in the demo gallery?", answers: [] },
  ]);
  // No parseable request: nothing to structure, the raw output stays.
  assert.equal(
    resolveAskQuestionsAnswerGroups({ outputExcerpt: JSON.stringify({ status: "skipped" }) }),
    undefined,
  );
});

test("unanswered or unparseable forms keep the raw output view", () => {
  assert.equal(
    resolveAskQuestionsAnswerGroups({ argsExcerpt: REQUEST, outputExcerpt: "" }),
    undefined,
  );
  assert.equal(resolveAskQuestionsAnswerGroups({ outputExcerpt: "not json" }), undefined);
});

test("a submitted-but-unselected answer keeps its structured group with an empty answer list", () => {
  const groups = resolveAskQuestionsAnswerGroups(
    toolWith({
      status: "answered",
      answers: [
        { questionId: "release-strategy", selectedOptionIds: [] },
        { questionId: "gallery-scope", selectedOptionIds: ["mcp"] },
      ],
    }),
  );
  assert.deepEqual(groups, [
    { question: "Ship the approval frame refresh as one release?", answers: [] },
    { question: "Which cards stay in the demo gallery?", answers: ["MCP"] },
  ]);
});

test("answer joining follows the locale's official list conjunction (Intl.ListFormat)", () => {
  const answers = ["Ship it", "Split it"];
  assert.equal(joinAnswersForLocale(answers, "en"), "Ship it and Split it");
  assert.equal(joinAnswersForLocale(answers, "zh-CN"), "Ship it和Split it");
  assert.equal(joinAnswersForLocale(answers, "zh-TW"), "Ship it和Split it");
  assert.equal(joinAnswersForLocale(answers, "ja"), "Ship it、Split it");
  assert.equal(joinAnswersForLocale(answers, "de"), "Ship it und Split it");
  assert.equal(joinAnswersForLocale(answers, "fr"), "Ship it et Split it");
  // Any locale works natively — no shipped-locale map to maintain.
  assert.equal(joinAnswersForLocale(answers, "it"), "Ship it e Split it");
});
