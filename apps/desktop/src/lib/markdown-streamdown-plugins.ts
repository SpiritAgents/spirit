import { defaultSchema } from "hast-util-sanitize";
import rehypeSanitize from "rehype-sanitize";
import { defaultRehypePlugins } from "streamdown";
import type { Pluggable } from "unified";

import {
  preserveLocalMarkdownUrlsBeforeHarden,
  restoreLocalMarkdownUrlsAfterHarden,
} from "@/lib/markdown-harden-local-urls";

/** hast-util-sanitize compares protocol names without the trailing colon. */
export const MANAGED_GENERATED_ASSET_SANITIZE_PROTOCOL = "spirit";

const streamdownExtraTagNames = ["video", "picture", "source", "sup", "sub"] as const;

/**
 * Markdown media may load Spirit-managed spirit:// assets, relative/absolute local
 * paths (no scheme), and remote https. Clear-text http is not on the allowlist.
 */
export const streamdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), ...streamdownExtraTagNames])],
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "tel"],
    src: [MANAGED_GENERATED_ASSET_SANITIZE_PROTOCOL, "https"],
    srcset: [MANAGED_GENERATED_ASSET_SANITIZE_PROTOCOL, "https"],
  },
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "metastring"],
    video: [...(defaultSchema.attributes?.video ?? []), "src", "controls"],
    source: [...(defaultSchema.attributes?.source ?? []), "media", "srcset"],
    img: [...(defaultSchema.attributes?.img ?? []), "alt", "width", "height", "src"],
  },
};

export const streamdownRehypePlugins: Pluggable[] = [
  defaultRehypePlugins.raw,
  [rehypeSanitize, streamdownSanitizeSchema],
  preserveLocalMarkdownUrlsBeforeHarden,
  defaultRehypePlugins.harden,
  restoreLocalMarkdownUrlsAfterHarden,
];
