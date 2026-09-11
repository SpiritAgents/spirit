import { llms } from "fumadocs-core/source";

import { getSiteOrigin } from "@/content/site-document";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { source } from "@/lib/source";

export const revalidate = false;

function withFullDocsPointer(index: string): string {
  const origin = getSiteOrigin();
  const pointer = `The complete documentation is available at [${origin}/llms-full.txt](${origin}/llms-full.txt).`;
  const headerBreak = index.indexOf("\n\n");
  return `${index.slice(0, headerBreak)}\n\n${pointer}${index.slice(headerBreak)}`;
}

export function GET() {
  return new Response(withFullDocsPointer(llms(source).index(DEFAULT_LOCALE)), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
