import { useMemo, type ComponentProps, type ComponentType } from "react";
import { math } from "@streamdown/math";
import { Streamdown, type BlockProps } from "streamdown";

import type { ReadManagedImagePreviewDataUrl } from "./markdown-image.js";
import type { ReadManagedVideoPreviewUrl } from "./markdown-video.js";
import type { ReadLocalImagePreview, ReadLocalVideoPreview } from "./media-types.js";
import { useWorkspaceMarkdownLinkClick } from "./workspace-markdown-link-context.js";
import {
  createMarkdownMessageComponents,
  markdownMessageRootClassName,
  type MarkdownLinkComponentProps,
  type MarkdownSize,
  type MarkdownTone,
} from "./markdown-message-components.js";
import { createSpiritMermaidPlugin } from "./markdown-mermaid-theme.js";
import { createSpiritRemarkPluginsForStreamdown } from "./markdown-remark-plugins.js";
import { streamdownRehypePlugins } from "./markdown-streamdown-plugins.js";
import { streamdownUrlTransform } from "./markdown-url-transform.js";
import { createSpiritStreamdownCodeComponent } from "./spirit-streamdown-code-component.js";

const streamdownMathPlugin = math;

import { spiritShikiCodePlugin } from "./spirit-shiki-code-plugin.js";

const spiritStreamdownCodePlugin = spiritShikiCodePlugin;

export const spiritStreamdownControls = {
  code: { copy: false, download: false },
  mermaid: { copy: false, download: false, fullscreen: false, panZoom: true },
  table: { copy: true, download: true, fullscreen: true },
} as const;

export type SpiritStreamdownMarkdownProps = {
  resolvedDark: boolean;
  content: string;
  streaming?: boolean;
  className?: string;
  tone?: MarkdownTone;
  size?: MarkdownSize;
  allowHtml?: boolean;
  singleLineBreaks?: boolean;
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl;
  readManagedVideoPreviewUrl?: ReadManagedVideoPreviewUrl;
  readLocalImagePreviewDataUrl?: ReadLocalImagePreview;
  readLocalVideoPreviewUrl?: ReadLocalVideoPreview;
  localImageBaseDir?: string;
  localImageAllowedRootDir?: string;
  BlockComponent?: ComponentType<BlockProps>;
  isAnimating?: boolean;
  animated?: ComponentProps<typeof Streamdown>["animated"];
  linkComponent?: ComponentType<MarkdownLinkComponentProps>;
};

export function SpiritStreamdownMarkdown({
  resolvedDark,
  content,
  streaming = false,
  className,
  tone = "default",
  size = "default",
  allowHtml = false,
  singleLineBreaks = true,
  readManagedImagePreviewDataUrl,
  readManagedVideoPreviewUrl,
  readLocalImagePreviewDataUrl,
  readLocalVideoPreviewUrl,
  localImageBaseDir,
  localImageAllowedRootDir,
  BlockComponent,
  isAnimating = false,
  animated = false,
  linkComponent,
}: SpiritStreamdownMarkdownProps) {
  const onMarkdownLinkClick = useWorkspaceMarkdownLinkClick();
  const streamdownPlugins = useMemo(
    () => ({
      code: spiritStreamdownCodePlugin,
      math: streamdownMathPlugin,
      mermaid: createSpiritMermaidPlugin(resolvedDark),
    }),
    [resolvedDark],
  );

  const remarkPlugins = useMemo(
    () => createSpiritRemarkPluginsForStreamdown({ singleLineBreaks }),
    [singleLineBreaks],
  );

  const components = useMemo(() => {
    const {
      pre: _pre,
      code: inlineCode,
      ...rest
    } = createMarkdownMessageComponents(
      readManagedImagePreviewDataUrl,
      tone,
      readManagedVideoPreviewUrl,
      onMarkdownLinkClick,
      size,
      allowHtml,
      readLocalImagePreviewDataUrl,
      localImageBaseDir,
      localImageAllowedRootDir,
      readLocalVideoPreviewUrl,
      linkComponent,
      streaming,
    );
    return {
      ...rest,
      code: createSpiritStreamdownCodeComponent(
        spiritStreamdownCodePlugin,
        inlineCode,
        resolvedDark,
      ),
    };
  }, [
    allowHtml,
    localImageAllowedRootDir,
    localImageBaseDir,
    onMarkdownLinkClick,
    readLocalImagePreviewDataUrl,
    readLocalVideoPreviewUrl,
    readManagedImagePreviewDataUrl,
    readManagedVideoPreviewUrl,
    resolvedDark,
    size,
    tone,
    linkComponent,
    streaming,
  ]);

  return (
    <div data-spirit-markdown-root data-spirit-selectable="text" className="min-w-0">
      <Streamdown
        className={markdownMessageRootClassName(tone, className, size)}
        mode={streaming ? "streaming" : "static"}
        plugins={streamdownPlugins}
        remarkPlugins={remarkPlugins}
        components={components}
        urlTransform={streamdownUrlTransform}
        rehypePlugins={streamdownRehypePlugins}
        controls={spiritStreamdownControls}
        lineNumbers={false}
        parseIncompleteMarkdown={streaming}
        isAnimating={isAnimating}
        animated={animated}
        BlockComponent={BlockComponent}
      >
        {content}
      </Streamdown>
    </div>
  );
}
