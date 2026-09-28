import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import {
  DESKTOP_CONTENT_TRANSLUCENT_FILL,
  DESKTOP_OUTLINE_BORDER,
  DESKTOP_OUTLINE_BUTTON_EXPANDED,
  DESKTOP_OUTLINE_BUTTON_FOCUSED,
  DESKTOP_OUTLINE_BUTTON_HOVER,
  instantHoverMotionClass,
} from "./chrome.js";
import { cn } from "./cn.js";

export const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding font-normal text-sm whitespace-nowrap outline-none select-none transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground transition-none hover:bg-[color-mix(in_oklab,var(--primary)_90%,white)] dark:hover:bg-[color-mix(in_oklab,var(--primary)_90%,black)]",
        outline: cn(
          "bg-background transition-none",
          DESKTOP_CONTENT_TRANSLUCENT_FILL,
          DESKTOP_OUTLINE_BORDER,
          DESKTOP_OUTLINE_BUTTON_HOVER,
          DESKTOP_OUTLINE_BUTTON_FOCUSED,
          DESKTOP_OUTLINE_BUTTON_EXPANDED,
        ),
        secondary:
          "bg-secondary text-secondary-foreground transition-none hover:bg-[color-mix(in_oklab,var(--secondary)_98%,black)] dark:hover:bg-[color-mix(in_oklab,var(--secondary)_98%,white)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost: cn(
          "hover:bg-canvas-hover hover:text-chrome-emphasis aria-expanded:bg-canvas-hover aria-expanded:text-chrome-emphasis",
          instantHoverMotionClass,
        ),
        destructive:
          "bg-destructive/10 text-destructive transition-none hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
