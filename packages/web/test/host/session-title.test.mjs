import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildSessionTitlePrompt,
  normalizeGeneratedSessionTitle,
  SESSION_TITLE_MAX_LENGTH,
} from "@spiritagent/host-internal";
import { DesktopMessageTimeline } from "../../../../packages/sessions/dist/host/message-timeline.js";
import {
  countUserMessages,
  prepareSessionTitleForFirstUserTurn,
} from "../../../../packages/sessions/dist/host/session-title-first-turn.js";
import { applyGeneratedSessionTitle } from "../../../../packages/sessions/dist/host/session-title-service.js";
import { createEmptySessionBundle } from "../../../../packages/sessions/dist/host/session-bundle.js";

test("buildSessionTitlePrompt includes user message and language rule", () => {
  const prompt = buildSessionTitlePrompt("Help me build a Desktop session title feature");
  assert.match(prompt, /same language as the user message/i);
  assert.match(prompt, /Help me build a Desktop session title feature/);
  assert.match(prompt, /"title"/);
});

test("normalizeGeneratedSessionTitle trims, strips quotes, and caps length", () => {
  const fallback = "seed title";
  assert.equal(normalizeGeneratedSessionTitle("  hello world  ", fallback), "hello world");
  assert.equal(normalizeGeneratedSessionTitle('"quoted title"', fallback), "quoted title");
  assert.equal(normalizeGeneratedSessionTitle("", fallback), fallback);
  assert.equal(
    normalizeGeneratedSessionTitle("x".repeat(SESSION_TITLE_MAX_LENGTH + 10), fallback).length,
    SESSION_TITLE_MAX_LENGTH + 1,
  );
});

test("prepareSessionTitleForFirstUserTurn resets llm title state before the first user turn", () => {
  const bundle = createEmptySessionBundle("/tmp/workspace");
  bundle.activeSession = {
    filePath: "/tmp/workspace/session.json",
    displayName: "Old LLM title",
    kind: "stored",
  };
  bundle.sessionTitleSource = "llm";

  const prepared = prepareSessionTitleForFirstUserTurn(bundle, "Rewritten first message");

  assert.equal(prepared, true);
  assert.equal(bundle.sessionTitleSource, "seed");
  assert.equal(bundle.activeSession.displayName, "Rewritten first message");
});

test("prepareSessionTitleForFirstUserTurn is a no-op when user messages already exist", () => {
  const bundle = createEmptySessionBundle("/tmp/workspace");
  bundle.activeSession = {
    filePath: "/tmp/workspace/session.json",
    displayName: "Existing title",
    kind: "stored",
  };
  bundle.sessionTitleSource = "llm";
  let nextMessageId = 1;
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextMessageId++,
  });
  timeline.beginUserTurn("First message");
  bundle.messageTimeline = timeline;
  bundle.messages = timeline.toMessages();

  const prepared = prepareSessionTitleForFirstUserTurn(bundle, "Second message");

  assert.equal(prepared, false);
  assert.equal(bundle.sessionTitleSource, "llm");
  assert.equal(bundle.activeSession.displayName, "Existing title");
  assert.equal(countUserMessages(bundle), 1);
});

test("buildSessionTitlePrompt describes attached media when the user text is empty", () => {
  const prompt = buildSessionTitlePrompt("", { hasMedia: true });
  assert.match(prompt, /media attachments/i);
  assert.doesNotMatch(prompt, /\(empty\)/);
});

test("applyGeneratedSessionTitle ignores a late title after manual rename", async () => {
  const bundle = createEmptySessionBundle("/tmp/workspace");
  const sessionPath = "/tmp/workspace/session.json";
  bundle.activeSession = {
    filePath: sessionPath,
    displayName: "Manual title",
    kind: "stored",
  };
  bundle.sessionTitleSource = "manual";
  let persisted = false;
  await applyGeneratedSessionTitle({
    sessionPath,
    title: "LLM title",
    registry: {
      findBySessionPath: () => bundle,
    },
    runSerialized: async (work) => work(),
    persistBundle: async () => {
      persisted = true;
    },
    notifySessionListUpdated: () => {},
  });
  assert.equal(bundle.activeSession.displayName, "Manual title");
  assert.equal(bundle.sessionTitleSource, "manual");
  assert.equal(persisted, false);
});
