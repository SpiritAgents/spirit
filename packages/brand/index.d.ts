import type { CSSProperties, ReactElement, SVGProps } from "react";

export const SPIRIT_GLASS_LOGO_PATH: string;
export const SPIRIT_GLASS_LOGO_VIEWBOX: { width: 142; height: 157 };

export function createOpticalLogoSvg(sourceSvg: string, size: number): string;

/** For the splash shimmer mask: matches the glass glyph outline */
export function spiritGlassLogoMaskStyle(): CSSProperties;

export type SpiritGlassLogoProps = Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox"> & {
  /** Rendered width (px); height is derived from the viewBox aspect ratio */
  width?: number;
};

export function SpiritGlassLogo(props: SpiritGlassLogoProps): ReactElement;
