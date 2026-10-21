import type { JsonValue } from "../ports.js";
import type { EvalCriterionScore, EvalReviewOutcome } from "./types.js";

import { assertEvalScenario } from "./validation.js";

export interface EvalRunArtifactCandidate {
  id: string;
  label: string;
  sourceRef: string;
  diffFingerprint?: string;
  patchFingerprint?: string;
  modelConfigFingerprint: string;
  systemPromptFingerprint: string;
  toolSchemaFingerprint: string;
  workspaceIsolationId: string;
  outputText: string;
  artifactPaths: string[];
  traceSummary: {
    toolCallCount: number;
    approvalRequestCount: number;
    backgroundToolCount: number;
    compactionCount: number;
    streamingEventCount: number;
    warnings: string[];
  };
  metadata?: Record<string, JsonValue>;
}

export interface EvalRunArtifactComparison {
  mode: "staged" | "git-ref";
  baselineRef: string;
  candidateRef?: string;
  diffFingerprint: string;
}

export interface EvalJudgeBlindVariantMapping {
  variantA: "baseline" | "candidate";
  variantB: "baseline" | "candidate";
}

export interface EvalJudgeReview {
  status: "completed" | "failed";
  judgedAt: string;
  reviewerKind: "llm";
  model: string;
  promptFingerprint?: string;
  blindVariantMapping: EvalJudgeBlindVariantMapping;
  artifactPaths?: string[];
  outcome?: EvalReviewOutcome;
  confidence?: number;
  rationale?: string;
  criterionScores?: EvalCriterionScore[];
  notes?: string;
  error?: string;
}

export interface EvalRunArtifactV1 {
  schemaVersion: 1;
  runId: string;
  createdAtUnixMs: number;
  scenario: unknown;
  baselineRef: string;
  stagedDiffFingerprint: string;
  workspaceSource?: string;
  candidates: EvalRunArtifactCandidate[];
  humanReview: {
    status: "pending-human-review" | "completed";
    [key: string]: JsonValue;
  };
  judgeReview?: EvalJudgeReview;
}

export interface EvalRunArtifactV2 {
  schemaVersion: 2;
  runId: string;
  createdAtUnixMs: number;
  scenario: unknown;
  comparison: EvalRunArtifactComparison;
  workspaceSource?: string;
  candidates: EvalRunArtifactCandidate[];
  humanReview: {
    status: "pending-human-review" | "completed";
    [key: string]: JsonValue;
  };
  judgeReview?: EvalJudgeReview;
}

export type EvalRunArtifact = EvalRunArtifactV1 | EvalRunArtifactV2;

export function validateEvalRunArtifact(value: unknown): asserts value is EvalRunArtifact {
  if (!isRecord(value)) {
    throw new Error("Eval run artifact must be an object.");
  }

  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    throw new Error("Eval run artifact schemaVersion must be 1 or 2.");
  }

  requireNonEmptyString(value, "runId");

  if (value.schemaVersion === 1) {
    requireNonEmptyString(value, "baselineRef");
    requireNonEmptyString(value, "stagedDiffFingerprint");
  } else {
    validateComparison(value.comparison);
  }

  if (typeof value.createdAtUnixMs !== "number" || !Number.isFinite(value.createdAtUnixMs)) {
    throw new Error("Eval run artifact createdAtUnixMs must be a finite number.");
  }

  assertEvalScenario(value.scenario);

  if (!Array.isArray(value.candidates) || value.candidates.length !== 2) {
    throw new Error(
      "Eval run artifact candidates must contain exactly baseline and candidate records.",
    );
  }

  for (const candidate of value.candidates) {
    validateCandidate(candidate);
  }

  if (!isRecord(value.humanReview) || typeof value.humanReview.status !== "string") {
    throw new Error("Eval run artifact humanReview.status is required.");
  }

  if (value.judgeReview !== undefined) {
    validateJudgeReview(value.judgeReview);
  }
}

function validateComparison(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("Eval run artifact comparison must be an object.");
  }

  if (value.mode !== "staged" && value.mode !== "git-ref") {
    throw new Error("Eval run artifact comparison.mode must be staged or git-ref.");
  }

  requireNonEmptyString(value, "baselineRef");
  requireNonEmptyString(value, "diffFingerprint");

  if (value.mode === "git-ref") {
    requireNonEmptyString(value, "candidateRef");
  }
}

function validateCandidate(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("Eval run candidate must be an object.");
  }

  for (const field of [
    "id",
    "label",
    "sourceRef",
    "modelConfigFingerprint",
    "systemPromptFingerprint",
    "toolSchemaFingerprint",
    "workspaceIsolationId",
    "outputText",
  ]) {
    requireNonEmptyString(value, field);
  }

  if (
    !Array.isArray(value.artifactPaths) ||
    value.artifactPaths.length === 0 ||
    value.artifactPaths.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new Error(
      `Eval run candidate ${String(value.id)} artifactPaths must be a non-empty string array.`,
    );
  }

  if (!isRecord(value.traceSummary)) {
    throw new Error(`Eval run candidate ${String(value.id)} traceSummary is required.`);
  }

  for (const field of [
    "toolCallCount",
    "approvalRequestCount",
    "backgroundToolCount",
    "compactionCount",
    "streamingEventCount",
  ]) {
    if (
      typeof value.traceSummary[field] !== "number" ||
      !Number.isFinite(value.traceSummary[field])
    ) {
      throw new Error(
        `Eval run candidate ${String(value.id)} traceSummary.${field} must be a number.`,
      );
    }
  }

  if (!Array.isArray(value.traceSummary.warnings)) {
    throw new Error(
      `Eval run candidate ${String(value.id)} traceSummary.warnings must be an array.`,
    );
  }
}

function validateJudgeReview(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("Eval run artifact judgeReview must be an object.");
  }

  if (value.status !== "completed" && value.status !== "failed") {
    throw new Error("Eval run artifact judgeReview.status must be completed or failed.");
  }

  requireNonEmptyString(value, "judgedAt");
  requireNonEmptyString(value, "reviewerKind");
  requireNonEmptyString(value, "model");

  if (value.reviewerKind !== "llm") {
    throw new Error("Eval run artifact judgeReview.reviewerKind must be llm.");
  }

  validateBlindVariantMapping(value.blindVariantMapping);

  if (
    value.artifactPaths !== undefined &&
    (!Array.isArray(value.artifactPaths) ||
      value.artifactPaths.some((entry) => typeof entry !== "string" || !entry.trim()))
  ) {
    throw new Error(
      "Eval run artifact judgeReview.artifactPaths must be a string array when present.",
    );
  }

  if (value.status === "completed") {
    requireNonEmptyString(value, "outcome");
    requireNonEmptyString(value, "rationale");
    if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence)) {
      throw new Error("Eval run artifact judgeReview.confidence must be a finite number.");
    }
    if (value.confidence < 0 || value.confidence > 1) {
      throw new Error("Eval run artifact judgeReview.confidence must be between 0 and 1.");
    }
    if (
      value.outcome !== "baseline" &&
      value.outcome !== "candidate" &&
      value.outcome !== "tie" &&
      value.outcome !== "inconclusive"
    ) {
      throw new Error(
        "Eval run artifact judgeReview.outcome must be baseline, candidate, tie, or inconclusive.",
      );
    }
    if (!Array.isArray(value.criterionScores)) {
      throw new Error("Eval run artifact judgeReview.criterionScores must be an array.");
    }

    for (const score of value.criterionScores) {
      validateCriterionScore(score);
    }
  }

  if (value.status === "failed") {
    requireNonEmptyString(value, "error");
  }
}

function validateBlindVariantMapping(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("Eval run artifact judgeReview.blindVariantMapping must be an object.");
  }

  if (
    (value.variantA !== "baseline" && value.variantA !== "candidate") ||
    (value.variantB !== "baseline" && value.variantB !== "candidate")
  ) {
    throw new Error(
      "Eval run artifact judgeReview.blindVariantMapping must map variantA and variantB to baseline/candidate.",
    );
  }

  if (value.variantA === value.variantB) {
    throw new Error(
      "Eval run artifact judgeReview.blindVariantMapping must map A and B to different variants.",
    );
  }
}

function validateCriterionScore(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("Eval run artifact judgeReview criterion score must be an object.");
  }

  requireNonEmptyString(value, "criterionId");

  if (
    value.baselineScore !== undefined &&
    (typeof value.baselineScore !== "number" || !Number.isFinite(value.baselineScore))
  ) {
    throw new Error(
      "Eval run artifact judgeReview baselineScore must be a finite number when present.",
    );
  }

  if (
    value.candidateScore !== undefined &&
    (typeof value.candidateScore !== "number" || !Number.isFinite(value.candidateScore))
  ) {
    throw new Error(
      "Eval run artifact judgeReview candidateScore must be a finite number when present.",
    );
  }

  if (value.notes !== undefined && typeof value.notes !== "string") {
    throw new Error(
      "Eval run artifact judgeReview criterion score notes must be a string when present.",
    );
  }
}

function requireNonEmptyString(value: Record<string, unknown>, field: string): void {
  if (typeof value[field] !== "string" || !value[field].trim()) {
    throw new Error(`Eval run artifact ${field} must be a non-empty string.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
