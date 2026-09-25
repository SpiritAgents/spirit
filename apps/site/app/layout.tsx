import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Spirit",
  icons: {
    icon: [
      {
        url: "/favicon.svg",
        type: "image/svg+xml",
        sizes: "any",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/favicon-dark.svg",
        type: "image/svg+xml",
        sizes: "any",
        media: "(prefers-color-scheme: dark)",
      },
    ],
  },
};

/** Root layout passes through; locale layout owns `<html lang>`. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
