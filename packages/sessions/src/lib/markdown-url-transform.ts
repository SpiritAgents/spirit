import { defaultUrlTransform as streamdownDefaultUrlTransform } from "streamdown";
import type { UrlTransform as StreamdownUrlTransform } from "streamdown";

import {
  isManagedGeneratedImageRef,
  isManagedGeneratedVideoRef,
} from "@/lib/managed-generated-asset";
import { isBlockedRemoteMarkdownMediaSrc } from "@/lib/markdown-local-image-src";

export const streamdownUrlTransform: StreamdownUrlTransform = (url, key) => {
  if (key === "src" || key === "srcset") {
    if (isManagedGeneratedImageRef(url) || isManagedGeneratedVideoRef(url)) {
      return url;
    }
    if (typeof url === "string" && isBlockedRemoteMarkdownMediaSrc(url)) {
      return "";
    }
  }
  return streamdownDefaultUrlTransform(url, key, {} as never);
};
