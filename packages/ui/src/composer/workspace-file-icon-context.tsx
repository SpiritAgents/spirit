import type { ReactNode } from "react";
import { createContext, useContext } from "react";

import { File } from "lucide-react";

/** The workspace file-type icon is host-domain (icon theme loading); apps inject their renderer. */
export type WorkspaceFileIconComponent = (props: {
  name?: string;
  path?: string;
  kind?: "file" | "dir";
  size?: number;
  className?: string;
  colorMode?: "inherit" | "list";
}) => ReactNode;

const WorkspaceFileIconContext = createContext<WorkspaceFileIconComponent | null>(null);

export const WorkspaceFileIconProvider = WorkspaceFileIconContext.Provider;

/** The injected host file-type icon, or null so callers fall back to a generic file icon. */
export function useWorkspaceFileIcon(): WorkspaceFileIconComponent | null {
  return useContext(WorkspaceFileIconContext);
}

/** Chip icon slot: the host-injected file-type icon, or a generic file glyph when unprovided. */
export function WorkspaceFileIconSlot({
  path,
  kind = "file",
  size,
  className,
}: {
  path?: string;
  kind?: "file" | "dir";
  size: number;
  className?: string | undefined;
}) {
  const Injected = useWorkspaceFileIcon();
  if (Injected) {
    return (
      <Injected path={path} kind={kind} size={size} className={className} colorMode="inherit" />
    );
  }
  return <File size={size} className={className} aria-hidden strokeWidth={1.75} />;
}
