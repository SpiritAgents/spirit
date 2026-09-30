import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import fg from "fast-glob";

import {
  cachedIgnoreMatchersForRelativeDir,
  shouldIgnoreWorkspacePath,
} from "./workspace-ignore.js";

const execFileAsync = promisify(execFile);
const GIT_LS_FILES_MAX_BUFFER = 64 * 1024 * 1024;
import {
  computeWorkspaceFileReferenceSuggestions,
  currentWorkspaceFileReferenceQuery,
  referencedWorkspaceFilePathsFromInput,
  type WorkspaceFileReferenceSuggestionsResult,
} from "./workspace-file-reference-query.js";
import { CONTEXT_INJECTION_MAX_BYTES, decodeUtf8, sliceUtf8Head } from "@spiritagent/agent-core";
import { detectSupportedImageFile, hasSupportedImageExtension } from "./image-file-support.js";
import { detectSupportedVideoFile, hasSupportedVideoExtension } from "./video-file-support.js";

const DEFAULT_IGNORED_DIRECTORY_NAMES = new Set([".git", "target", "node_modules", "bin", "obj"]);

interface WorkspaceFileIndexCacheEntry {
  promise: Promise<string[]>;
  files?: string[];
}

const workspaceFileIndexCache = new Map<string, WorkspaceFileIndexCacheEntry>();

export interface WorkspaceFileReferenceTextAttachment {
  kind: "text";
  path: string;
  totalBytes: number;
  truncated: boolean;
  attachedAtUnixMs: number;
  content: string;
}

export interface WorkspaceFileReferenceImageAttachment {
  kind: "image";
  path: string;
  attachedAtUnixMs: number;
}

export interface WorkspaceFileReferenceVideoAttachment {
  kind: "video";
  path: string;
  attachedAtUnixMs: number;
}

export type WorkspaceFileReferenceAttachment =
  | WorkspaceFileReferenceTextAttachment
  | WorkspaceFileReferenceImageAttachment
  | WorkspaceFileReferenceVideoAttachment;

export interface ResolveWorkspaceFileReferenceAttachmentsOptions {
  maxContentBytes?: number;
}

export interface WorkspaceFileReferenceIndexSnapshot {
  ready: boolean;
  files: string[];
}

export async function listWorkspaceFileReferenceSuggestions(
  workspaceRoot: string,
  input: string,
  cursorChars: number,
): Promise<WorkspaceFileReferenceSuggestionsResult | undefined> {
  const query = currentWorkspaceFileReferenceQuery(input, cursorChars);
  if (!query) {
    return undefined;
  }

  const files = await collectWorkspaceFileReferenceIndex(workspaceRoot);
  return {
    query,
    suggestions: computeWorkspaceFileReferenceSuggestions(query.raw, files),
    indexReady: true,
  };
}

export async function listCachedWorkspaceFileReferenceSuggestions(
  workspaceRoot: string,
  input: string,
  cursorChars: number,
): Promise<WorkspaceFileReferenceSuggestionsResult | undefined> {
  const query = currentWorkspaceFileReferenceQuery(input, cursorChars);
  if (!query) {
    return undefined;
  }

  const files = await cachedWorkspaceFileReferenceIndex(workspaceRoot);
  if (!files) {
    void primeWorkspaceFileReferenceIndexCache(workspaceRoot).catch(() => undefined);
    return {
      query,
      suggestions: [],
      indexReady: false,
    };
  }

  return {
    query,
    suggestions: computeWorkspaceFileReferenceSuggestions(query.raw, files),
    indexReady: true,
  };
}

export async function collectWorkspaceFileReferenceIndex(workspaceRoot: string): Promise<string[]> {
  const root = await canonicalWorkspaceRoot(workspaceRoot);
  const entry = ensureWorkspaceFileReferenceIndexCacheEntry(root);
  return [...(await entry.promise)];
}

export async function primeWorkspaceFileReferenceIndexCache(workspaceRoot: string): Promise<void> {
  const root = await canonicalWorkspaceRoot(workspaceRoot);
  const entry = ensureWorkspaceFileReferenceIndexCacheEntry(root);
  entry.promise.catch(() => undefined);
}

export async function getWorkspaceFileReferenceIndexSnapshot(
  workspaceRoot: string,
): Promise<WorkspaceFileReferenceIndexSnapshot> {
  const root = await canonicalWorkspaceRoot(workspaceRoot);
  const entry = workspaceFileIndexCache.get(root);
  if (!entry?.files) {
    return { ready: false, files: [] };
  }

  return {
    ready: true,
    files: [...entry.files],
  };
}

export async function clearWorkspaceFileReferenceIndexCache(workspaceRoot?: string): Promise<void> {
  if (!workspaceRoot) {
    workspaceFileIndexCache.clear();
    return;
  }

  const resolved = resolve(workspaceRoot);
  workspaceFileIndexCache.delete(resolved);
  try {
    workspaceFileIndexCache.delete(await realpath(resolved));
  } catch {
    // Consistent with canonicalWorkspaceRoot: when the path does not exist, resolved is the cache key.
  }
}

async function cachedWorkspaceFileReferenceIndex(
  workspaceRoot: string,
): Promise<string[] | undefined> {
  const root = await canonicalWorkspaceRoot(workspaceRoot);
  const entry = workspaceFileIndexCache.get(root);
  return entry?.files ? [...entry.files] : undefined;
}

function ensureWorkspaceFileReferenceIndexCacheEntry(root: string): WorkspaceFileIndexCacheEntry {
  const cached = workspaceFileIndexCache.get(root);
  if (cached) {
    return cached;
  }

  const entry: WorkspaceFileIndexCacheEntry = {
    promise: Promise.resolve([]),
  };
  const pending = collectWorkspaceFileReferenceIndexUncached(root)
    .then((files) => {
      files.sort((left, right) => left.localeCompare(right));
      entry.files = files;
      return files;
    })
    .catch((error) => {
      workspaceFileIndexCache.delete(root);
      throw error;
    });
  entry.promise = pending;
  workspaceFileIndexCache.set(root, entry);
  return entry;
}

export async function resolveWorkspaceFileReferenceAttachmentsFromInput(
  workspaceRoot: string,
  text: string,
  options: ResolveWorkspaceFileReferenceAttachmentsOptions = {},
): Promise<WorkspaceFileReferenceAttachment[]> {
  const attachments: WorkspaceFileReferenceAttachment[] = [];

  for (const referencePath of referencedWorkspaceFilePathsFromInput(text)) {
    try {
      attachments.push(
        await workspaceFileReferenceAttachmentFromPath(workspaceRoot, referencePath, options),
      );
    } catch {
      // Consistent with existing agent-core / CLI behavior: ignore references that do not exist, are unreadable, or are unsupported.
    }
  }

  return attachments;
}

export async function workspaceFileReferenceAttachmentFromPath(
  workspaceRoot: string,
  referencePath: string,
  options: ResolveWorkspaceFileReferenceAttachmentsOptions = {},
): Promise<WorkspaceFileReferenceAttachment> {
  const { absolutePath, relativePath } = await resolveWorkspaceFileReferencePath(
    workspaceRoot,
    referencePath,
  );
  return localFileAttachmentFromAbsolutePath(absolutePath, relativePath, options);
}

import type { LocalFileComposerRoute } from "./local-file-composer-route.js";

export type { LocalFileComposerRoute } from "./local-file-composer-route.js";

export async function classifyLocalFileComposerRoute(
  absolutePath: string,
): Promise<LocalFileComposerRoute> {
  try {
    const attachment = await localFileAttachmentFromPath(absolutePath);
    return attachment.kind === "image" || attachment.kind === "video" ? "media" : "reference";
  } catch {
    // Binary/validation failures are treated the same as @ references: the UI still shows the chip and silently ignores them on send (consistent with existing @ behavior)
    return "reference";
  }
}

export async function localFileAttachmentFromPath(
  absolutePath: string,
  options: ResolveWorkspaceFileReferenceAttachmentsOptions = {},
): Promise<WorkspaceFileReferenceAttachment> {
  const normalizedPath = absolutePath.replace(/\\/gu, "/");
  return localFileAttachmentFromAbsolutePath(absolutePath, normalizedPath, options);
}

async function localFileAttachmentFromAbsolutePath(
  absolutePath: string,
  attachmentPath: string,
  options: ResolveWorkspaceFileReferenceAttachmentsOptions = {},
): Promise<WorkspaceFileReferenceAttachment> {
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) {
    throw new Error(`Not a referenceable file: ${attachmentPath}`);
  }

  const bytes = await readFile(absolutePath);
  const image = detectSupportedImageFile(absolutePath, bytes);
  if (image) {
    return {
      kind: "image",
      path: attachmentPath,
      attachedAtUnixMs: Date.now(),
    };
  }

  if (hasSupportedImageExtension(absolutePath)) {
    throw new Error(`Image file validation failed: ${attachmentPath}`);
  }

  const video = detectSupportedVideoFile(absolutePath, bytes);
  if (video) {
    return {
      kind: "video",
      path: attachmentPath,
      attachedAtUnixMs: Date.now(),
    };
  }

  if (hasSupportedVideoExtension(absolutePath)) {
    throw new Error(`Video file validation failed: ${attachmentPath}`);
  }

  if (bytes.includes(0)) {
    throw new Error(`Referencing binary files is not supported yet: ${attachmentPath}`);
  }

  const maxContentBytes = options.maxContentBytes ?? CONTEXT_INJECTION_MAX_BYTES;
  const truncated = bytes.length > maxContentBytes;
  const content = truncated
    ? `${decodeUtf8(sliceUtf8Head(bytes, maxContentBytes))}\n\n...<file content truncated>`
    : bytes.toString("utf8");

  return {
    kind: "text",
    path: attachmentPath,
    totalBytes: bytes.length,
    truncated,
    attachedAtUnixMs: Date.now(),
    content,
  };
}

async function collectWorkspaceFileReferenceIndexUncached(
  workspaceRoot: string,
): Promise<string[]> {
  const viaGit = await collectWorkspaceFileIndexViaGit(workspaceRoot);
  if (viaGit !== null) {
    return viaGit;
  }

  return collectWorkspaceFileIndexViaFastGlob(workspaceRoot);
}

async function collectWorkspaceFileIndexViaGit(workspaceRoot: string): Promise<string[] | null> {
  try {
    await stat(resolve(workspaceRoot, ".git"));
  } catch {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        cwd: workspaceRoot,
        windowsHide: true,
        maxBuffer: GIT_LS_FILES_MAX_BUFFER,
      },
    );

    return stdout
      .split("\0")
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.replace(/\\/gu, "/"))
      .filter((entry) => pathPassesDefaultIgnoredDirectories(entry));
  } catch {
    return null;
  }
}

async function collectWorkspaceFileIndexViaFastGlob(workspaceRoot: string): Promise<string[]> {
  const globIgnore = [
    "**/.git/**",
    ...Array.from(DEFAULT_IGNORED_DIRECTORY_NAMES).map((directory) => `**/${directory}/**`),
  ];

  const entries = await fg("**/*", {
    cwd: workspaceRoot,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    ignore: globIgnore,
  });

  const files: string[] = [];
  const matcherCache = new Map<
    string,
    Awaited<ReturnType<typeof cachedIgnoreMatchersForRelativeDir>>
  >();

  for (const entry of entries) {
    const relativePath = entry.replace(/\\/gu, "/");
    const parentDirRelPath = relativePath.includes("/")
      ? relativePath.slice(0, relativePath.lastIndexOf("/"))
      : "";
    if (
      parentDirRelPath.split("/").some((segment) => DEFAULT_IGNORED_DIRECTORY_NAMES.has(segment))
    ) {
      continue;
    }

    const matchers = await cachedIgnoreMatchersForRelativeDir(
      workspaceRoot,
      parentDirRelPath,
      matcherCache,
    );
    if (shouldIgnoreWorkspacePath(relativePath, false, matchers)) {
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

function pathPassesDefaultIgnoredDirectories(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/gu, "/").split("/");
  return !segments.some((segment) => DEFAULT_IGNORED_DIRECTORY_NAMES.has(segment));
}

async function resolveWorkspaceFileReferencePath(
  workspaceRoot: string,
  referencePath: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const normalizedReferencePath = referencePath.replace(/\0/gu, "").replace(/\\/gu, "/").trim();
  if (!normalizedReferencePath) {
    throw new Error("No file path specified");
  }
  if (
    isAbsolute(referencePath) ||
    isAbsolute(normalizedReferencePath) ||
    normalizedReferencePath.startsWith("/")
  ) {
    const canonicalTarget = await realpath(normalizedReferencePath);
    return {
      absolutePath: canonicalTarget,
      relativePath: normalizedReferencePath,
    };
  }

  const segments = normalizedReferencePath.split("/").filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new Error(`Referencing files outside the workspace is not supported: ${referencePath}`);
    }
  }

  const workspaceRootResolved = await canonicalWorkspaceRoot(workspaceRoot);
  const targetPath = resolve(workspaceRootResolved, ...segments);
  const relativeTarget = relative(workspaceRootResolved, targetPath);
  if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
    throw new Error(`Referencing files outside the workspace is not supported: ${referencePath}`);
  }

  const canonicalTarget = await realpath(targetPath);
  const canonicalRelativeTarget = relative(workspaceRootResolved, canonicalTarget);
  if (canonicalRelativeTarget.startsWith("..") || isAbsolute(canonicalRelativeTarget)) {
    throw new Error(`Referencing files outside the workspace is not supported: ${referencePath}`);
  }

  return {
    absolutePath: canonicalTarget,
    relativePath: canonicalRelativeTarget.replace(/\\/gu, "/"),
  };
}

async function canonicalWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const resolved = resolve(workspaceRoot);
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}
