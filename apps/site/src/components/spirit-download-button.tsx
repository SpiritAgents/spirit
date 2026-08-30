import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";
import { SPIRIT_LATEST_RELEASE_URL } from "@/lib/github-links";
import {
  resolveSpiritDownloadTarget,
  resolveSpiritPlatformDownloadUrl,
} from "@/lib/spirit-download-platform";
import { cn } from "@/lib/utils";

const SPIRIT_DOWNLOAD_BUTTON_CLASSNAME =
  "h-9 cursor-pointer rounded-full bg-primary px-4 text-primary-foreground hover:bg-primary/90";

type SpiritDownloadButtonVariant = "page" | "platform";

type SpiritDownloadButtonProps = Omit<ComponentProps<typeof Button>, "asChild" | "children"> & {
  children?: ReactNode;
  iconClassName?: string;
  /** Nav uses `page` → /download; hero/footer CTAs use `platform` for CDN package URL. */
  downloadVariant?: SpiritDownloadButtonVariant;
};

function useSpiritPlatformDownloadState() {
  const { messages } = useI18n();
  const [label, setLabel] = useState(messages.common.download);
  const [href, setHref] = useState(SPIRIT_LATEST_RELEASE_URL);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [target, url] = await Promise.all([
        resolveSpiritDownloadTarget(),
        resolveSpiritPlatformDownloadUrl(),
      ]);

      if (cancelled) {
        return;
      }

      setHref(url);
      setLabel(
        target ? messages.common.downloadForPlatform(target.platform) : messages.common.download,
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [messages]);

  return { label, href };
}

export function SpiritDownloadButton({
  children,
  className,
  iconClassName,
  downloadVariant = "page",
  ...props
}: SpiritDownloadButtonProps) {
  const { messages, localizedPath } = useI18n();
  const platformState = useSpiritPlatformDownloadState();

  if (downloadVariant === "page") {
    return (
      <Button
        asChild
        size="sm"
        className={cn(SPIRIT_DOWNLOAD_BUTTON_CLASSNAME, className)}
        {...props}
      >
        <Link href={localizedPath("/download")}>
          <Download className={cn("size-3.5", iconClassName)} aria-hidden />
          {children ?? messages.common.download}
        </Link>
      </Button>
    );
  }

  return (
    <Button
      asChild
      size="sm"
      className={cn(SPIRIT_DOWNLOAD_BUTTON_CLASSNAME, className)}
      {...props}
    >
      <a href={platformState.href} rel="noopener noreferrer">
        <Download className={cn("size-3.5", iconClassName)} aria-hidden />
        {children ?? platformState.label}
      </a>
    </Button>
  );
}
