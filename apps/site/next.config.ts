import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: fileURLToPath(new URL("../..", import.meta.url)) },
  transpilePackages: ["@spiritagent/ui", "@spiritagent/icons"],
  async rewrites() {
    return [
      {
        source: "/:locale/docs.md",
        destination: "/llms.mdx/:locale/docs",
      },
      {
        source: "/:locale/docs/:path*.md",
        destination: "/llms.mdx/:locale/docs/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/install",
        headers: [
          { key: "Content-Type", value: "text/plain; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
      {
        source: "/install.ps1",
        headers: [
          { key: "Content-Type", value: "text/plain; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
      {
        source: "/:locale/index.md",
        headers: [{ key: "Content-Type", value: "text/markdown; charset=utf-8" }],
      },
      {
        source: "/:locale/download/index.md",
        headers: [{ key: "Content-Type", value: "text/markdown; charset=utf-8" }],
      },
    ];
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
