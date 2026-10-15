import assert from "node:assert/strict";
import { test } from "vitest";

import {
  isMuseReasoningEffortModel,
  museSupportedReasoningEfforts,
  museSupportsMaxEffort,
} from "./muse-reasoning-effort.js";

const BASE_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"];
const EFFORTS_WITH_MAX = [...BASE_EFFORTS, "max"];

test("muse effort metadata follows spark generation, then the contributor overlay", () => {
  for (const model of [
    "muse-spark-1.1",
    "muse-spark-1.2",
    "muse-spark-1.2-contributor",
    "meta/muse-spark-1.2-contributor",
    "muse-spark-1.2-preview",
  ]) {
    assert.equal(museSupportsMaxEffort(model), false, model);
    assert.deepEqual(museSupportedReasoningEfforts(model), BASE_EFFORTS, model);
  }

  for (const model of [
    "muse-spark-1.3",
    "meta/muse-spark-1.3",
    "muse-spark-1.3-preview",
    "muse-spark-1.4",
    "muse-spark-2",
    "muse-spark-2.0",
  ]) {
    assert.equal(museSupportsMaxEffort(model), true, model);
    assert.deepEqual(museSupportedReasoningEfforts(model), EFFORTS_WITH_MAX, model);
  }

  for (const model of [
    "muse-spark-1.3-contributor",
    "meta-ai/muse-spark-1.3-contributor",
    "muse-spark-1.3-contributor-preview",
    "muse-spark-1.4-contributor",
  ]) {
    assert.equal(museSupportsMaxEffort(model), false, model);
    assert.deepEqual(museSupportedReasoningEfforts(model), BASE_EFFORTS, model);
  }
});

test("muse wonder includes max, including later versions, and ignores the spark contributor rule", () => {
  for (const model of [
    "muse-wonder-1.0",
    "meta/muse-wonder-1.0",
    "muse-wonder-1.1",
    "muse-wonder-2",
  ]) {
    assert.equal(isMuseReasoningEffortModel(model), true, model);
    assert.equal(museSupportsMaxEffort(model), true, model);
    assert.deepEqual(museSupportedReasoningEfforts(model), EFFORTS_WITH_MAX, model);
  }

  assert.equal(museSupportsMaxEffort("muse-wonder-1.0-contributor"), true);
  assert.equal(isMuseReasoningEffortModel("meta/llama-4-scout"), false);
  assert.equal(museSupportedReasoningEfforts("gpt-5"), undefined);
});
