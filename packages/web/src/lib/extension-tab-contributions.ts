import type {
  DesktopExtensionDesktopTab,
  DesktopExtensionDesktopTabScope,
  DesktopExtensionListItem,
} from "@/types";
import type { WorkspaceExtensionToolTabScope } from "@/lib/workspace-tool-tabs";

export interface ExtensionTabContribution {
  extension: DesktopExtensionListItem;
  contribution: DesktopExtensionDesktopTab;
}

export function collectExtensionTabContributions(
  extensions: readonly DesktopExtensionListItem[] | undefined,
): ExtensionTabContribution[] {
  return (extensions ?? [])
    .filter((extension) => extension.enabled && extension.supportedHosts.includes("desktop"))
    .flatMap((extension) =>
      (extension.desktopTabs ?? []).map((contribution) => ({ extension, contribution })),
    )
    .sort(
      (left, right) =>
        left.extension.displayName.localeCompare(right.extension.displayName) ||
        left.contribution.name.localeCompare(right.contribution.name),
    );
}

export function resolveExtensionTabScope(input: {
  defaultScope: DesktopExtensionDesktopTabScope;
  workspaceRoot: string;
  sessionKey: string;
}): WorkspaceExtensionToolTabScope {
  if (input.defaultScope === "workspace") {
    if (!input.workspaceRoot) {
      throw new Error("A workspace-scoped extension tab requires an active workspace.");
    }
    return { kind: "workspace", workspaceRoot: input.workspaceRoot };
  }
  if (input.defaultScope === "session") {
    if (!input.sessionKey) {
      throw new Error("A session-scoped extension tab requires an active session.");
    }
    return { kind: "session", sessionKey: input.sessionKey };
  }
  return { kind: "window-shared" };
}
