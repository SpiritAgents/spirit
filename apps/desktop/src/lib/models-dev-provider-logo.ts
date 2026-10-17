const MODELS_DEV_LOGO_ORIGIN = "https://models.dev";

/** Probe timeout for models.dev reachability (logo CDN). */
const MODELS_DEV_PROBE_TIMEOUT_MS = 3_000;

/**
 * Lightweight HEAD target on the same origin/path as provider logos.
 * models.dev is not reliably reachable in mainland China; on probe failure the UI falls back to the local Sparkles icon.
 * https://github.com/SpiritAgents/spirit/issues/252
 */
const MODELS_DEV_PROBE_URL = `${MODELS_DEV_LOGO_ORIGIN}/logos/openai.svg`;

/**
 * Spirit `ModelProviderId` → models.dev provider folder id.
 * models.dev serves a default sparkles SVG for unknown ids instead of a 404.
 */
const MODELS_DEV_LOGO_ID_ALIASES: Partial<Record<string, string>> = {
  "vercel-ai-gateway": "vercel",
  "moonshot-ai": "moonshotai",
  "kimi-code": "moonshotai",
  "z-ai": "zai",
  "zhipu-ai": "zhipuai",
  "google-vertex-ai": "google-vertex",
  "together-ai": "togetherai",
  groq: "groq",
  deepinfra: "deepinfra",
  "hugging-face": "huggingface",
  baseten: "baseten",
};

let modelsDevReachableCache: boolean | null = null;
let modelsDevReachabilityProbe: Promise<boolean> | null = null;

export function modelsDevProviderLogoId(providerId: string): string {
  return MODELS_DEV_LOGO_ID_ALIASES[providerId] ?? providerId;
}

/** models.dev CDN logo URL. */
export function modelsDevProviderLogoUrl(providerId: string): string {
  return `${MODELS_DEV_LOGO_ORIGIN}/logos/${encodeURIComponent(modelsDevProviderLogoId(providerId))}.svg`;
}

/** Cached one-shot probe; resolves false on timeout or network error. */
export function probeModelsDevReachability(): Promise<boolean> {
  if (modelsDevReachableCache !== null) {
    return Promise.resolve(modelsDevReachableCache);
  }
  if (modelsDevReachabilityProbe) {
    return modelsDevReachabilityProbe;
  }

  modelsDevReachabilityProbe = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODELS_DEV_PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(MODELS_DEV_PROBE_URL, {
        method: "HEAD",
        signal: controller.signal,
      });
      modelsDevReachableCache = response.ok;
      return modelsDevReachableCache;
    } catch {
      modelsDevReachableCache = false;
      return false;
    } finally {
      clearTimeout(timeout);
      modelsDevReachabilityProbe = null;
    }
  })();

  return modelsDevReachabilityProbe;
}

/** Test-only: reset cached probe state. */
export function resetModelsDevReachabilityProbeForTests(): void {
  modelsDevReachableCache = null;
  modelsDevReachabilityProbe = null;
}
