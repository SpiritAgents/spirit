import type { ITheme } from "@xterm/xterm";

/** SGR (sequences ending in m): covers 16-color / 256-color / truecolor. */
const ANSI_SGR_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");

/** Strips color-setting SGR while keeping non-m CSI (clear line/cursor etc.), so truecolor cannot bypass ITheme. */
export function stripAnsiSgrSequences(text: string): string {
  return text.replace(ANSI_SGR_RE, "");
}

const ANSI_COLOR_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

/** Builds a monochrome theme from a foreground color (all ANSI slots share the same color). */
export function buildShellToolMonochromeTheme(
  foreground: string,
  selectionBackground?: string,
): ITheme {
  const theme: ITheme = {
    foreground,
    background: "#00000000",
    cursor: "#00000000",
    cursorAccent: "#00000000",
    ...(selectionBackground ? { selectionBackground } : {}),
  };
  for (const key of ANSI_COLOR_KEYS) {
    theme[key] = foreground;
  }
  return theme;
}

/**
 * xterm's theme parser only understands #hex / rgb() / rgba() — anything else (e.g. a raw
 * color-mix() token) silently falls back to the default white. Encodes RGBA channels as the
 * hex form (#rrggbb / #rrggbbaa) xterm accepts.
 */
export function rgbaChannelsToXtermHex(r: number, g: number, b: number, a = 1): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  const base = `#${channel(r)}${channel(g)}${channel(b)}`;
  return a >= 1 ? base : `${base}${channel(a * 255)}`;
}

/**
 * Resolves a CSS custom property to RGBA channels through a canvas pixel — tokens may be
 * color-mix() (serialized as oklab()/color(srgb) depending on the browser version), so pattern
 * matching the computed string is unreliable. Alpha is returned as 0..1.
 */
function readTokenColorChannels(varName: string): [number, number, number, number] | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = `var(${varName})`;
  document.documentElement.appendChild(probe);
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  try {
    if (!ctx) {
      return undefined;
    }
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  } finally {
    probe.remove();
  }
}

/**
 * Resolves a CSS custom property to an xterm-parseable hex color. Tokens may be color-mix()
 * (which browsers serialize in computed styles as oklab()/color(srgb)/rgba() depending on the
 * version), so read the resolved color through a canvas pixel — the same trick xterm's own
 * css.toColor uses — instead of pattern-matching serializations.
 */
function readTokenColorForXterm(varName: string): string | undefined {
  const channels = readTokenColorChannels(varName);
  if (!channels) {
    return undefined;
  }
  return rgbaChannelsToXtermHex(channels[0], channels[1], channels[2], channels[3]);
}

/**
 * Alpha-composites the selection color over the surface color, returning opaque [r, g, b].
 * xterm derives its painted selection color via color.blend(theme.background, selection) and
 * forces the result opaque; this theme's background is transparent on purpose, which made the
 * blend produce rgb(0,0,0) in light mode (and an accidental dark gray in dark mode). Emitting
 * the pre-composited opaque color short-circuits that blend (blend returns opaque fg verbatim),
 * so the canvas paints exactly the intended surface-relative selection color.
 */
export function compositeOpaqueSelectionOverSurface(
  selection: readonly [number, number, number, number],
  surface: readonly [number, number, number, number],
): [number, number, number] | undefined {
  const [selR, selG, selB, selA] = selection;
  const [baseR, baseG, baseB, baseA] = surface;
  const outA = selA + baseA * (1 - selA);
  if (outA <= 0) {
    return undefined;
  }
  const blendChannel = (sel: number, base: number) =>
    Math.round((sel * selA + base * baseA * (1 - selA)) / outA);
  return [blendChannel(selR, baseR), blendChannel(selG, baseG), blendChannel(selB, baseB)];
}

/**
 * The selection color xterm should paint: --terminal-selection-bg composited over --background
 * (the conversation surface behind the output panel), emitted as opaque #rrggbb. The panel's
 * own muted/15 tint is ignored — an approximation well below perceptible difference.
 */
function readShellToolSelectionBackground(): string | undefined {
  const selection = readTokenColorChannels("--terminal-selection-bg");
  const surface = readTokenColorChannels("--background");
  if (!selection || !surface) {
    return undefined;
  }
  const composited = compositeOpaqueSelectionOverSurface(selection, surface);
  if (!composited) {
    return undefined;
  }
  return rgbaChannelsToXtermHex(composited[0], composited[1], composited[2]);
}

/** Monochrome xterm theme aligned with the tool card's `text-muted-foreground`: consumes ANSI without applying colors. */
export function readShellToolMonochromeTheme(element?: Element | null): ITheme {
  const styles = getComputedStyle(element ?? document.documentElement);
  const foreground =
    readTokenColorForXterm("--muted-foreground") ?? (styles.color.trim() || "#a1a1a1");
  return buildShellToolMonochromeTheme(foreground, readShellToolSelectionBackground());
}
