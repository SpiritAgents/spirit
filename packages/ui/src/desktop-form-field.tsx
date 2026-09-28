// Copyright (c) 2026 Yu
// SPDX-License-Identifier: MIT

import { forwardRef, type ComponentProps } from "react";

import {
  DESKTOP_FORM_INPUT_INNER,
  DESKTOP_FORM_INPUT_SHELL,
  DESKTOP_FORM_TEXTAREA_INNER,
} from "./chrome.js";
import { cn } from "./cn.js";
import { Input } from "./input.js";
import { Textarea } from "./textarea.js";

type DesktopFormFieldShellProps = {
  shellClassName?: string;
};

export const DesktopFormInput = forwardRef<
  HTMLInputElement,
  ComponentProps<typeof Input> & DesktopFormFieldShellProps
>(function DesktopFormInput({ className, shellClassName, ...props }, ref) {
  return (
    <div className={cn(DESKTOP_FORM_INPUT_SHELL, shellClassName)}>
      <Input ref={ref} className={cn(DESKTOP_FORM_INPUT_INNER, className)} {...props} />
    </div>
  );
});

export function DesktopFormTextarea({
  className,
  shellClassName,
  ...props
}: ComponentProps<typeof Textarea> & DesktopFormFieldShellProps) {
  return (
    <div className={cn(DESKTOP_FORM_INPUT_SHELL, shellClassName)}>
      <Textarea className={cn(DESKTOP_FORM_TEXTAREA_INNER, className)} {...props} />
    </div>
  );
}
