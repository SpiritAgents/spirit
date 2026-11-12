/**
 * First-run onboarding (OOBE) gating: decides whether to show the wizard based only on the host snapshot and persisted flags.
 */

export type OnboardingVisibilityInput = {
  /** Whether the persisted onboardingCompleted flag is known (host snapshot, or a sync on-disk read). */
  snapshotReady: boolean;
  /** Persisted "first-run onboarding completed" flag (config.json). */
  onboardingCompleted: boolean;
  /** Done was clicked to close during this session. */
  dismissedThisSession: boolean;
};

/** Whether the OOBE flow should be entered (independent of whether the snapshot is ready). */
export function resolveOnboardingExpected(
  input: Omit<OnboardingVisibilityInput, "snapshotReady">,
): boolean {
  if (input.dismissedThisSession) {
    return false;
  }
  return !input.onboardingCompleted;
}

export function resolveOnboardingVisible(input: OnboardingVisibilityInput): boolean {
  if (!input.snapshotReady) {
    return false;
  }
  return resolveOnboardingExpected(input);
}

/**
 * Snapshot is the source of truth once ready. Before that, a sync on-disk read (same pattern as
 * translucency) may already know the flag; the settings default `false` must not be used while unknown.
 */
export function resolveOnboardingCompletedKnown(input: {
  snapshotReady: boolean;
  snapshotOnboardingCompleted: boolean;
  storedOnboardingCompleted: boolean | undefined;
}): { known: boolean; completed: boolean } {
  if (input.snapshotReady) {
    return { known: true, completed: input.snapshotOnboardingCompleted };
  }
  if (input.storedOnboardingCompleted === undefined) {
    return { known: false, completed: false };
  }
  return { known: true, completed: input.storedOnboardingCompleted };
}

/** First-run OOBE skips the small LaunchSplash; returning users keep it until the snapshot arrives. */
export function resolveLaunchSplashActive(input: {
  snapshotReady: boolean;
  onboardingVisible: boolean;
  hasHostError: boolean;
  hasRuntimeError: boolean;
}): boolean {
  if (input.onboardingVisible || input.hasHostError || input.hasRuntimeError) {
    return false;
  }
  return !input.snapshotReady;
}
