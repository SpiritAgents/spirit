import { basename } from "node:path";

import { product } from "@spiritagent/product";

import type { GeneratedImageFile, ToolExecutionOutput } from "../ports.js";
import { createLlmMessageContentFromTextAndImages } from "../ports.js";

const MANAGED_GENERATED_ASSET_PROTOCOL = `${product.urlProtocol}:`;
const MANAGED_GENERATED_ASSET_HOST = "generated";

export function normalizeGeneratedImageMarkdownRef(markdownRef: string): string {
  const trimmed = markdownRef.trim();
  if (!trimmed) {
    throw new Error("Host returned an empty generated image markdownRef.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Host returned an invalid generated image markdownRef.");
  }

  if (
    url.protocol.toLowerCase() !== MANAGED_GENERATED_ASSET_PROTOCOL ||
    url.hostname.toLowerCase() !== MANAGED_GENERATED_ASSET_HOST ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error("Host returned an invalid generated image markdownRef.");
  }

  const segments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments.length !== 2 || segments[0]?.toLowerCase() !== "image") {
    throw new Error("Host returned an invalid generated image markdownRef.");
  }

  let imageId: string;
  try {
    imageId = decodeURIComponent(segments[1] ?? "").trim();
  } catch {
    throw new Error("Host returned an invalid generated image markdownRef.");
  }

  if (
    !imageId ||
    imageId !== basename(imageId) ||
    imageId === "." ||
    imageId === ".." ||
    imageId.includes("/") ||
    imageId.includes("\\")
  ) {
    throw new Error("Host returned an invalid generated image markdownRef.");
  }

  return `${product.urlProtocol}://generated/image/${encodeURIComponent(imageId)}`;
}

/** Shared `[generated image]` tool output for URL-returning image backends. */
export function buildGeneratedImageToolOutput(
  saved: GeneratedImageFile,
  model: string,
): ToolExecutionOutput {
  const summaryLines = ["[generated image]"];
  const markdownRef = normalizeGeneratedImageMarkdownRef(saved.markdownRef);
  summaryLines.push(
    `image_ref: ${markdownRef}`,
    `read_file_path: ${markdownRef}`,
    `embed_markdown: ![Generated image](${markdownRef})`,
  );
  summaryLines.push(`mime_type: ${saved.mimeType}`, `model: ${model}`);
  const summaryText = summaryLines.join("\n");

  return {
    content: createLlmMessageContentFromTextAndImages(summaryText, [saved.path]),
    summaryText,
  };
}
