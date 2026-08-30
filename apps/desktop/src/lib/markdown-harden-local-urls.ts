import type { Root } from "hast";
import type { Plugin } from "unified";

import { isMarkdownLocalPathUrl, prefixBareRelativeMarkdownUrl } from "@/lib/markdown-local-url";

type HastElement = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: unknown[];
};

const preservedLocalUrls = new WeakMap<HastElement, { href?: string; src?: string }>();

function walkHastElements(node: unknown, visit: (element: HastElement) => void): void {
  if (!node || typeof node !== "object") {
    return;
  }
  const record = node as HastElement;
  if (record.type === "element" && typeof record.tagName === "string") {
    visit(record);
  }
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      walkHastElements(child, visit);
    }
  }
}

function stashProperty(element: HastElement, key: "href" | "src"): void {
  const value = element.properties?.[key];
  if (typeof value !== "string" || !isMarkdownLocalPathUrl(value)) {
    return;
  }
  const current = preservedLocalUrls.get(element) ?? {};
  current[key] = value;
  preservedLocalUrls.set(element, current);
  if (element.properties) {
    element.properties[key] = prefixBareRelativeMarkdownUrl(value);
  }
}

/** Stash local href/src and prefix bare relatives so rehype-harden's parseUrl accepts them. */
export const preserveLocalMarkdownUrlsBeforeHarden: Plugin<[], Root> = () => {
  return (tree) => {
    walkHastElements(tree, (element) => {
      if (element.tagName === "a") {
        stashProperty(element, "href");
      }
      if (element.tagName === "img") {
        stashProperty(element, "src");
      }
    });
  };
};

/** Restore original local href/src after harden rewrites `./docs/a.md` to `/docs/a.md`. */
export const restoreLocalMarkdownUrlsAfterHarden: Plugin<[], Root> = () => {
  return (tree) => {
    walkHastElements(tree, (element) => {
      const saved = preservedLocalUrls.get(element);
      if (!saved || !element.properties) {
        return;
      }
      if (saved.href !== undefined) {
        element.properties.href = saved.href;
      }
      if (saved.src !== undefined) {
        element.properties.src = saved.src;
      }
    });
  };
};
