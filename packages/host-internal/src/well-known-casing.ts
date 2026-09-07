/**
 * Canonical casing for well-known tokens that naive title-casing gets wrong
 * (`gpt` → `GPT`, not `Gpt`). Keys are lowercase tokens — or token sequences
 * joined by a single space for forms that tokenization would otherwise split
 * (`z ai`). Matching is whole-token and case-insensitive, so `gpt4o` is not
 * affected.
 *
 * Injection is opt-in per call site: first-party curated ids (model display
 * titles, marketplace category headers) pass this table to `formatTitleFromId`;
 * third-party extension contribution names (skills, tools, MCP servers) do not,
 * so author-chosen names stay as written.
 */
export const WELL_KNOWN_CASING_OVERRIDES: Readonly<Record<string, string>> = {
  ai: "AI",
  aws: "AWS",
  bytedance: "ByteDance",
  cli: "CLI",
  deepseek: "DeepSeek",
  devops: "DevOps",
  glm: "GLM",
  gpt: "GPT",
  mcp: "MCP",
  mimo: "MiMo",
  minimax: "MiniMax",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  oss: "OSS",
  spacexai: "SpaceXAI",
  stepfun: "StepFun",
  tui: "TUI",
  // AI-gateway compatibility: gateways (Vercel AI Gateway, OpenRouter, …) spell
  // these provider segments in ways that tokenization cannot recover, and the
  // spellings circulate too widely to leave unmapped.
  huggingface: "Hugging Face",
  moonshotai: "Moonshot AI",
  zai: "Z.ai",
  "z ai": "Z.ai",
};
