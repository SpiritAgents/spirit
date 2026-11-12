import { existsSync } from "node:fs";
import path from "node:path";

export function resolveRendererDistPath(electronDir: string): string {
  const candidates = [
    path.join(electronDir, "..", "..", "node_modules", "@spiritagent", "web", "dist"),
    path.join(electronDir, "..", "..", "..", "..", "packages", "web", "dist"),
    path.join(process.cwd(), "packages", "web", "dist"),
  ];

  return (
    candidates.find((candidate) => existsSync(path.join(candidate, "index.html"))) ?? candidates[0]!
  );
}
