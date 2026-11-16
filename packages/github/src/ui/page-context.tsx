import { createContext, useContext, type ReactNode } from "react";
import type { SpiritDesktopTabPageContext } from "@spiritagent/extension-toolkit/desktop-ui";
const PageContext = createContext<SpiritDesktopTabPageContext | null>(null);
export function GitHubPageProvider({
  context,
  children,
}: {
  context: SpiritDesktopTabPageContext;
  children: ReactNode;
}) {
  return <PageContext.Provider value={context}>{children}</PageContext.Provider>;
}
export function useGitHubPage() {
  const context = useContext(PageContext);
  if (!context) throw new Error("A GitHub page context is required.");
  return context;
}
