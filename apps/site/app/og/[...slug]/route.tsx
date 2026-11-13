import { resolveOgModel } from "@/lib/og/resolver";
import { renderOgImage } from "@/lib/og/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ slug: string[] }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const [locale = "", ...segments] = slug;
  const model = resolveOgModel(locale, segments);
  if (!model) return new Response("Not Found", { status: 404 });
  return renderOgImage(model);
}
