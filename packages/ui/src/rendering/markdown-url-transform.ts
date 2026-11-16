import { defaultUrlTransform as streamdownDefaultUrlTransform } from "streamdown";
import type { UrlTransform as StreamdownUrlTransform } from "streamdown";

import {
  isManagedGeneratedImageRef,
  isManagedGeneratedVideoRef,
} from "./managed-generated-asset.js";
import { isBlockedRemoteMarkdownMediaSrc } from "./markdown-local-image-src.js";

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
