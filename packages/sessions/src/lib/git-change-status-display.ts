/** Compact SCM status label for porcelain `code` (raw value stays in data). */
export function formatGitChangeStatusLabel(code: string): string {
  if (code === "??") {
    return "U";
  }
  const trimmed = code.trim();
  return trimmed || "·";
}

export function gitChangeStatusTitle(code: string): string {
  if (code === "??") {
    return "Untracked";
  }
  return code;
}

export function gitChangeStatusClassName(code: string): string {
  if (code === "??") {
    return "text-blue-600 dark:text-blue-400";
  }
  if (code.includes("D")) {
    return "text-destructive";
  }
  if (code.includes("A")) {
    return "text-emerald-600 dark:text-emerald-400";
  }
  return "text-amber-600 dark:text-amber-400";
}
