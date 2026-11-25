import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { LinkPreviewDocument } from "@spiritagent/api/types";
import { parseAgentLinkPreviewDocument, type AgentLinkPreview } from "@/lib/agent-link-preview";

export type FetchLinkPreviewDocument = (request: { url: string }) => Promise<LinkPreviewDocument>;
type LoadAgentLinkPreview = (url: string) => Promise<AgentLinkPreview | null>;

const AgentLinkPreviewContext = createContext<LoadAgentLinkPreview | null>(null);

export function AgentLinkPreviewProvider({
  fetchDocument,
  allowPrivateNetworkForTesting = false,
  children,
}: {
  fetchDocument: FetchLinkPreviewDocument;
  allowPrivateNetworkForTesting?: boolean;
  children: ReactNode;
}) {
  const cacheRef = useRef(
    new Map<
      string,
      { owner: FetchLinkPreviewDocument; pending: Promise<AgentLinkPreview | null> }
    >(),
  );
  const load = useCallback<LoadAgentLinkPreview>(
    (url) => {
      const cached = cacheRef.current.get(url);
      if (cached?.owner === fetchDocument) return cached.pending;
      const pending = Promise.resolve()
        .then(() => fetchDocument({ url }))
        .then((document) =>
          parseAgentLinkPreviewDocument(document, {
            allowPrivateNetwork: allowPrivateNetworkForTesting,
          }),
        )
        .catch(() => null);
      cacheRef.current.set(url, { owner: fetchDocument, pending });
      return pending;
    },
    [allowPrivateNetworkForTesting, fetchDocument],
  );
  return (
    <AgentLinkPreviewContext.Provider value={load}>{children}</AgentLinkPreviewContext.Provider>
  );
}

export function useAgentLinkPreview(url: string | undefined): AgentLinkPreview | null | undefined {
  const load = useContext(AgentLinkPreviewContext);
  const [snapshot, setSnapshot] = useState<{
    url: string;
    preview: AgentLinkPreview | null;
  }>();

  useEffect(() => {
    if (!url || !load) return;
    let active = true;
    void load(url).then((preview) => {
      if (active) setSnapshot({ url, preview });
    });
    return () => {
      active = false;
    };
  }, [load, url]);

  return url && snapshot?.url === url ? snapshot.preview : undefined;
}
