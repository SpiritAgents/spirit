import { createElement, forwardRef, type ReactNode, type SVGProps } from "react";

import { defaultAttributes } from "./default-attributes.js";

export type SpiritIconNode = Array<[tag: string, attrs: Record<string, string | number>]>;

export type SpiritIconProps = Omit<SVGProps<SVGSVGElement>, "color" | "ref"> & {
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
};

function hasA11yProp(props: SVGProps<SVGSVGElement>): boolean {
  return props["aria-label"] != null || props["aria-labelledby"] != null || props.role != null;
}

function toPascalCase(name: string): string {
  return name
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function mergeClassNames(...classes: Array<string | undefined>): string | undefined {
  const merged = classes.filter((value): value is string => Boolean(value)).join(" ");
  return merged.length > 0 ? merged : undefined;
}

export function createSpiritIcon(name: string, iconNode: SpiritIconNode) {
  const Component = forwardRef<SVGSVGElement, SpiritIconProps>(
    ({ size = 24, color = "currentColor", strokeWidth = 2, className, children, ...rest }, ref) => {
      const childNodes: ReactNode[] = iconNode.map(([tag, attrs], index) =>
        createElement(tag, { key: attrs.key ?? index, ...attrs }),
      );
      if (children != null) {
        childNodes.push(children);
      }

      return createElement(
        "svg",
        {
          ref,
          ...defaultAttributes,
          width: size,
          height: size,
          stroke: color,
          strokeWidth,
          className: mergeClassNames("spirit-icon", `spirit-icon-${name}`, className),
          ...(!hasA11yProp(rest) && children == null ? { "aria-hidden": true } : {}),
          ...rest,
        },
        childNodes,
      );
    },
  );

  Component.displayName = toPascalCase(name);
  return Component;
}
