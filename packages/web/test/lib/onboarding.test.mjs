import assert from "node:assert/strict";
import { test } from "vitest";

import {
  resolveLaunchSplashActive,
  resolveOnboardingCompletedKnown,
  resolveOnboardingExpected,
  resolveOnboardingVisible,
} from "../../src/lib/onboarding.ts";

test("resolveOnboardingExpected shows wizard before snapshot is ready", () => {
  assert.equal(
    resolveOnboardingExpected({
      onboardingCompleted: false,
      dismissedThisSession: false,
    }),
    true,
  );
});

test("resolveOnboardingExpected hides wizard once onboarding completed", () => {
  assert.equal(
    resolveOnboardingExpected({
      onboardingCompleted: true,
      dismissedThisSession: false,
    }),
    false,
  );
});

test("resolveOnboardingExpected never re-shows after dismissal in the same session", () => {
  assert.equal(
    resolveOnboardingExpected({
      onboardingCompleted: false,
      dismissedThisSession: true,
    }),
    false,
  );
});

test("resolveOnboardingVisible shows wizard when onboarding not completed", () => {
  assert.equal(
    resolveOnboardingVisible({
      snapshotReady: true,
      onboardingCompleted: false,
      dismissedThisSession: false,
    }),
    true,
  );
});

test("resolveOnboardingVisible hides wizard once onboarding completed", () => {
  assert.equal(
    resolveOnboardingVisible({
      snapshotReady: true,
      onboardingCompleted: true,
      dismissedThisSession: false,
    }),
    false,
  );
});

test("resolveOnboardingVisible hides wizard before snapshot is ready", () => {
  assert.equal(
    resolveOnboardingVisible({
      snapshotReady: false,
      onboardingCompleted: false,
      dismissedThisSession: false,
    }),
    false,
  );
});

test("resolveOnboardingVisible never re-shows after dismissal in the same session", () => {
  assert.equal(
    resolveOnboardingVisible({
      snapshotReady: true,
      onboardingCompleted: false,
      dismissedThisSession: true,
    }),
    false,
  );
});

test("resolveOnboardingCompletedKnown uses snapshot once ready", () => {
  assert.deepEqual(
    resolveOnboardingCompletedKnown({
      snapshotReady: true,
      snapshotOnboardingCompleted: true,
      storedOnboardingCompleted: false,
    }),
    { known: true, completed: true },
  );
});

test("resolveOnboardingCompletedKnown uses on-disk flag before snapshot", () => {
  assert.deepEqual(
    resolveOnboardingCompletedKnown({
      snapshotReady: false,
      snapshotOnboardingCompleted: false,
      storedOnboardingCompleted: false,
    }),
    { known: true, completed: false },
  );
  assert.deepEqual(
    resolveOnboardingCompletedKnown({
      snapshotReady: false,
      snapshotOnboardingCompleted: false,
      storedOnboardingCompleted: true,
    }),
    { known: true, completed: true },
  );
});

test("resolveOnboardingCompletedKnown stays unknown without snapshot or disk read", () => {
  assert.deepEqual(
    resolveOnboardingCompletedKnown({
      snapshotReady: false,
      snapshotOnboardingCompleted: false,
      storedOnboardingCompleted: undefined,
    }),
    { known: false, completed: false },
  );
});

test("resolveLaunchSplashActive skips splash when OOBE is visible before snapshot", () => {
  assert.equal(
    resolveLaunchSplashActive({
      snapshotReady: false,
      onboardingVisible: true,
      hasHostError: false,
      hasRuntimeError: false,
    }),
    false,
  );
});

test("resolveLaunchSplashActive keeps splash for returning users before snapshot", () => {
  assert.equal(
    resolveLaunchSplashActive({
      snapshotReady: false,
      onboardingVisible: false,
      hasHostError: false,
      hasRuntimeError: false,
    }),
    true,
  );
});

test("resolveLaunchSplashActive hides splash once snapshot is ready", () => {
  assert.equal(
    resolveLaunchSplashActive({
      snapshotReady: true,
      onboardingVisible: false,
      hasHostError: false,
      hasRuntimeError: false,
    }),
    false,
  );
});
