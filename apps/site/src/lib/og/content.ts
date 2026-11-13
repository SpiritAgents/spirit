import { findPath } from "fumadocs-core/page-tree";
import type { Root } from "fumadocs-core/page-tree";

import type { Messages } from "@/i18n/messages";

export function getRootSectionTitle(messages: Messages, segment: string): string | null {
  if (segment === "download") return messages.common.download;
  if (segment === "docs") return messages.hero.nav.docs;
  if (segment === "changelog") return messages.hero.nav.changelog;
  return null;
}

export function getDocsGroupNames(tree: Root, url: string): string[] {
  const path = findPath(tree.children, (node) => node.type === "page" && node.url === url);
  if (!path) return [];
  return path.flatMap((node) =>
    node.type === "folder" && typeof node.name === "string" && node.name.length > 0
      ? [node.name]
      : [],
  );
}
