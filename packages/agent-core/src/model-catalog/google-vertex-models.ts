/**
 * Google Vertex AI model catalog: `publishers/google/models` (requires OAuth).
 * Express API Key mode cannot list models; enter the deployment name manually.
 */

import { GoogleAuth } from "google-auth-library";

import type { ProviderListedModelEntry } from "./openai-models.js";
import {
  normalizeVertexLocation,
  normalizeVertexProject,
  vertexPublisherModelsListUrl,
} from "./google-vertex-endpoints.js";

export interface ListVertexModelsOptions {
  project: string;
  location: string;
  apiKey?: string;
  vertexClientEmail?: string;
  vertexPrivateKey?: string;
  signal?: AbortSignal;
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function vertexModelIdFromPublisherName(name: string): string | undefined {
  const trimmed = name.trim();
  const marker = "/models/";
  const index = trimmed.lastIndexOf(marker);
  if (index >= 0) {
    const id = trimmed.slice(index + marker.length).trim();
    return id.length > 0 ? id : undefined;
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

function vertexModelSupportsReasoning(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return normalized.includes("gemini-2.5") || normalized.includes("gemini-3");
}

/** Parses a Vertex `publisherModels` list response. */
export function parseVertexModelEntriesPayload(body: unknown): ProviderListedModelEntry[] {
  if (typeof body !== "object" || body === null) {
    return [];
  }

  const publisherModels = (body as { publisherModels?: unknown }).publisherModels;
  if (!Array.isArray(publisherModels)) {
    return [];
  }

  const entries: ProviderListedModelEntry[] = [];
  for (const entry of publisherModels) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = readOptionalTrimmedString(record.name);
    if (!name) {
      continue;
    }

    const id = vertexModelIdFromPublisherName(name);
    if (!id) {
      continue;
    }

    const displayName = readOptionalTrimmedString(record.displayName);
    const description = readOptionalTrimmedString(record.description);
    const inputLimit =
      typeof record.inputTokenLimit === "number" && record.inputTokenLimit > 0
        ? record.inputTokenLimit
        : undefined;
    const outputLimit =
      typeof record.outputTokenLimit === "number" && record.outputTokenLimit > 0
        ? record.outputTokenLimit
        : undefined;

    entries.push({
      id,
      ...(displayName ? { displayName } : {}),
      ...(description ? { description } : {}),
      ...(inputLimit !== undefined ? { contextLength: inputLimit } : {}),
      ...(outputLimit !== undefined ? { outputLimit } : {}),
      supportsReasoning: vertexModelSupportsReasoning(id),
    });
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

async function resolveVertexAccessToken(options: ListVertexModelsOptions): Promise<string> {
  const clientEmail = options.vertexClientEmail?.trim();
  const privateKey = options.vertexPrivateKey?.trim();
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    ...(clientEmail && privateKey
      ? {
          credentials: {
            client_email: clientEmail,
            private_key: privateKey.replace(/\\n/g, "\n"),
          },
        }
      : {}),
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse?.token?.trim();
  if (!token) {
    throw new Error(
      "Could not obtain a Google Vertex access token. Check ADC or service account credentials.",
    );
  }
  return token;
}

async function fetchVertexModelsPage(
  url: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    ...(signal ? { signal } : {}),
  });

  const text = await response.text();
  let json: unknown = {};
  if (text.trim().length > 0) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new Error(
        `Failed to list models (HTTP ${String(response.status)}): the response is not valid JSON.`,
      );
    }
  }

  if (!response.ok) {
    const errObj =
      typeof json === "object" && json !== null ? (json as Record<string, unknown>) : undefined;
    const error = errObj?.error;
    const errMsg =
      typeof error === "string"
        ? error
        : typeof error === "object" &&
            error !== null &&
            typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : undefined;
    throw new Error(
      errMsg && errMsg.trim().length > 0
        ? `Failed to list models (HTTP ${String(response.status)}): ${errMsg.trim()}`
        : `Failed to list models (HTTP ${String(response.status)}).`,
    );
  }

  return json;
}

export async function listVertexModels(
  options: ListVertexModelsOptions,
): Promise<ProviderListedModelEntry[]> {
  if (options.apiKey?.trim()) {
    throw new Error(
      "Google Vertex Express API Key mode cannot list models automatically; enter the model ID manually.",
    );
  }

  const project = normalizeVertexProject(options.project);
  const location = normalizeVertexLocation(options.location);
  if (!project) {
    throw new Error("Listing Google Vertex models requires a GCP project ID.");
  }
  if (!location) {
    throw new Error("Listing Google Vertex models requires a location (region).");
  }

  const accessToken = await resolveVertexAccessToken(options);
  const allEntries: ProviderListedModelEntry[] = [];
  let pageToken: string | undefined;

  do {
    const url = vertexPublisherModelsListUrl(project, location, pageToken);
    const json = await fetchVertexModelsPage(url, accessToken, options.signal);
    allEntries.push(...parseVertexModelEntriesPayload(json));

    pageToken =
      typeof json === "object" && json !== null && "nextPageToken" in json
        ? readOptionalTrimmedString((json as { nextPageToken?: unknown }).nextPageToken)
        : undefined;
  } while (pageToken);

  const seen = new Set<string>();
  return allEntries.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}
