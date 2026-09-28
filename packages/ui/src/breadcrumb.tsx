import { ChevronRight } from "@spiritagent/icons/chevron-right";

import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "./cn.js";

export function Breadcrumb({ className, ...props }: ComponentProps<"nav">) {
  return <nav aria-label="breadcrumb" data-slot="breadcrumb" className={className} {...props} />;
}

export function BreadcrumbList({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn("flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export function BreadcrumbLink({
  asChild = false,
  className,
  ...props
}: ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "a";
  return (
    <Comp
      data-slot="breadcrumb-link"
      className={cn("hover:text-chrome-emphasis", className)}
      {...props}
    />
  );
}

export function BreadcrumbPage({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled
      aria-current="page"
      className={cn("font-normal text-foreground", className)}
      {...props}
    />
  );
}

export function BreadcrumbSeparator({ className, children, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden
      className={cn("text-muted-foreground [&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRight strokeWidth={1.75} />}
    </li>
  );
}

export function BreadcrumbEllipsis({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden
      className={cn("flex size-5 items-center justify-center", className)}
      {...props}
    >
      …
    </span>
  );
}
