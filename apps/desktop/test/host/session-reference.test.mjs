import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { bindSessionStorageKey } from "@spiritagent/host-internal";
import {
  messageContentToRichSegments,
  scanSessionReferenceWireBlocks,
  segmentsToMessageText,
  sessionReferenceContextText,
} from "@spiritagent/ui/composer";

import { hydrateSessionReferenceWiresInUserText } from "../../dist-electron/src/host/hydrate-session-reference-wires.js";
import {
  listStoredSessions,
  saveStoredSession,
  setSpiritDataDirOverride,
} from "../../dist-electron/src/host/storage.js";
import { sessionCandidatesFromListItems } from "../../src/lib/composer-at-reference-demo.ts";
import { buildV2StoredSession } from "./chat-schema-fixture.mjs";

const sessionId = "00000000-0000-4000-8000-000000000010";

test("session references carry the canonical Session ID through model hydration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sr-"));
  setSpiritDataDirOverride(root);
  try {
    const chatPath = path.join(root, "chats", "chat-reference.json");
    await saveStoredSession(
      chatPath,
      buildV2StoredSession({
        userContent: "Continue the referenced session",
        sessionDisplayName: "Referenced target",
      }),
    );
    await bindSessionStorageKey(root, chatPath, sessionId);

    const [listed] = await listStoredSessions();
    assert.equal(listed.sessionId, sessionId);
    const [candidate] = sessionCandidatesFromListItems([listed]);
    assert.equal(candidate.sessionId, sessionId);

    await mkdir(path.dirname(listed.transcriptPath), { recursive: true });
    await writeFile(listed.transcriptPath, "Referenced transcript body");
    const wire = sessionReferenceContextText(
      listed.transcriptPath,
      listed.displayName,
      "",
      candidate.sessionId,
    );
    const hydrated = await hydrateSessionReferenceWiresInUserText(
      `Continue this session.\n${wire}`,
    );
    assert.match(hydrated, new RegExp(`session_id=${sessionId}`));
    assert.match(hydrated, /Referenced transcript body/);

    const [block] = scanSessionReferenceWireBlocks(hydrated);
    assert.equal(block.sessionId, sessionId);
    assert.equal(block.content, "Referenced transcript body");
    const segments = messageContentToRichSegments(hydrated, "reference-test");
    const reference = segments.find((segment) => segment.kind === "sessionReference");
    assert.equal(reference.sessionId, sessionId);
    assert.match(segmentsToMessageText(segments), new RegExp(`session_id=${sessionId}`));

    const legacy = sessionReferenceContextText(listed.transcriptPath, listed.displayName, "body");
    assert.doesNotMatch(legacy, /session_id=/);
    assert.equal(scanSessionReferenceWireBlocks(legacy)[0].sessionId, undefined);

    const tabbedTitle = sessionReferenceContextText(
      listed.transcriptPath,
      "Target\tAlpha",
      "body",
      sessionId,
    );
    const [tabbedBlock] = scanSessionReferenceWireBlocks(tabbedTitle);
    assert.equal(tabbedBlock.title, "Target\tAlpha");
    assert.equal(tabbedBlock.sessionId, sessionId);
  } finally {
    setSpiritDataDirOverride(undefined);
    await rm(root, { recursive: true, force: true });
  }
});
