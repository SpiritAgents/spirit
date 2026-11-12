import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import {
  persistSessionTranscript,
  persistSubagentTranscript,
  resolveSessionTranscriptFilePath,
  resolveSubagentTranscriptFilePath,
  resolveTranscriptSessionDir,
  SESSION_TRANSCRIPT_FILE_NAME,
  transcriptSessionDirName,
} from "./transcript.js";

test("transcriptSessionDirName hashes keys so path flatten collisions stay distinct and bounded", () => {
  const left = transcriptSessionDirName("/a/b-c.json");
  const right = transcriptSessionDirName("/a-b/c.json");
  assert.notEqual(left, right);
  assert.match(left, /^[0-9a-f]{32}$/);
  assert.match(right, /^[0-9a-f]{32}$/);
  assert.equal(transcriptSessionDirName(undefined), "unknown");
  assert.equal(
    transcriptSessionDirName("/tmp/chat.json"),
    transcriptSessionDirName("/tmp/../tmp/chat.json"),
  );
});

test("persistSessionTranscript writes transcript.json under transcripts/{sessionKey}/ and returns dir", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-transcript-"));

  try {
    const transcript = {
      export_version: 1 as const,
      kind: "session_transcript" as const,
      exported_at_unix_ms: 1_700_000_000_000,
      message_count: 1,
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: "hello" }],
        },
      ],
    };

    const sessionDir = await persistSessionTranscript(spiritDataDir, transcript, {
      sessionKey: "session/1",
    });

    assert.equal(sessionDir, resolveTranscriptSessionDir(spiritDataDir, "session/1"));
    assert.equal(
      resolveSessionTranscriptFilePath(spiritDataDir, "session/1"),
      join(sessionDir, SESSION_TRANSCRIPT_FILE_NAME),
    );
    const written = JSON.parse(
      await readFile(join(sessionDir, SESSION_TRANSCRIPT_FILE_NAME), "utf8"),
    ) as typeof transcript;
    assert.deepEqual(written, transcript);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("persistSessionTranscript merges with existing file and never shrinks durable history", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-transcript-merge-"));

  try {
    const first = {
      export_version: 1 as const,
      kind: "session_transcript" as const,
      exported_at_unix_ms: 1,
      message_count: 2,
      messages: [
        { role: "user" as const, content: [{ type: "text" as const, text: "a" }] },
        { role: "user" as const, content: [{ type: "text" as const, text: "b" }] },
      ],
    };
    const second = {
      export_version: 1 as const,
      kind: "session_transcript" as const,
      exported_at_unix_ms: 2,
      message_count: 1,
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "c" }] }],
    };

    await persistSessionTranscript(spiritDataDir, first, { sessionKey: "sess-merge" });
    const sessionDir = await persistSessionTranscript(spiritDataDir, second, {
      sessionKey: "sess-merge",
    });
    const written = JSON.parse(
      await readFile(join(sessionDir, SESSION_TRANSCRIPT_FILE_NAME), "utf8"),
    ) as typeof first;
    assert.equal(written.message_count, 3);
    assert.deepEqual(
      written.messages.map((message) =>
        message.content[0]?.type === "text" ? message.content[0].text : "",
      ),
      ["a", "b", "c"],
    );
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});

test("persistSubagentTranscript writes under transcripts/{sessionKey}/subagents/", async () => {
  const spiritDataDir = await mkdtemp(join(tmpdir(), "spirit-transcript-sub-"));

  try {
    const transcript = {
      export_version: 1 as const,
      kind: "session_transcript" as const,
      exported_at_unix_ms: 1_700_000_000_000,
      message_count: 1,
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: "sub task" }],
        },
      ],
    };

    const filePath = await persistSubagentTranscript(spiritDataDir, transcript, {
      sessionKey: "sess-1",
      subagentSessionId: "subagent-1",
    });

    assert.equal(
      filePath,
      resolveSubagentTranscriptFilePath(spiritDataDir, "sess-1", "subagent-1"),
    );
    const written = JSON.parse(await readFile(filePath, "utf8")) as typeof transcript;
    assert.deepEqual(written, transcript);
  } finally {
    await rm(spiritDataDir, { recursive: true, force: true });
  }
});
