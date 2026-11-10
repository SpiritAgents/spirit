import assert from "node:assert/strict";
import { test } from "vitest";

import {
  shouldPrefocusComposerOnPaneClick,
  shouldRedirectKeydownToComposer,
} from "../../src/lib/composer-typing-focus-redirect.ts";

const plainDivTarget = { tagName: "DIV", isContentEditable: false, closest: () => null };

/** Returns non-null when closest matches the given selector fragment, simulating a target inside that subtree. */
const targetInside = (selectorFragment) => ({
  tagName: "DIV",
  isContentEditable: false,
  closest: (selector) => (selector.includes(selectorFragment) ? {} : null),
});

const keydownEvent = (overrides = {}) => ({
  defaultPrevented: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  key: "n",
  target: plainDivTarget,
  ...overrides,
});

test("shouldRedirectKeydownToComposer redirects printable character on plain target", () => {
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent()), true);
});

test("shouldRedirectKeydownToComposer redirects space and shifted characters", () => {
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent({ key: " " })), true);
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent({ key: "N" })), true);
});

test("shouldRedirectKeydownToComposer skips modified keys", () => {
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent({ ctrlKey: true, key: "c" })), false);
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent({ metaKey: true, key: "c" })), false);
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent({ altKey: true, key: "e" })), false);
});

test("shouldRedirectKeydownToComposer skips non-printable and prevented keys", () => {
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent({ key: "Enter" })), false);
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent({ key: "Dead" })), false);
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent({ defaultPrevented: true })), false);
});

test("shouldRedirectKeydownToComposer skips editable targets", () => {
  const textarea = { tagName: "TEXTAREA", isContentEditable: false, closest: () => null };
  const input = { tagName: "INPUT", isContentEditable: false, closest: () => null };
  const composer = { tagName: "DIV", isContentEditable: true, closest: () => null };
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent({ target: textarea })), false);
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent({ target: input })), false);
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent({ target: composer })), false);
});

test("shouldRedirectKeydownToComposer skips interactive targets", () => {
  // closest includes the element itself, so a native BUTTON hits the interactive selector
  const button = {
    tagName: "BUTTON",
    isContentEditable: false,
    closest: (s) => (s.includes("button") ? {} : null),
  };
  assert.equal(shouldRedirectKeydownToComposer(keydownEvent({ target: button, key: " " })), false);
  // role=button elements like the rewind bubble keep Enter/Space semantics
  assert.equal(
    shouldRedirectKeydownToComposer(keydownEvent({ target: targetInside('[role="button"]') })),
    false,
  );
  assert.equal(
    shouldRedirectKeydownToComposer(keydownEvent({ target: targetInside("[tabindex]") })),
    false,
  );
});

test("shouldRedirectKeydownToComposer skips overlay and terminal subtrees", () => {
  assert.equal(
    shouldRedirectKeydownToComposer(keydownEvent({ target: targetInside('[role="dialog"]') })),
    false,
  );
  assert.equal(
    shouldRedirectKeydownToComposer(keydownEvent({ target: targetInside('[role="menu"]') })),
    false,
  );
  assert.equal(
    shouldRedirectKeydownToComposer(keydownEvent({ target: targetInside(".xterm") })),
    false,
  );
  assert.equal(
    shouldRedirectKeydownToComposer(keydownEvent({ target: targetInside(".monaco-editor") })),
    false,
  );
});

test("shouldPrefocusComposerOnPaneClick prefocuses on plain click with collapsed selection", () => {
  assert.equal(shouldPrefocusComposerOnPaneClick(plainDivTarget, true), true);
});

test("shouldPrefocusComposerOnPaneClick keeps focus away after drag selection", () => {
  assert.equal(shouldPrefocusComposerOnPaneClick(plainDivTarget, false), false);
});

test("shouldPrefocusComposerOnPaneClick skips editable, interactive and overlay targets", () => {
  const composer = { tagName: "DIV", isContentEditable: true, closest: () => null };
  assert.equal(shouldPrefocusComposerOnPaneClick(composer, true), false);
  assert.equal(shouldPrefocusComposerOnPaneClick(targetInside('[role="button"]'), true), false);
  assert.equal(shouldPrefocusComposerOnPaneClick(targetInside('[role="dialog"]'), true), false);
  assert.equal(shouldPrefocusComposerOnPaneClick(targetInside(".xterm"), true), false);
});
