import { useMemo, type ComponentProps, type ComponentType } from "react";
import { math } from "@streamdown/math";
import { Streamdown, type BlockProps } from "streamdown";

import type { ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";
import type { ReadManagedVideoPreviewUrl } from "@/components/markdown-video";
import type {
  ReadLocalImagePreview,
  ReadLocalVideoPreview,
} from "@/components/tool-call/tool-call-types";
import { useWorkspaceMarkdownLinkClick } from "@/components/workspace-markdown-link-context";
import { useTheme } from "@/hooks/useTheme";
import {
  createMarkdownMessageComponents,
  markdownMessageRootClassName,
  type MarkdownSize,
  type MarkdownTone,
} from "@/lib/markdown-message-components";
import { createSpiritMermaidPlugin } from "@/lib/markdown-mermaid-theme";
import { createSpiritRemarkPluginsForStreamdown } from "@/lib/markdown-remark-plugins";
import { streamdownRehypePlugins } from "@/lib/markdown-streamdown-plugins";
import { streamdownUrlTransform } from "@/lib/markdown-url-transform";
import { createSpiritStreamdownCodeComponent } from "@/lib/spirit-streamdown-code-component";

const streamdownMathPlugin = math;

import { spiritShikiCodePlugin } from "@/lib/spirit-shiki-code-plugin";

const spiritStreamdownCodePlugin = spiritShikiCodePlugin;

export const spiritStreamdownControls = {
  code: { copy: false, download: false },
  mermaid: { copy: false, download: false, fullscreen: false, panZoom: true },
  table: { copy: true, download: true, fullscreen: true },
} as const;

export type SpiritStreamdownMarkdownProps = {
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
};

export function SpiritStreamdownMarkdown({
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
}: SpiritStreamdownMarkdownProps) {
  const { resolvedDark } = useTheme();
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
  ]);

  return (
    <Streamdown
      data-spirit-markdown-root
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
  );
}
