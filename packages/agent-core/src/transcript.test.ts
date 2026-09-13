import assert from "node:assert/strict";
import { test } from "vitest";

import { buildSessionTranscript } from "./transcript.js";
import { MANUAL_COMPACTION_SKIPPED_STATUS } from "./compaction-ui-status.js";
import { wrapCompactSummaryBlock } from "./llm-context-block.js";
import {
  buildCompactHistorySystemPrompt,
  buildCompactHistoryPromptMessages,
  COMPACT_HISTORY_TRIGGER_USER_PROMPT,
} from "./tool-agent.js";
import { createLlmMessageContentFromText } from "./ports.js";

test("buildSessionTranscript keeps user and assistant messages with toolCalls", () => {
  const transcript = buildSessionTranscript(
    [
      {
        role: "system",
        content: createLlmMessageContentFromText(wrapCompactSummaryBlock("old summary")),
      },
      {
        role: "user",
        content: createLlmMessageContentFromText("hello"),
      },
      {
        role: "assistant",
        content: [],
        toolCalls: [{ id: "call-1", name: "read_file", argumentsJson: '{"path":"a.ts"}' }],
      },
      {
        role: "tool",
        toolCallId: "call-1",
        content: createLlmMessageContentFromText("file contents"),
      },
      {
        role: "assistant",
        content: createLlmMessageContentFromText("done"),
      },
    ],
    1_700_000_000_000,
  );

  assert.equal(transcript.export_version, 1);
  assert.equal(transcript.kind, "session_transcript");
  assert.equal(transcript.exported_at_unix_ms, 1_700_000_000_000);
  assert.equal(transcript.message_count, 3);
  assert.equal(transcript.messages.length, 3);
  assert.equal(transcript.messages[0]?.role, "user");
  assert.equal(transcript.messages[1]?.role, "assistant");
  assert.deepEqual(transcript.messages[1]?.toolCalls, [
    { id: "call-1", name: "read_file", argumentsJson: '{"path":"a.ts"}' },
  ]);
  assert.equal(transcript.messages[2]?.role, "assistant");
  assert.equal(transcript.messages[2]?.toolCalls, undefined);
});

test("buildSessionTranscript omits manual compaction UI status assistant messages", () => {
  const transcript = buildSessionTranscript(
    [
      {
        role: "assistant",
        content: createLlmMessageContentFromText(MANUAL_COMPACTION_SKIPPED_STATUS),
      },
      {
        role: "user",
        content: createLlmMessageContentFromText("hello"),
      },
      {
        role: "assistant",
        content: createLlmMessageContentFromText("done"),
      },
    ],
    1_700_000_000_000,
  );

  assert.equal(transcript.message_count, 2);
  assert.equal(transcript.messages[0]?.role, "user");
  assert.equal(transcript.messages[1]?.role, "assistant");
});

test("buildCompactHistorySystemPrompt omits transcript section when no path is provided", () => {
  const prompt = buildCompactHistorySystemPrompt();
  assert.doesNotMatch(prompt, /\[Transcript\]/);
  assert.doesNotMatch(prompt, /Do not output only the path/);
  assert.match(prompt, /\[Open Items\]/);
});

test("buildCompactHistorySystemPrompt includes filled transcript section example when provided", () => {
  const path = "/data/transcripts/s1";
  const prompt = buildCompactHistorySystemPrompt(path);
  assert.match(prompt, /Example \[Transcript\] section shape/);
  assert.ok(
    prompt.includes(
      "[Transcript]\n/path/to/transcripts/session-1234567890\nImportant details may be recovered by reading transcript.json and optional subagents/*.json under this directory with read_file.",
    ),
  );
  assert.ok(
    prompt.includes(
      `Transcript directory path for this compaction (use this exact path on the transcript line): ${path}`,
    ),
  );
  const exampleBlock = prompt.split("Transcript directory path for this compaction")[0] ?? "";
  assert.doesNotMatch(exampleBlock, /\/Users\//);
  assert.match(prompt, /Do not output only the path/);
});

test("buildCompactHistoryPromptMessages uses native history instead of flattened replay", () => {
  const history = [
    { role: "user" as const, content: createLlmMessageContentFromText("hi") },
    {
      role: "assistant" as const,
      content: [],
      toolCalls: [{ id: "call-1", name: "read_file", argumentsJson: "{}" }],
    },
    {
      role: "tool" as const,
      toolCallId: "call-1",
      content: createLlmMessageContentFromText("file contents"),
    },
  ];
  const messages = buildCompactHistoryPromptMessages(history, {
    transcriptDirPath: "/tmp/transcripts/s1",
  });

  assert.equal(messages.length, 5);
  assert.equal(messages[0]?.role, "system");
  assert.match(
    messages[0]?.content[0]?.type === "text" ? messages[0].content[0].text : "",
    /\/tmp\/transcripts\/s1/,
  );
  assert.deepEqual(messages.slice(1, 4), history);
  assert.equal(messages[4]?.role, "user");
  assert.equal(
    messages[4]?.content[0]?.type === "text" ? messages[4].content[0].text : "",
    COMPACT_HISTORY_TRIGGER_USER_PROMPT,
  );
});
