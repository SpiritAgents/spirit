import { isSpiritBranchName, isSpiritWorktreeName } from "./git-workspace.js";

export * from "./generate-worktree-names.js";

export interface GeneratedWorktreeNames {
  worktreeName: string;
  branchName: string;
}

export function buildWorktreeNamingPrompt(input: {
  userPrompt: string;
  baseBranch: string;
  repoRoot: string;
}): string {
  return [
    "Generate Git worktree and branch names for the user task below.",
    'Return JSON only: {"worktreeName":"...","branchName":"..."}. No Markdown, no explanations, no extra keys.',
    "Naming rules:",
    '- worktreeName must use kebab-case segments and start with "spirit-", e.g. spirit-add-worktree-ui',
    '- branchName must start with "spirit/" and use kebab-case segments after the slash, e.g. spirit/add-worktree-ui',
    "- Both names should summarize the user task in short English tokens.",
    "",
    `repository: ${input.repoRoot}`,
    `baseBranch: ${input.baseBranch}`,
    "",
    "[user task]",
    input.userPrompt.trim() || "(empty)",
  ].join("\n");
}

export function normalizeGeneratedWorktreeNames(value: {
  worktreeName?: unknown;
  branchName?: unknown;
}): GeneratedWorktreeNames {
  if (typeof value.worktreeName !== "string" || typeof value.branchName !== "string") {
    throw new Error("Worktree naming response is missing worktreeName or branchName.");
  }

  const worktreeName = value.worktreeName.trim();
  const branchName = value.branchName.trim();
  if (!worktreeName || !branchName) {
    throw new Error("Worktree naming response contains empty worktreeName or branchName.");
  }
  if (!isSpiritWorktreeName(worktreeName)) {
    throw new Error(`Invalid worktreeName format: ${worktreeName}`);
  }
  if (!isSpiritBranchName(branchName)) {
    throw new Error(`Invalid branchName format: ${branchName}`);
  }

  return { worktreeName, branchName };
}

export function parseGeneratedWorktreeNamingResponse(rawText: string): GeneratedWorktreeNames {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Worktree naming returned no assistant text.");
  }

  const candidate = extractJsonObjectText(trimmed);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error("Worktree naming response is not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Worktree naming response must be a JSON object.");
  }

  return normalizeGeneratedWorktreeNames(
    parsed as { worktreeName?: unknown; branchName?: unknown },
  );
}

function extractJsonObjectText(text: string): string {
  if (text.startsWith("```")) {
    const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch?.[1]) {
      return fenceMatch[1].trim();
    }
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text;
}
