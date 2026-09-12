import { getLlmFetch } from "../llm-fetch.js";
import { resolveStepfunV1Url } from "./stepfun-api-hosts.js";

export const STEPFUN_SEARCH_URL = resolveStepfunV1Url(undefined, "/search");

type StepfunSearchResult = {
  url?: string;
  position?: number;
  title?: string;
  time?: string;
  snippet?: string;
  content?: string;
};

type StepfunSearchResponse = {
  results?: StepfunSearchResult[];
};

export type StepfunSearchInvokeResult =
  | { kind: "succeeded"; content: string }
  | { kind: "failed"; error: string };

export function formatStepfunSearchResults(results: readonly StepfunSearchResult[]): string {
  if (results.length === 0) {
    return "No search results.";
  }

  return results
    .map((result, index) => {
      const lines = [`## ${index + 1}. ${result.title?.trim() || "Untitled"}`];
      if (result.url?.trim()) {
        lines.push(`URL: ${result.url.trim()}`);
      }
      if (result.time?.trim()) {
        lines.push(`Time: ${result.time.trim()}`);
      }
      if (result.snippet?.trim()) {
        lines.push(`Snippet: ${result.snippet.trim()}`);
      }
      if (result.content?.trim()) {
        lines.push(`Content: ${result.content.trim()}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

export async function invokeStepfunSearch(
  apiKey: string,
  body: { query: string; n?: number },
  fetchImpl: typeof fetch = getLlmFetch(),
  baseUrl?: string,
): Promise<StepfunSearchInvokeResult> {
  const query = body.query.trim();
  if (!query) {
    return { kind: "failed", error: "web_search requires a non-empty query." };
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { kind: "failed", error: "StepFun search requires an API key." };
  }

  const payload: { query: string; n?: number } = { query };
  if (body.n !== undefined && Number.isFinite(body.n)) {
    const n = Math.trunc(body.n);
    if (n >= 1 && n <= 20) {
      payload.n = n;
    }
  }

  try {
    const response = await fetchImpl(resolveStepfunV1Url(baseUrl, "/search"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const suffix = text.trim() ? `: ${text.trim()}` : "";
      return {
        kind: "failed",
        error: `StepFun search failed (${response.status})${suffix}`,
      };
    }

    const json = (await response.json()) as StepfunSearchResponse;
    return {
      kind: "succeeded",
      content: formatStepfunSearchResults(Array.isArray(json.results) ? json.results : []),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "failed", error: message };
  }
}
