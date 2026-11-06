import path from "node:path";

import {
  deleteTranscriptSessionDir,
  ensureTranscriptSessionDir,
  resolveSessionTranscriptFilePath,
} from "@spiritagent/host-internal";

import { spiritDataDir } from "./storage.js";

/** The chat path is a lookup key; host-internal resolves its stable storage identity. */
export function resolveTranscriptSessionKeyForChatPath(chatPath: string): string {
  return path.resolve(chatPath);
}

export function resolveDesktopSessionTranscriptPath(chatPath: string): string {
  return resolveSessionTranscriptFilePath(
    spiritDataDir(),
    resolveTranscriptSessionKeyForChatPath(chatPath),
  );
}

export async function ensureDesktopTranscriptSessionDir(sessionKey: string): Promise<string> {
  return ensureTranscriptSessionDir(spiritDataDir(), sessionKey);
}

export async function ensureDesktopTranscriptSessionDirForChatPath(
  chatPath: string,
): Promise<string> {
  return ensureDesktopTranscriptSessionDir(resolveTranscriptSessionKeyForChatPath(chatPath));
}

export async function deleteDesktopTranscriptSessionDir(sessionKey: string): Promise<void> {
  await deleteTranscriptSessionDir(spiritDataDir(), sessionKey);
}

export async function deleteDesktopTranscriptSessionDirForChatPath(
  chatPath: string,
): Promise<void> {
  await deleteDesktopTranscriptSessionDir(resolveTranscriptSessionKeyForChatPath(chatPath));
}
