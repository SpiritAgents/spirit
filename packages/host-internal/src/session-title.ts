import {
  USE_SAME_LANGUAGE_AS_USER_MESSAGE_RULE,
  buildSpiritCoreHostPrompt,
  createJsonSchemaTransport,
  isBedrockTransportConfig,
  type JsonObject,
  type LlmTransportConfig,
} from "@spiritagent/agent-core";

import { findModelByRef, type ModelRef, type ProviderGroupV2 } from "./config-v2.js";
import type { SpiritConfigFile, SpiritModelCapability } from "./credentials/types.js";
import { loadSpiritConfig } from "./credentials/index.js";
import { resolveTransportConfig } from "./resolve-transport.js";

export const SESSION_TITLE_MAX_LENGTH = 40;
export const SESSION_TITLE_FALLBACK_SEED = "New conversation";
export const SECONDARY_LANGUAGE_MODEL_FALLBACK_PATTERNS = ["deepseek-v4-flash"] as const;

export const SESSION_TITLE_JSON_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: {
      type: "string",
      minLength: 1,
      maxLength: SESSION_TITLE_MAX_LENGTH,
    },
  },
  required: ["title"],
};

export type SessionTitleModelConfig = Pick<
  SpiritConfigFile,
  "activeModel" | "secondaryLanguageModel" | "providerGroups"
>;

export function buildSessionTitlePrompt(
  firstUserMessage: string,
  options?: { hasMedia?: boolean },
): string {
  const hasMedia = options?.hasMedia === true;
  const trimmed = firstUserMessage.trim();
  const message =
    trimmed ||
    (hasMedia
      ? "The user sent media attachments with no text. Generate a title from what you see in the attached images or videos."
      : "(empty)");
  return (
    [
      "Generate a short conversation title for the user message below.",
      'Return JSON only: {"title":"..."}. No Markdown, no explanations, no extra keys.',
      "Rules:",
      `- ${USE_SAME_LANGUAGE_AS_USER_MESSAGE_RULE}`,
      "- Keep it concise (ideally under 12 words).",
      "- No surrounding quotes, hashtags, or trailing punctuation.",
      ...(hasMedia
        ? ["- If images or videos are attached, use what you see in them as primary context."]
        : []),
    ].join("\n") +
    "\n\n[user message]\n" +
    message
  );
}

export function normalizeGeneratedSessionTitle(raw: string, fallback: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) {
    return fallback;
  }

  const withoutQuotes = collapsed.replace(/^["'「『]+|["'」』]+$/g, "").trim();
  if (!withoutQuotes) {
    return fallback;
  }

  if (withoutQuotes.length <= SESSION_TITLE_MAX_LENGTH) {
    return withoutQuotes;
  }

  return `${withoutQuotes.slice(0, SESSION_TITLE_MAX_LENGTH)}…`;
}

export function deriveSessionTitleFallbackSeed(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return SESSION_TITLE_FALLBACK_SEED;
  }
  return trimmed.length > 28 ? `${trimmed.slice(0, 28)}…` : trimmed;
}

export function modelSupportsLanguageModel(model: {
  capabilities?: readonly SpiritModelCapability[];
}): boolean {
  return model.capabilities === undefined || model.capabilities.includes("languageModel");
}

export function normalizeSecondaryLanguageModel(
  value: ModelRef | undefined,
  config: Pick<SessionTitleModelConfig, "providerGroups">,
): ModelRef | undefined {
  const resolved = findModelByRef(config.providerGroups, value);
  return resolved && modelSupportsLanguageModel(resolved.model) ? value : undefined;
}

export function resolveSecondaryLanguageModelRef(config: SessionTitleModelConfig): ModelRef {
  const explicit = normalizeSecondaryLanguageModel(config.secondaryLanguageModel, config);
  if (explicit) {
    return explicit;
  }

  for (const pattern of SECONDARY_LANGUAGE_MODEL_FALLBACK_PATTERNS) {
    const lowerPattern = pattern.toLowerCase();
    for (const group of config.providerGroups) {
      for (const model of group.models) {
        if (modelSupportsLanguageModel(model) && model.name.toLowerCase().includes(lowerPattern)) {
          return { groupId: group.id, name: model.name };
        }
      }
    }
  }

  return config.activeModel;
}

export function resolveSessionTitleModelRef(
  config: SessionTitleModelConfig,
  options?: { needsImage?: boolean; needsVideo?: boolean },
): ModelRef {
  const secondary = resolveSecondaryLanguageModelRef(config);
  const needsImage = options?.needsImage === true;
  const needsVideo = options?.needsVideo === true;
  if (!needsImage && !needsVideo) {
    return secondary;
  }

  if (modelRefSupportsMedia(config.providerGroups, secondary, needsImage, needsVideo)) {
    return secondary;
  }
  if (modelRefSupportsMedia(config.providerGroups, config.activeModel, needsImage, needsVideo)) {
    return config.activeModel;
  }
  return secondary;
}

export async function completeSessionTitle(input: {
  transportConfig: LlmTransportConfig;
  userText: string;
  imagePaths?: readonly string[];
  videoPaths?: readonly string[];
  fallbackSeedTitle: string;
}): Promise<{ title: string; modelName: string }> {
  const imagePaths = [...(input.imagePaths ?? [])];
  const videoPaths = [...(input.videoPaths ?? [])];
  const hasMedia = imagePaths.length > 0 || videoPaths.length > 0;
  const transport = createJsonSchemaTransport(input.transportConfig);
  const result = await transport.createJsonSchemaCompletion<{ title: string }>(
    input.transportConfig,
    {
      userPrompt: buildSessionTitlePrompt(input.userText, { hasMedia }),
      schemaName: "session_title",
      schema: SESSION_TITLE_JSON_SCHEMA,
      includeToolAgentHostPrompt: false,
      systemSections: [
        buildSpiritCoreHostPrompt(
          input.transportConfig.model,
          providerIdForTransportConfig(input.transportConfig),
        ),
      ],
      ...(imagePaths.length > 0 ? { imagePaths } : {}),
      ...(videoPaths.length > 0 ? { videoPaths } : {}),
    },
  );

  return {
    title: normalizeGeneratedSessionTitle(result.output.title, input.fallbackSeedTitle),
    modelName: input.transportConfig.model,
  };
}

export async function generateSessionTitleForTurn(input: {
  spiritDataDir: string;
  workspaceRoot: string;
  userText: string;
  imagePaths?: readonly string[];
  videoPaths?: readonly string[];
  fallbackSeedTitle: string;
}): Promise<{ title: string; modelName: string }> {
  const config = loadSpiritConfig(input.spiritDataDir);
  if (!config) {
    throw new Error(`${product.name} config is not available.`);
  }

  const imagePaths = input.imagePaths ?? [];
  const videoPaths = input.videoPaths ?? [];
  const modelRef = resolveSessionTitleModelRef(config, {
    needsImage: imagePaths.length > 0,
    needsVideo: videoPaths.length > 0,
  });
  const transportConfig = resolveTransportConfig({
    workspaceRoot: input.workspaceRoot,
    spiritDataDir: input.spiritDataDir,
    modelRef,
  });

  return completeSessionTitle({
    transportConfig,
    userText: input.userText,
    imagePaths,
    videoPaths,
    fallbackSeedTitle: input.fallbackSeedTitle,
  });
}

function modelRefSupportsMedia(
  groups: readonly ProviderGroupV2[],
  ref: ModelRef | undefined,
  needsImage: boolean,
  needsVideo: boolean,
): boolean {
  const resolved = findModelByRef(groups, ref);
  if (!resolved || !modelSupportsLanguageModel(resolved.model)) {
    return false;
  }
  const capabilities = resolved.model.capabilities ?? [];
  if (needsImage && !capabilities.includes("image")) {
    return false;
  }
  if (needsVideo && !capabilities.includes("video")) {
    return false;
  }
  return true;
}

function providerIdForTransportConfig(config: LlmTransportConfig): string | undefined {
  if (isBedrockTransportConfig(config)) {
    return "bedrock";
  }
  return config.llmVendor;
}
import { product } from "@spiritagent/product";
