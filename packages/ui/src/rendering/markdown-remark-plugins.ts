import remarkBreaks from "remark-breaks";
import { defaultRemarkPlugins } from "streamdown";
import type { Pluggable } from "unified";

const spiritRemarkPluginBase: Pluggable[] = Object.values(defaultRemarkPlugins);

export type SpiritRemarkPluginsOptions = {
  /** When true (default), single newlines inside a paragraph become hard breaks. */
  singleLineBreaks?: boolean;
};

/** Streamdown: keep the default remark plugins and optionally append remark-breaks. */
export function createSpiritRemarkPluginsForStreamdown(
  options: SpiritRemarkPluginsOptions = {},
): Pluggable[] {
  const singleLineBreaks = options.singleLineBreaks ?? true;
  const plugins: Pluggable[] = [...spiritRemarkPluginBase];
  if (singleLineBreaks) {
    plugins.push(remarkBreaks);
  }
  return plugins;
}

/** Default Spirit remark plugins (includes remark-breaks). */
export const spiritRemarkPluginsForStreamdown = createSpiritRemarkPluginsForStreamdown();
