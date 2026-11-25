import type { ReactNode } from "react";

import {
  WorkspaceMarkdownLinkProvider as SharedWorkspaceMarkdownLinkProvider,
  type WorkspaceMarkdownLinkClickHandler,
} from "@spiritagent/ui/rendering/workspace-markdown-link-context";
import {
  AgentLinkPreviewProvider,
  type FetchLinkPreviewDocument,
} from "@/components/agent-link-preview-context";

export { useWorkspaceMarkdownLinkClick } from "@spiritagent/ui/rendering/workspace-markdown-link-context";
export type { WorkspaceMarkdownLinkClickHandler };

export function WorkspaceMarkdownLinkProvider({
  children,
  onLinkClick,
  fetchLinkPreview,
  allowPrivateNetworkForTesting = false,
}: {
  children: ReactNode;
  onLinkClick?: WorkspaceMarkdownLinkClickHandler;
  fetchLinkPreview?: FetchLinkPreviewDocument;
  allowPrivateNetworkForTesting?: boolean;
}) {
  const content = (
    <SharedWorkspaceMarkdownLinkProvider onLinkClick={onLinkClick}>
      {children}
    </SharedWorkspaceMarkdownLinkProvider>
  );
  if (!fetchLinkPreview) return content;
  return (
    <AgentLinkPreviewProvider
      fetchDocument={fetchLinkPreview}
      allowPrivateNetworkForTesting={allowPrivateNetworkForTesting}
    >
      {content}
    </AgentLinkPreviewProvider>
  );
}
