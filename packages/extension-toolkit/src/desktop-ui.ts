/** Props for a precompiled Desktop view: `export default function View(props)`. */
export interface SpiritDesktopViewProps {
  params: unknown;
  close: (result?: unknown) => void;
}

export type SpiritDesktopView = (props: SpiritDesktopViewProps) => unknown;
