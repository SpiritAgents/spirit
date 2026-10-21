import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { SpiritGlassLogo, spiritGlassLogoMaskStyle } from "@spiritagent/brand";

import { OnboardingAppearanceControls } from "@/components/onboarding/onboarding-appearance-step";
import { OnboardingAttributionControls } from "@/components/onboarding/onboarding-attribution-step";
import { OnboardingConnectControls } from "@/components/onboarding/onboarding-connect-step";
import type { SettingsFormState } from "@/components/settings/types";
import { Button } from "@/components/ui/button";
import { DESKTOP_PAGE_TITLE_CLASS } from "@/lib/desktop-typography";
import { desktopFullscreenOverlayTintClass } from "@/lib/desktop-translucency-surface";
import type { ShellOverlayPhase } from "@/lib/desktop-shell";
import { prefersReducedMotion } from "@/lib/reduce-motion";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import type {
  AddModelRequest,
  AddProviderModelsRequest,
  DesktopProviderPickerPreset,
  PreviewModelsRequest,
  PreviewModelsResponse,
} from "@/types";

const ONBOARDING_LOGO_WIDTH_PX = 104;

/** Matches the duration of `spirit-oobe-step-exit-*` in styles.css */
const STEP_EXIT_MS = 200;
/** Duration of the full-layer fade-out after clicking Done */
const WIZARD_EXIT_MS = 360;
/** How long after entering the welcome step the product name fades in (counted from entering Step 1, independent of the snapshot) */
const WELCOME_TITLE_DELAY_MS = 500;
/** How long after entering the welcome step Continue fades in (counted from entering Step 1, independent of the snapshot) */
const WELCOME_CONTINUE_DELAY_MS = 1000;
/** Matches the single-sweep duration of `.spirit-launch-shimmer-sweep` in styles.css */
const LAUNCH_SHIMMER_CYCLE_MS = 2900;
/** Ends the shimmer before the CSS iteration jumps back to 125%, avoiding the visual of "a new round just starting then being cut off" */
const SHIMMER_FINISH_BEFORE_ITERATION_MS = 120;

/** Reads the remaining time until the current shimmer sweep round ends (Web Animations API, slightly ahead of the iteration boundary). */
function readShimmerRemainingMs(el: HTMLElement): number {
  const anim = el.getAnimations()[0];
  if (anim != null && anim.currentTime != null) {
    const timing = anim.effect?.getComputedTiming();
    const duration =
      typeof timing?.duration === "number" && timing.duration > 0
        ? timing.duration
        : LAUNCH_SHIMMER_CYCLE_MS;
    const phase = Number(anim.currentTime) % duration;
    const untilIteration = phase === 0 ? duration : duration - phase;
    return Math.max(0, untilIteration - SHIMMER_FINISH_BEFORE_ITERATION_MS);
  }
  return LAUNCH_SHIMMER_CYCLE_MS - SHIMMER_FINISH_BEFORE_ITERATION_MS;
}

type WizardPhase = "running" | "leaving" | "gone";
type OnboardingStep = 1 | 2 | 3 | 4;
type StepDirection = "forward" | "backward";

type LeavingStepState = {
  step: OnboardingStep;
  direction: StepDirection;
  /** Freezes the list bottom-edge fade during the Step 3 exit animation, so the mask does not flash away after remount. */
  connectBottomFade?: boolean;
};

type OnboardingWizardProps = {
  /** When true the wizard is shown; when it becomes false, it plays the fade-out and then unmounts. */
  active: boolean;
  /** translucency (Win Mica / macOS Vibrancy): consistent with launch-splash; when enabled, uses the fullscreen overlay tint. */
  useTranslucency?: boolean;
  settings: SettingsFormState;
  onSavePatch: (patch: Partial<SettingsFormState>) => Promise<void>;
  /** Preset picker rows from the host snapshot (provider list order + fallback labels). */
  providerPickerPresets: readonly DesktopProviderPickerPreset[];
  modelsBusy: boolean;
  modelsPreviewBusy: boolean;
  onAddModel: (request: AddModelRequest) => Promise<void>;
  onAddProviderModels: (request: AddProviderModelsRequest) => Promise<void>;
  onPreviewModels: (request: PreviewModelsRequest) => Promise<PreviewModelsResponse>;
  /** Clicking Done: the host persists onboardingCompleted and closes the wizard. */
  onDone: () => void;
  /** Phase changes during the mount lifetime (so the host does not reveal app-body early, before leaving). */
  onPhaseChange?: (phase: ShellOverlayPhase) => void;
};

/** Content-block marker for entry stagger: the larger the index, the later it appears (40ms increments). */
function oobeBlockProps(index: number): {
  "data-oobe-block": true;
  style: CSSProperties;
} {
  return {
    "data-oobe-block": true,
    style: { "--spirit-oobe-block": index } as CSSProperties,
  };
}

/**
 * First-run (OOBE) wizard: a full-window overlay layered below LaunchSplash (z-200) and Radix
 * overlays (z-50), above the main UI. Three-step flow: welcome / appearance / connect providers.
 */
export function OnboardingWizard({
  active,
  useTranslucency = false,
  settings,
  onSavePatch,
  providerPickerPresets,
  modelsBusy,
  modelsPreviewBusy,
  onAddModel,
  onAddProviderModels,
  onPreviewModels,
  onDone,
  onPhaseChange,
}: OnboardingWizardProps) {
  const [phase, setPhase] = useState<WizardPhase>(() => (active ? "running" : "gone"));
  const [step, setStep] = useState<OnboardingStep>(1);
  /**
   * Most recent navigation direction. Must be independent state rather than derived from
   * leavingStep: a derived value would fall back once the exiting node is cleared, renaming the
   * entering node's class and restarting the CSS animation from the beginning.
   */
  const [direction, setDirection] = useState<StepDirection>("forward");
  /** The first entry into Step 1 plays no entry animation; enabled only after the user manually continues/goes back. */
  const [hasManualNavigation, setHasManualNavigation] = useState(false);
  /** The old step currently exiting; cleared after its animation finishes. */
  const [leavingStep, setLeavingStep] = useState<LeavingStepState | null>(null);
  /** Snapshot of the Step 3 list bottom-edge fade, used to freeze the mask on exit remount. */
  const connectBottomFadeRef = useRef(false);
  const handleConnectBottomFadeChange = useCallback((hasMoreBelow: boolean) => {
    connectBottomFadeRef.current = hasMoreBelow;
  }, []);

  useEffect(() => {
    if (active) {
      setPhase("running");
      return;
    }
    setPhase((current) => (current === "gone" ? current : "leaving"));
  }, [active]);

  useEffect(() => {
    if (phase !== "leaving") {
      return;
    }
    const id = window.setTimeout(() => {
      setPhase("gone");
    }, WIZARD_EXIT_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (leavingStep === null) {
      return;
    }
    const id = window.setTimeout(() => {
      setLeavingStep(null);
    }, STEP_EXIT_MS);
    return () => window.clearTimeout(id);
  }, [leavingStep]);

  useLayoutEffect(() => {
    onPhaseChange?.(phase);
  }, [onPhaseChange, phase]);

  if (phase === "gone") {
    return null;
  }

  const goToStep = (next: OnboardingStep) => {
    if (next === step) {
      return;
    }
    const nextDirection: StepDirection = next > step ? "forward" : "backward";
    setHasManualNavigation(true);
    setDirection(nextDirection);
    setLeavingStep({
      step,
      direction: nextDirection,
      ...(step === 3 ? { connectBottomFade: connectBottomFadeRef.current } : {}),
    });
    setStep(next);
  };

  const exiting = phase === "leaving";

  const renderStep = (
    target: OnboardingStep,
    options?: Pick<LeavingStepState, "connectBottomFade"> & { leaving?: boolean },
  ): ReactNode => {
    switch (target) {
      case 1:
        return <OnboardingWelcomeStep onContinue={() => goToStep(2)} />;
      case 2:
        return (
          <OnboardingAppearanceStep
            settings={settings}
            onSavePatch={onSavePatch}
            onBack={() => goToStep(1)}
            onContinue={() => goToStep(3)}
          />
        );
      case 3:
        return (
          <OnboardingConnectStep
            modelsBusy={modelsBusy}
            modelsPreviewBusy={modelsPreviewBusy}
            providerPickerPresets={providerPickerPresets}
            onAddModel={onAddModel}
            onAddProviderModels={onAddProviderModels}
            onPreviewModels={onPreviewModels}
            onBack={() => goToStep(2)}
            onContinue={() => goToStep(4)}
            onBottomFadeChange={options?.leaving ? undefined : handleConnectBottomFadeChange}
            pinnedBottomFade={options?.leaving ? options.connectBottomFade : undefined}
            freezeBottomFade={options?.leaving === true}
          />
        );
      case 4:
        return (
          <OnboardingAttributionStep
            settings={settings}
            onSavePatch={onSavePatch}
            onBack={() => goToStep(3)}
            onDone={onDone}
          />
        );
    }
  };

  return (
    <div
      data-spirit-surface="onboarding-wizard"
      aria-hidden={exiting}
      className={cn(
        // z-40: below Radix overlays (Dialog/Select etc. at z-50) so dialogs inside the wizard can
        // stay on top; still above the main UI so it covers the already-revealed app-body during
        // the fade-out.
        "fixed inset-0 z-40 flex flex-col",
        desktopFullscreenOverlayTintClass(useTranslucency),
        "transition-opacity duration-[360ms] ease-out motion-reduce:duration-150",
        exiting ? "pointer-events-none opacity-0" : "opacity-100",
      )}
    >
      <div className="relative min-h-0 flex-1">
        {leavingStep !== null ? (
          <div
            key={`oobe-leaving-${leavingStep.step}`}
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0",
              leavingStep.direction === "forward"
                ? "spirit-oobe-step-exit-forward"
                : "spirit-oobe-step-exit-backward",
            )}
          >
            {renderStep(leavingStep.step, {
              leaving: true,
              connectBottomFade: leavingStep.connectBottomFade,
            })}
          </div>
        ) : null}
        <div
          key={`oobe-step-${step}`}
          className={cn(
            "absolute inset-0",
            hasManualNavigation &&
              (direction === "forward"
                ? "spirit-oobe-step-enter-forward"
                : "spirit-oobe-step-enter-backward"),
          )}
        >
          {renderStep(step)}
        </div>
      </div>
    </div>
  );
}

/** Shared layout + bottom navigation row for Step 2/3. */
function OnboardingStepShell({
  title,
  children,
  footer,
  contentLayout = "spread",
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  /**
   * spread: title top-aligned, content area flex-1 (Step 3's long list).
   * centered: title and content vertically centered as a group, title directly above the content (Step 2).
   */
  contentLayout?: "spread" | "centered";
}) {
  if (contentLayout === "centered") {
    return (
      <div className="flex h-full min-h-0 flex-col items-center px-8 pb-8">
        <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
          <h1 {...oobeBlockProps(0)} className={cn("shrink-0", DESKTOP_PAGE_TITLE_CLASS)}>
            {title}
          </h1>
          <div {...oobeBlockProps(1)} className="flex w-full flex-col items-center pt-8">
            {children}
          </div>
        </div>
        <div {...oobeBlockProps(2)} className="flex shrink-0 items-center gap-3 pt-6">
          {footer}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col items-center px-8 pt-14 pb-8">
      <h1 {...oobeBlockProps(0)} className={cn("shrink-0", DESKTOP_PAGE_TITLE_CLASS)}>
        {title}
      </h1>
      <div {...oobeBlockProps(1)} className="flex min-h-0 w-full flex-1 flex-col items-center pt-8">
        {children}
      </div>
      <div {...oobeBlockProps(2)} className="flex shrink-0 items-center gap-3 pt-6">
        {footer}
      </div>
    </div>
  );
}

/** Step 1: centered brand icon and product name; the title and Continue fade in at a fixed timing of 0.5s / 1s after entry; the shimmer finishes its current round independently. */
function OnboardingWelcomeStep({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation();
  const [titleVisible, setTitleVisible] = useState(false);
  const [continueVisible, setContinueVisible] = useState(false);
  const [shimmerActive, setShimmerActive] = useState(true);
  const shimmerSweepRef = useRef<HTMLDivElement>(null);

  // The shimmer is decoupled from Continue: on mount it schedules a natural end based on the
  // current sweep phase, without blocking the button
  useLayoutEffect(() => {
    const el = shimmerSweepRef.current;
    if (!el) {
      return;
    }
    if (prefersReducedMotion()) {
      setShimmerActive(false);
      return;
    }
    const remainingMs = readShimmerRemainingMs(el);
    const id = window.setTimeout(() => {
      setShimmerActive(false);
    }, remainingMs);
    return () => window.clearTimeout(id);
  }, []);

  // Fixed timing counted from entering Step 1, independent of snapshot readiness (first entry and
  // returning from Step 2 feel the same)
  useEffect(() => {
    setTitleVisible(false);
    setContinueVisible(false);

    const titleTimeout = window.setTimeout(() => setTitleVisible(true), WELCOME_TITLE_DELAY_MS);

    const continueId = window.setTimeout(() => {
      setContinueVisible(true);
    }, WELCOME_CONTINUE_DELAY_MS);

    return () => {
      window.clearTimeout(titleTimeout);
      window.clearTimeout(continueId);
    };
  }, []);

  return (
    <div {...oobeBlockProps(0)} className="flex h-full flex-col items-center justify-center">
      <div className="relative shrink-0" style={{ width: ONBOARDING_LOGO_WIDTH_PX }}>
        <SpiritGlassLogo width={ONBOARDING_LOGO_WIDTH_PX} className="relative z-0" />
        {/* Keep the DOM stably mounted, avoiding re-render remounts that would restart the sweep from 125% */}
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-10 overflow-hidden",
            !shimmerActive && "invisible",
          )}
          style={spiritGlassLogoMaskStyle()}
          aria-hidden={!shimmerActive}
        >
          <div
            ref={shimmerSweepRef}
            className={cn(
              "spirit-launch-shimmer-sweep",
              !shimmerActive && "animate-none opacity-0",
            )}
          />
        </div>
      </div>
      <p
        className={cn(
          "mt-7 text-2xl font-normal tracking-tight text-foreground",
          "transition-opacity duration-200 ease-out",
          titleVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!titleVisible}
      >
        {t("onboarding.welcomeTitle")}
      </p>
      <Button
        type="button"
        onClick={onContinue}
        className={cn(
          "mt-8 min-w-36",
          "transition-opacity duration-200 ease-out",
          continueVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!continueVisible}
        tabIndex={continueVisible ? undefined : -1}
      >
        {t("onboarding.continue")}
      </Button>
    </div>
  );
}

/** Step 2: appearance (theme / translucency / language). The theme is subscribed in place; App does not need to pass it down. */
function OnboardingAppearanceStep({
  settings,
  onSavePatch,
  onBack,
  onContinue,
}: {
  settings: SettingsFormState;
  onSavePatch: (patch: Partial<SettingsFormState>) => Promise<void>;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  return (
    <OnboardingStepShell
      contentLayout="centered"
      title={t("onboarding.appearanceTitle")}
      footer={
        <>
          <Button type="button" variant="outline" className="min-w-28" onClick={onBack}>
            {t("onboarding.back")}
          </Button>
          <Button type="button" className="min-w-28" onClick={onContinue}>
            {t("onboarding.continue")}
          </Button>
        </>
      }
    >
      <OnboardingAppearanceControls
        theme={theme}
        onThemeChange={setTheme}
        settings={settings}
        onSavePatch={onSavePatch}
      />
    </OnboardingStepShell>
  );
}

/** Step 3: connect providers (skippable). */
function OnboardingConnectStep({
  modelsBusy,
  modelsPreviewBusy,
  providerPickerPresets,
  onAddModel,
  onAddProviderModels,
  onPreviewModels,
  onBack,
  onContinue,
  onBottomFadeChange,
  pinnedBottomFade,
  freezeBottomFade = false,
}: {
  modelsBusy: boolean;
  modelsPreviewBusy: boolean;
  providerPickerPresets: readonly DesktopProviderPickerPreset[];
  onAddModel: (request: AddModelRequest) => Promise<void>;
  onAddProviderModels: (request: AddProviderModelsRequest) => Promise<void>;
  onPreviewModels: (request: PreviewModelsRequest) => Promise<PreviewModelsResponse>;
  onBack: () => void;
  onContinue: () => void;
  onBottomFadeChange?: (hasMoreBelow: boolean) => void;
  /** Restores the pre-exit bottom-edge fade visibility on exit remount. */
  pinnedBottomFade?: boolean;
  /** Freezes the bottom-edge fade during the exit animation; scroll listeners must not rewrite it. */
  freezeBottomFade?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <OnboardingStepShell
      title={t("onboarding.connectTitle")}
      footer={
        <>
          <Button type="button" variant="outline" className="min-w-28" onClick={onBack}>
            {t("onboarding.back")}
          </Button>
          <Button type="button" className="min-w-28" onClick={onContinue}>
            {t("onboarding.continue")}
          </Button>
        </>
      }
    >
      <OnboardingConnectControls
        modelsBusy={modelsBusy}
        modelsPreviewBusy={modelsPreviewBusy}
        providerPickerPresets={providerPickerPresets}
        onAddModel={onAddModel}
        onAddProviderModels={onAddProviderModels}
        onPreviewModels={onPreviewModels}
        onBottomFadeChange={onBottomFadeChange}
        pinnedBottomFade={pinnedBottomFade}
        freezeBottomFade={freezeBottomFade}
      />
    </OnboardingStepShell>
  );
}

/** Step 4: Attribution (optional, on by default). */
function OnboardingAttributionStep({
  settings,
  onSavePatch,
  onBack,
  onDone,
}: {
  settings: SettingsFormState;
  onSavePatch: (patch: Partial<SettingsFormState>) => Promise<void>;
  onBack: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <OnboardingStepShell
      contentLayout="centered"
      title={t("onboarding.attributionTitle")}
      footer={
        <>
          <Button type="button" variant="outline" className="min-w-28" onClick={onBack}>
            {t("onboarding.back")}
          </Button>
          <Button type="button" className="min-w-28" onClick={onDone}>
            {t("onboarding.done")}
          </Button>
        </>
      }
    >
      <OnboardingAttributionControls settings={settings} onSavePatch={onSavePatch} />
    </OnboardingStepShell>
  );
}
