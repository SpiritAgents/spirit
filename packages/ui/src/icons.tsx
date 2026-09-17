// Copyright (c) 2026 N123999
// SPDX-License-Identifier: MIT

import type { ComponentProps } from "react";

import { cn } from "./cn.js";

function Icon({ className, children, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cn("size-3.5 shrink-0", className)}
      {...props}
    >
      {children}
    </svg>
  );
}

export function CheckIcon({ className, ...props }: ComponentProps<"svg">) {
  return (
    <Icon className={className} {...props}>
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

export function ChevronRightIcon({ className, ...props }: ComponentProps<"svg">) {
  return (
    <Icon className={className} {...props}>
      <path
        d="M6 3.5 11 8 6 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

export function ChevronDownIcon({ className, ...props }: ComponentProps<"svg">) {
  return (
    <Icon className={className} {...props}>
      <path
        d="M3.5 6 8 11 12.5 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icon>
  );
}

export function CloseIcon({ className, ...props }: ComponentProps<"svg">) {
  return (
    <Icon className={className} {...props}>
      <path
        d="M4 4 12 12M12 4 4 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Icon>
  );
}

export function SpinnerIcon({ className, ...props }: ComponentProps<"svg">) {
  return (
    <Icon className={cn("animate-spin", className)} {...props}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
      <path
        d="M14 8a6 6 0 0 0-6-6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </Icon>
  );
}
