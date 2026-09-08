import assert from "node:assert/strict";
import { test } from "vitest";

import { formatTitleFromId } from "./id-display-title.js";
import { WELL_KNOWN_CASING_OVERRIDES } from "./well-known-casing.js";

test("well-known casing overrides keep canonical brand casing", () => {
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.ai, "AI");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.aws, "AWS");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.bytedance, "ByteDance");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.cli, "CLI");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.deepseek, "DeepSeek");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.devops, "DevOps");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.glm, "GLM");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.gpt, "GPT");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.mcp, "MCP");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.mimo, "MiMo");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.minimax, "MiniMax");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.nvidia, "NVIDIA");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.openai, "OpenAI");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.oss, "OSS");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.spacexai, "SpaceXAI");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.stepfun, "StepFun");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.tui, "TUI");
});

test("well-known casing overrides cover widely circulated AI-gateway spellings", () => {
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.huggingface, "Hugging Face");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.moonshotai, "Moonshot AI");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES.zai, "Z.ai");
  assert.equal(WELL_KNOWN_CASING_OVERRIDES["z ai"], "Z.ai");
});

test("well-known casing override keys are lowercase single-space-joined tokens", () => {
  for (const key of Object.keys(WELL_KNOWN_CASING_OVERRIDES)) {
    assert.equal(key, key.toLowerCase());
    assert.match(key, /^[a-z0-9]+( [a-z0-9]+)*$/u);
  }
});

test("formatTitleFromId with well-known overrides formats model ids", () => {
  const options = { casingOverrides: WELL_KNOWN_CASING_OVERRIDES };
  assert.equal(formatTitleFromId("openai/gpt-5", options), "OpenAI GPT 5");
  assert.equal(formatTitleFromId("openai/gpt-oss-20b", options), "OpenAI GPT OSS 20b");
  assert.equal(formatTitleFromId("glm-4-6", options), "GLM 4.6");
  assert.equal(formatTitleFromId("minimax-m2", options), "MiniMax M2");
  assert.equal(formatTitleFromId("mimo-vl", options), "MiMo Vl");
  assert.equal(formatTitleFromId("deepseek-v3", options), "DeepSeek V3");
  assert.equal(formatTitleFromId("devops", options), "DevOps");
  assert.equal(formatTitleFromId("aws", options), "AWS");
});

test("formatTitleFromId with well-known overrides formats AI-gateway spellings", () => {
  const options = { casingOverrides: WELL_KNOWN_CASING_OVERRIDES };
  assert.equal(formatTitleFromId("z-ai/glm-4-6", options), "Z.ai GLM 4.6");
  assert.equal(formatTitleFromId("zai/glm-4-6", options), "Z.ai GLM 4.6");
  assert.equal(formatTitleFromId("moonshotai/kimi-k2", options), "Moonshot AI Kimi K2");
  assert.equal(formatTitleFromId("huggingface", options), "Hugging Face");
});
