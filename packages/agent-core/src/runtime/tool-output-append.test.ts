import assert from "node:assert/strict";
import { test } from "vitest";

import { createLlmMessageContentFromText, llmMessageTextContent } from "../ports.js";
import { TOOL_OUTPUT_TRUNCATION_LABEL } from "../tool-agent.js";
import { prepareAndSyncRuntimeToolResultToHistory } from "./tool-output-append.js";

test("prepareAndSyncRuntimeToolResultToHistory writes truncated prepared content to historyStore", async () => {
  const longToolOutput = "z".repeat(40_000);
  const historyStore = [
    {
      role: "tool" as const,
      toolCallId: "call_sync",
      content: createLlmMessageContentFromText(longToolOutput),
    },
  ];

  const prepared = await prepareAndSyncRuntimeToolResultToHistory(
    {
      options: {
        persistToolOutputArchive: async () => "/tmp/archive/call_sync.txt",
      } as never,
      historyStore,
    },
    "call_sync",
    longToolOutput,
  );

  assert.ok(prepared.length < longToolOutput.length);
  assert.match(prepared, new RegExp(TOOL_OUTPUT_TRUNCATION_LABEL.replace(/[[\]]/g, "\\$&")));
  assert.match(prepared, /Full output archived at: \/tmp\/archive\/call_sync\.txt/u);

  const toolMessage = historyStore[0];
  assert.ok(toolMessage);
  const historyText = llmMessageTextContent(toolMessage.content);
  assert.equal(historyText, prepared);
  assert.ok(historyText.length < longToolOutput.length);
});
