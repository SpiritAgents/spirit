/** Gemini API (AI Studio) default base for @ai-sdk/google. */
export const GOOGLE_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Gemini API native REST root (model catalog, etc.). */
export const GOOGLE_GEMINI_NATIVE_API_ROOT = GOOGLE_GEMINI_API_BASE;

// Local machines/CI usually cannot reach generativelanguage.googleapis.com directly; verify the connection wizard manually in an environment with network access.

const GOOGLE_GEMINI_HOST = "generativelanguage.googleapis.com";

function trimTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** Whether the endpoint is the Gemini API (generativelanguage.googleapis.com). */
export function isGoogleGeminiGenerativeLanguageApiBase(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    return false;
  }
  try {
    const url = new URL(trimTrailingSlashes(trimmed));
    return url.protocol === "https:" && url.hostname === GOOGLE_GEMINI_HOST;
  } catch {
    return false;
  }
}

/** @throws Throws when the host is not the Gemini API. */
export function assertGoogleGeminiApiBase(baseUrl: string): void {
  if (!isGoogleGeminiGenerativeLanguageApiBase(baseUrl)) {
    throw new Error(
      "The Google provider endpoint must be generativelanguage.googleapis.com (Gemini API).",
    );
  }
}

function resolveGoogleNativeApiRoot(apiBase: string): string {
  assertGoogleGeminiApiBase(apiBase);
  const normalized = trimTrailingSlashes(apiBase);
  if (normalized.endsWith("/v1beta")) {
    return normalized;
  }
  return GOOGLE_GEMINI_NATIVE_API_ROOT;
}

/** Derives the native `GET /v1beta/models` URL from apiBase. */
export function googleNativeModelsListUrl(apiBase: string, pageToken?: string): string {
  const root = resolveGoogleNativeApiRoot(apiBase);
  const url = new URL(`${root}/models`);
  url.searchParams.set("pageSize", "1000");
  if (pageToken && pageToken.trim().length > 0) {
    url.searchParams.set("pageToken", pageToken.trim());
  }
  return url.toString();
}
