"use client";

import { Search } from "@spiritagent/icons/search";
import { useSearchContext } from "fumadocs-ui/contexts/search";

import { Kbd } from "@/components/ui/kbd";
import { useI18n } from "@/i18n/provider";
import { FONT_WEIGHT_NORMAL } from "@/lib/typography";
import { cn } from "@/lib/utils";

export function DocsSearch() {
  const { enabled, hotKey, setOpenSearch } = useSearchContext();
  const { messages } = useI18n();

  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={() => setOpenSearch(true)}
      aria-label={messages.docs.search}
      className={cn(
        "group inline-flex cursor-pointer items-center justify-center rounded-md outline-none",
        "size-8 text-foreground sm:h-8 sm:w-auto sm:gap-2 sm:px-2 sm:text-[13px] sm:text-foreground/50",
        FONT_WEIGHT_NORMAL,
        "sm:hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <Search className="size-4 opacity-50 transition-opacity group-hover:opacity-100 sm:hidden" />
      <span className="hidden sm:inline">{messages.docs.search}</span>
      <Kbd className="hidden bg-foreground/8 text-foreground/45 sm:inline-flex">
        {hotKey.map((item, index) => (
          <span key={index}>{item.display}</span>
        ))}
      </Kbd>
    </button>
  );
}
