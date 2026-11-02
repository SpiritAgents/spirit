/* Minimal structural types for the composer family. Hosts pass their richer snapshot
 * objects; these are the fields the shared components actually read. */

export type SaveLocalImageAs = (filePath: string) => Promise<boolean>;

export type WorkspaceExplorerEntryKind = "file" | "dir";

/** Skill list entry subset the composer slash logic reads. */
export type ComposerSkillListItem = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};
