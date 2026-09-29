"use client";

import { useEffect, type ReactNode } from "react";

import { installScrollHoverKeepalive } from "@spiritagent/ui/scroll-hover-keepalive";

import { ThemeProvider } from "@/components/theme-provider";
import type { AppLocale } from "@/i18n/config";
import { LocaleProvider } from "@/i18n/provider";
import { clearDemoWindowLayoutPrefs } from "@/lib/layout-prefs";

export function AppProviders({ locale, children }: { locale: AppLocale; children: ReactNode }) {
  useEffect(() => {
    clearDemoWindowLayoutPrefs();
    installScrollHoverKeepalive();
  }, []);

  return (
    <ThemeProvider>
      <LocaleProvider locale={locale}>{children}</LocaleProvider>
    </ThemeProvider>
  );
}
