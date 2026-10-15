import { normalizeUpstreamModelId } from "./thinking-switch-disabled-models.js";

const MUSE_BASE_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;

export type MuseFamily = "spark" | "wonder";

export interface MuseModelIdentity {
  family: MuseFamily;
  major: number;
  minor: number;
  contributor: boolean;
}

const MUSE_MODEL_ID = /^muse-(spark|wonder)-(\d+)(?:\.(\d+))?/;

/** Bare model id after the provider prefix, e.g. `meta/muse-spark-1.3` → `muse-spark-1.3`. */
export function parseMuseModelId(model: string): MuseModelIdentity | undefined {
  const bare = normalizeUpstreamModelId(model);
  const match = MUSE_MODEL_ID.exec(bare);
  if (!match) {
    return undefined;
  }

  const family = match[1];
  if (family !== "spark" && family !== "wonder") {
    return undefined;
  }

  const major = Number(match[2]);
  const minor = match[3] === undefined ? 0 : Number(match[3]);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    return undefined;
  }

  return {
    family,
    major,
    minor,
    contributor: /(?:^|[-_])contributor(?:$|[-_])/.test(bare),
  };
}

export function isMuseReasoningEffortModel(model: string): boolean {
  return parseMuseModelId(model) !== undefined;
}

function museVersionAtLeast(identity: MuseModelIdentity, major: number, minor: number): boolean {
  return identity.major > major || (identity.major === major && identity.minor >= minor);
}

/**
 * Spark supports max only at 1.3 and later. Contributor builds of those versions
 * still omit max. Earlier Spark versions, including 1.2-contributor, omit max
 * because that generation never had it. Wonder includes max at every parsed version.
 */
export function museSupportsMaxEffort(model: string): boolean {
  const identity = parseMuseModelId(model);
  if (identity === undefined) {
    return false;
  }
  if (identity.family === "wonder") {
    return true;
  }
  if (!museVersionAtLeast(identity, 1, 3)) {
    return false;
  }
  return !identity.contributor;
}

/** Shared Muse efforts. `undefined` when the id is not a Muse model. Does not include `none`. */
export function museSupportedReasoningEfforts(model: string): readonly string[] | undefined {
  if (!isMuseReasoningEffortModel(model)) {
    return undefined;
  }
  if (!museSupportsMaxEffort(model)) {
    return MUSE_BASE_REASONING_EFFORTS;
  }
  return [...MUSE_BASE_REASONING_EFFORTS, "max"];
}
