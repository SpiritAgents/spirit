import type { ComponentProps, ReactNode } from "react";

import { Button } from "./button.js";
import { cn } from "./cn.js";

export type EmptyCardAction = {
  label: ReactNode;
  onClick: () => void;
};

type EmptyCardProps = Omit<ComponentProps<"div">, "title"> & {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: EmptyCardAction;
};

/** Transparent empty state with optional icon, title, description, supplemental content, and action button. */
export function EmptyCard({
  icon,
  title,
  description,
  action,
  className,
  children,
  ...props
}: EmptyCardProps) {
  return (
    <div className={cn("px-4 py-10 text-center", className)} {...props}>
      {icon ? (
        <div aria-hidden className="mb-3 flex justify-center text-muted-foreground [&_svg]:size-6">
          {icon}
        </div>
      ) : null}
      {title ? <p className="text-base font-medium text-foreground">{title}</p> : null}
      {description ? (
        <p className={cn("text-sm text-muted-foreground", title && "mt-1")}>{description}</p>
      ) : null}
      {children ? (
        <div
          className={cn("text-sm text-muted-foreground", (icon || title || description) && "mt-3")}
        >
          {children}
        </div>
      ) : null}
      {action ? (
        <div
          className={cn(
            "flex justify-center",
            (icon || title || description || children) && "mt-3",
          )}
        >
          <Button type="button" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
