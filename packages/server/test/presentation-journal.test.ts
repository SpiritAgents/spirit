import { expect, it } from "vitest";
import { PresentationJournal } from "../src/presentation-journal.js";

it("preserves public replies independently of model history compaction", () => {
  const journal = new PresentationJournal();
  journal.append({ kind: "user", text: "Run the task" });
  journal.append({ kind: "runtime", event: { kind: "assistant-chunk", text: "First reply" } });
  const cursor = journal.snapshot().sequence;
  journal.append({ kind: "runtime", event: { kind: "assistant-chunk", text: "Offline reply" } });
  journal.acknowledge(cursor);
  const restored = new PresentationJournal(journal.snapshot());
  expect(restored.snapshot()).toEqual({
    sequence: 3,
    entries: [
      { sequence: 3, kind: "runtime", event: { kind: "assistant-chunk", text: "Offline reply" } },
    ],
  });
  expect(() => restored.acknowledge(4)).toThrow("Invalid presentation sequence");
});

it("does not duplicate durable task output logs inside the presentation journal", () => {
  const journal = new PresentationJournal();
  journal.append({
    kind: "runtime",
    event: {
      kind: "tool-execution-output-chunk",
      toolCallId: "shell",
      toolName: "shell",
      request: {},
      chunk: "output",
    },
  });
  expect(journal.snapshot()).toEqual({ sequence: 1, entries: [] });
});
