import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildModelCatalogDetailMap,
  buildModelCatalogDetailFields,
  buildModelCatalogDisplayTitleMap,
  findModelCatalogEntry,
  modelCatalogDisplayTitle,
  modelCatalogHasDetailBody,
  modelDisplayTitleFromMap,
  modelHasCatalogDetail,
} from "../../src/lib/model-catalog-detail.ts";

test("buildModelCatalogDisplayTitleMap uses catalog displayName for gateway models", () => {
  const hints = [
    {
      provider: "vercel-ai-gateway",
      transportKind: "openai-compatible",
      apiBase: "https://gateway.example/v1",
      modelIds: ["openai/gpt-5"],
      modelCatalog: [{ id: "openai/gpt-5", displayName: "GPT-5" }],
      fetchedAtUnixMs: 1,
    },
  ];
  const models = [
    {
      name: "openai/gpt-5",
      apiBase: "https://gateway.example/v1",
      provider: "vercel-ai-gateway",
      transportKind: "openai-compatible",
      reasoningEffort: "default",
      keyConfigured: true,
    },
  ];

  const titles = buildModelCatalogDisplayTitleMap(models, hints);
  assert.equal(
    titles.get("vercel-ai-gateway::openai-compatible::https://gateway.example/v1::openai/gpt-5"),
    "GPT-5",
  );
  assert.equal(modelDisplayTitleFromMap(models[0], titles), "GPT-5");
  assert.equal(
    modelDisplayTitleFromMap(
      {
        name: "missing",
        apiBase: "https://gateway.example/v1",
        provider: "vercel-ai-gateway",
        transportKind: "openai-compatible",
      },
      titles,
    ),
    "missing",
  );
});

test("modelHasCatalogDetail is true when only displayName is present", () => {
  assert.equal(modelHasCatalogDetail({ id: "x", displayName: "Friendly" }), true);
});

test("modelHasCatalogDetail is true when only video duration pricing is present", () => {
  assert.equal(
    modelHasCatalogDetail({
      id: "alibaba/wan-v2.6-t2v",
      pricing: {
        videoDurationPricing: [{ resolution: "720p", costPerSecondUsd: "0.1" }],
      },
    }),
    true,
  );
});

test("buildModelCatalogDetailFields renders video duration pricing rows", () => {
  const fields = buildModelCatalogDetailFields({
    pricing: {
      videoDurationPricing: [
        { resolution: "720p", costPerSecondUsd: "0.1" },
        { resolution: "1080p", costPerSecondUsd: "0.15" },
      ],
    },
    t: (key, options) => {
      if (key === "settings.modelDetailPricingVideoPerSecond") {
        return `${options.value} / sec`;
      }
      return key;
    },
  });

  assert.deepEqual(fields, [
    { id: "video-duration-0-720p", label: "720p", value: "$0.10 / sec" },
    { id: "video-duration-1-1080p", label: "1080p", value: "$0.15 / sec" },
  ]);
});

test("buildModelCatalogDetailFields renders Together megapixel and example pricing", () => {
  const fields = buildModelCatalogDetailFields({
    pricing: {
      imagePerMegapixelUsd: "0.04",
      imageExamplePricing: { priceUsd: "0.018", description: "720x1280" },
      videoExamplePricing: { priceUsd: "0.924", description: "1080p / 5s" },
    },
    t: (key, options) => {
      if (key === "settings.modelDetailLabelImage") return "Image";
      if (key === "settings.modelDetailLabelVideo") return "Video";
      if (key === "settings.modelDetailPricingImageMegapixel") {
        return `${options.value} / megapixel`;
      }
      if (key === "settings.modelDetailPricingExample") {
        return `${options.value} (${options.description})`;
      }
      return key;
    },
  });

  assert.deepEqual(fields, [
    { id: "image-megapixel", label: "Image", value: "$0.04 / megapixel" },
    { id: "image-example", label: "Image", value: "$0.02 (720x1280)" },
    { id: "video-example", label: "Video", value: "$0.92 (1080p / 5s)" },
  ]);
});

test("buildModelCatalogDetailFields appends audio suffix to video duration pricing labels", () => {
  const fields = buildModelCatalogDetailFields({
    pricing: {
      videoDurationPricing: [
        { resolution: "720p", costPerSecondUsd: "0.2" },
        { resolution: "720p", costPerSecondUsd: "0.4", audio: true },
        { resolution: "4k", costPerSecondUsd: "0.6", audio: true },
      ],
    },
    t: (key, options) => {
      if (key === "settings.modelDetailPricingVideoPerSecond") {
        return `${options.value} / sec`;
      }
      if (key === "settings.modelDetailPricingVideoResolutionWithAudio") {
        return `${options.resolution} (audio)`;
      }
      return key;
    },
  });

  assert.deepEqual(fields, [
    { id: "video-duration-0-720p", label: "720p", value: "$0.20 / sec" },
    { id: "video-duration-1-720p-audio", label: "720p (audio)", value: "$0.40 / sec" },
    { id: "video-duration-2-4k-audio", label: "4k (audio)", value: "$0.60 / sec" },
  ]);
});

test("buildModelCatalogDisplayTitleMap formats non-gateway model ids", () => {
  const models = [
    {
      name: "gpt-4o-mini",
      apiBase: "https://api.openai.com/v1",
      provider: "openai",
      transportKind: "openai-compatible",
      reasoningEffort: "default",
      keyConfigured: true,
    },
  ];

  const titles = buildModelCatalogDisplayTitleMap(models, []);
  assert.equal(
    titles.get("openai::openai-compatible::https://api.openai.com/v1::gpt-4o-mini"),
    "GPT 4o Mini",
  );
});

test("buildModelCatalogDisplayTitleMap scopes titles by provider for shared model ids", () => {
  const hints = [
    {
      provider: "tencent-tokenhub",
      transportKind: "openai-compatible",
      apiBase: "https://tokenhub.tencentmaas.com/v1",
      modelIds: ["deepseek-v4-pro"],
      modelCatalog: [{ id: "deepseek-v4-pro", displayName: "DeepSeek-V4-Pro" }],
      fetchedAtUnixMs: 1,
    },
  ];
  const models = [
    {
      name: "deepseek-v4-pro",
      apiBase: "https://api.deepseek.com/v1",
      provider: "deepseek",
      transportKind: "openai-compatible",
      reasoningEffort: "default",
      keyConfigured: true,
    },
    {
      name: "deepseek-v4-pro",
      apiBase: "https://tokenhub.tencentmaas.com/v1",
      provider: "tencent-tokenhub",
      transportKind: "openai-compatible",
      reasoningEffort: "default",
      keyConfigured: true,
    },
  ];

  const titles = buildModelCatalogDisplayTitleMap(models, hints);
  assert.equal(modelDisplayTitleFromMap(models[0], titles), "DeepSeek V4 Pro");
  assert.equal(modelDisplayTitleFromMap(models[1], titles), "DeepSeek-V4-Pro");
});

test("modelCatalogDisplayTitle keeps raw id for gateway without catalog entry", () => {
  const model = {
    name: "openai/gpt-5",
    apiBase: "https://gateway.example/v1",
    provider: "vercel-ai-gateway",
    transportKind: "openai-compatible",
    reasoningEffort: "default",
    keyConfigured: true,
  };
  assert.equal(modelCatalogDisplayTitle(model, undefined), "openai/gpt-5");
});

test("findModelCatalogEntry returns entry without pricing", () => {
  const hints = [
    {
      provider: "openrouter",
      transportKind: "openai-compatible",
      apiBase: "https://openrouter.ai/api/v1",
      modelIds: ["anthropic/claude-sonnet-4"],
      modelCatalog: [{ id: "anthropic/claude-sonnet-4", displayName: "Claude Sonnet 4" }],
      fetchedAtUnixMs: 1,
    },
  ];
  const model = {
    name: "anthropic/claude-sonnet-4",
    apiBase: "https://openrouter.ai/api/v1",
    provider: "openrouter",
    transportKind: "openai-compatible",
    reasoningEffort: "default",
    keyConfigured: true,
  };
  const entry = findModelCatalogEntry(model, hints);
  assert.equal(entry?.displayName, "Claude Sonnet 4");
  assert.equal(modelCatalogDisplayTitle(model, entry), "Claude Sonnet 4");
});

test("findModelCatalogEntry resolves moonshot-ai catalog with contextLength", () => {
  const hints = [
    {
      provider: "moonshot-ai",
      transportKind: "openai-compatible",
      apiBase: "https://api.moonshot.cn/v1",
      modelIds: ["kimi-k2.5"],
      modelCatalog: [{ id: "kimi-k2.5", displayName: "Kimi K2.5", contextLength: 256000 }],
      fetchedAtUnixMs: 1,
    },
  ];
  const model = {
    name: "kimi-k2.5",
    apiBase: "https://api.moonshot.cn/v1",
    provider: "moonshot-ai",
    transportKind: "openai-compatible",
    reasoningEffort: "default",
    keyConfigured: true,
  };
  const entry = findModelCatalogEntry(model, hints);
  assert.equal(entry?.contextLength, 256000);
});

test("findModelCatalogEntry resolves meituan catalog with pricing", () => {
  const hints = [
    {
      provider: "meituan",
      transportKind: "openai-compatible",
      apiBase: "https://api.longcat.chat/openai/v1",
      modelIds: ["LongCat-2.0"],
      modelCatalog: [
        {
          id: "LongCat-2.0",
          displayName: "LongCat-2.0",
          contextLength: 1048576,
          pricing: {
            inputPerTokenUsd: "0.000002",
            outputPerTokenUsd: "0.000008",
          },
        },
      ],
      fetchedAtUnixMs: 1,
    },
  ];
  const model = {
    name: "LongCat-2.0",
    apiBase: "https://api.longcat.chat/openai/v1",
    provider: "meituan",
    transportKind: "openai-compatible",
    reasoningEffort: "default",
    keyConfigured: true,
  };
  const entry = findModelCatalogEntry(model, hints);
  assert.equal(entry?.displayName, "LongCat-2.0");
  assert.equal(entry?.pricing?.inputPerTokenUsd, "0.000002");
  assert.equal(entry?.pricing?.outputPerTokenUsd, "0.000008");

  const detailMap = buildModelCatalogDetailMap([model], hints);
  assert.equal(
    detailMap.get("meituan::openai-compatible::https://api.longcat.chat/openai/v1::LongCat-2.0")
      ?.pricing?.inputPerTokenUsd,
    "0.000002",
  );
  const fields = buildModelCatalogDetailFields({
    contextLength: entry?.contextLength,
    pricing: entry?.pricing,
    t: (key) => key,
  });
  assert.ok(fields.some((field) => field.id === "input"));
  assert.ok(fields.some((field) => field.id === "output"));
});

test("modelCatalogHasDetailBody is false when only displayName is present", () => {
  const model = {
    name: "minimax/M2.7",
    apiBase: "https://example/v1",
    provider: "openrouter",
    transportKind: "openai-compatible",
    reasoningEffort: "default",
    keyConfigured: true,
  };
  assert.equal(
    modelCatalogHasDetailBody({
      model,
      catalogEntry: { id: "minimax/M2.7", displayName: "MiniMax M2.7" },
    }),
    false,
  );
});

test("modelCatalogHasDetailBody is true when description or pricing exists", () => {
  const model = {
    name: "openai/gpt-5",
    apiBase: "https://example/v1",
    provider: "openrouter",
    transportKind: "openai-compatible",
    reasoningEffort: "default",
    keyConfigured: true,
  };
  assert.equal(
    modelCatalogHasDetailBody({
      model,
      catalogEntry: { id: "openai/gpt-5", description: "Flagship model" },
    }),
    true,
  );
  assert.equal(
    modelCatalogHasDetailBody({
      model,
      catalogEntry: {
        id: "openai/gpt-5",
        pricing: { inputPerTokenUsd: "0.000003" },
      },
    }),
    true,
  );
});
