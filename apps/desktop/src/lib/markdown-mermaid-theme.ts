import { createMermaidPlugin } from "@streamdown/mermaid";
import type { MermaidConfig } from "mermaid";

const MERMAID_FONT_FAMILY = "system-ui, sans-serif";

/** Void semantic colors: aligned with the dark-mode tokens in styles.css, avoiding Mermaid's default yellow/purple subgraph */
function buildVoidMermaidThemeVariables(resolvedDark: boolean): MermaidConfig["themeVariables"] {
  if (resolvedDark) {
    return {
      darkMode: true,
      background: "transparent",
      fontFamily: MERMAID_FONT_FAMILY,
      fontSize: "13px",
      primaryColor: "#181818",
      primaryTextColor: "#d4d4d4",
      primaryBorderColor: "#272727",
      secondaryColor: "#121212",
      secondaryTextColor: "#d4d4d4",
      secondaryBorderColor: "#272727",
      tertiaryColor: "#090909",
      tertiaryTextColor: "#a1a1a1",
      tertiaryBorderColor: "#272727",
      lineColor: "#525252",
      textColor: "#d4d4d4",
      mainBkg: "#181818",
      nodeBorder: "#272727",
      nodeTextColor: "#d4d4d4",
      clusterBkg: "#090909",
      clusterBorder: "#272727",
      defaultLinkColor: "#717171",
      titleColor: "#a1a1a1",
      edgeLabelBackground: "#181818",
      noteBkgColor: "#181818",
      noteTextColor: "#d4d4d4",
      noteBorderColor: "#272727",
    };
  }

  return {
    darkMode: false,
    background: "transparent",
    fontFamily: MERMAID_FONT_FAMILY,
    fontSize: "13px",
    primaryColor: "#f4f4f5",
    primaryTextColor: "#18181b",
    primaryBorderColor: "#e4e4e7",
    secondaryColor: "#fafafa",
    secondaryTextColor: "#18181b",
    secondaryBorderColor: "#e4e4e7",
    tertiaryColor: "#f4f4f5",
    tertiaryTextColor: "#52525b",
    tertiaryBorderColor: "#d4d4d8",
    lineColor: "#71717a",
    textColor: "#18181b",
    mainBkg: "#fafafa",
    nodeBorder: "#e4e4e7",
    nodeTextColor: "#18181b",
    clusterBkg: "#f4f4f5",
    clusterBorder: "#d4d4d8",
    defaultLinkColor: "#71717a",
    titleColor: "#52525b",
    edgeLabelBackground: "#fafafa",
    noteBkgColor: "#fafafa",
    noteTextColor: "#18181b",
    noteBorderColor: "#e4e4e7",
  };
}

export function getSpiritMermaidConfig(resolvedDark: boolean): MermaidConfig {
  return {
    theme: "base",
    themeVariables: buildVoidMermaidThemeVariables(resolvedDark),
  };
}

export function createSpiritMermaidPlugin(resolvedDark: boolean) {
  return createMermaidPlugin({
    config: getSpiritMermaidConfig(resolvedDark),
  });
}
