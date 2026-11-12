import { createContext, useContext, type MouseEvent, type ReactNode } from "react";

export type WorkspaceMarkdownLinkClickHandler = (
  href: string,
  event: MouseEvent<HTMLAnchorElement>,
) => boolean;

const WorkspaceMarkdownLinkContext = createContext<WorkspaceMarkdownLinkClickHandler | undefined>(
  undefined,
);

export function WorkspaceMarkdownLinkProvider({
  children,
  onLinkClick,
}: {
  children: ReactNode;
  onLinkClick?: WorkspaceMarkdownLinkClickHandler;
}) {
  return (
    <WorkspaceMarkdownLinkContext.Provider value={onLinkClick}>
      {children}
    </WorkspaceMarkdownLinkContext.Provider>
  );
}

export function useWorkspaceMarkdownLinkClick(): WorkspaceMarkdownLinkClickHandler | undefined {
  return useContext(WorkspaceMarkdownLinkContext);
}
