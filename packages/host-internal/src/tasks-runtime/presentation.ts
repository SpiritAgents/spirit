import type { ResolvedTaskPresentation } from "../tasks/public.js";

export interface TaskLaunchIntent {
  reveal: "expand" | "none";
  focus: boolean;
}

export interface TaskExitIntent {
  reveal: "expand" | "none";
  closeTab: boolean;
}

export function computeLaunchIntent(presentation: ResolvedTaskPresentation): TaskLaunchIntent {
  if (presentation.focus) {
    return { reveal: "expand", focus: true };
  }
  if (presentation.reveal === "always") {
    return { reveal: "expand", focus: false };
  }
  return { reveal: "none", focus: false };
}

export function computeExitIntent(
  presentation: ResolvedTaskPresentation,
  exitCode: number,
  isBackground: boolean,
): TaskExitIntent {
  // A background task exit is user termination, never a failure to surface.
  const reveal =
    presentation.reveal === "silent" && exitCode !== 0 && !isBackground ? "expand" : "none";
  return { reveal, closeTab: presentation.close };
}
