import { useCallback, useEffect, useState } from "react";

import { computeWorkspaceFileReferenceSuggestions } from "@spiritagent/api/workspace-file-reference-query";

import type { WorkspaceFileReferenceIndexSnapshot } from "@/types";

const INDEX_POLL_INTERVAL_MS = 50;
const INDEX_PRIME_RETRY_POLLS = 40;
const EMPTY_FILES: string[] = [];

type UseWorkspaceFileIndexOptions = {
  workspaceRoot: string;
  workspaceBinding: "project" | "none";
  primeWorkspaceFileReferenceIndex(): Promise<void>;
  getWorkspaceFileReferenceIndex(): Promise<WorkspaceFileReferenceIndexSnapshot>;
};

export function useWorkspaceFileIndex({
  workspaceRoot,
  workspaceBinding,
  primeWorkspaceFileReferenceIndex,
  getWorkspaceFileReferenceIndex,
}: UseWorkspaceFileIndexOptions) {
  const workspaceKey =
    workspaceBinding === "project" && workspaceRoot.trim().length > 0
      ? `${workspaceBinding}:${workspaceRoot}`
      : null;
  const [index, setIndex] = useState<{ key: string; files: string[] } | null>(null);
  const ready = workspaceKey !== null && index?.key === workspaceKey;
  const files = ready && index ? index.files : EMPTY_FILES;

  useEffect(() => {
    if (!workspaceKey) {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      let pollsSincePrime = 0;

      const requestPrime = () => {
        pollsSincePrime = 0;
        void primeWorkspaceFileReferenceIndex().catch(() => undefined);
      };

      requestPrime();

      while (true) {
        if (cancelled) {
          return;
        }
        try {
          const snapshot = await getWorkspaceFileReferenceIndex();
          if (cancelled) {
            return;
          }
          if (snapshot.ready) {
            setIndex({ key: workspaceKey, files: snapshot.files });
            return;
          }
        } catch {
          // Index still building or host not ready; keep polling.
        }

        pollsSincePrime += 1;
        if (pollsSincePrime >= INDEX_PRIME_RETRY_POLLS) {
          requestPrime();
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, INDEX_POLL_INTERVAL_MS);
        });
      }
    };

    void poll();

    return () => {
      cancelled = true;
    };
  }, [getWorkspaceFileReferenceIndex, primeWorkspaceFileReferenceIndex, workspaceKey]);

  const search = useCallback(
    (query: string): string[] => {
      if (!ready || files.length === 0) {
        return [];
      }
      return computeWorkspaceFileReferenceSuggestions(query, files);
    },
    [files, ready],
  );

  const searchFilesOnly = useCallback(
    (query: string): string[] => {
      if (!ready || files.length === 0) {
        return [];
      }
      return computeWorkspaceFileReferenceSuggestions(query, files, {
        includeDirectories: false,
      });
    },
    [files, ready],
  );

  return {
    ready,
    fileCount: files.length,
    search,
    searchFilesOnly,
  };
}
