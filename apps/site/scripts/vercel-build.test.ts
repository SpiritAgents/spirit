import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Vercel runs `pnpm run build` in apps/site and does not go through Turbo.
// `dev` and `turbo run build` already build `@spiritagent/site^...` first;
// this script has to do the same or Node resolves `@spiritagent/product` to a
// missing dist/index.js while generating markdown companions.
test("production build builds workspace dependencies before it imports them", () => {
  const siteRoot = new URL("..", import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL("package.json", siteRoot), "utf8")) as {
    scripts: { build: string };
  };
  const vercel = JSON.parse(readFileSync(new URL("vercel.json", siteRoot), "utf8")) as {
    buildCommand: string;
  };
  const steps = pkg.scripts.build.split("&&").map((step) => step.trim());
  const dependencyBuild = steps.findIndex((step) => step.includes("@spiritagent/site^..."));
  const companions = steps.findIndex((step) => step.includes("generate-markdown-companions"));
  const nextBuild = steps.findIndex((step) => step === "next build");

  assert.equal(vercel.buildCommand, "pnpm run build");
  assert.equal(dependencyBuild, 0);
  assert.ok(companions > dependencyBuild);
  assert.ok(nextBuild > dependencyBuild);
});

test("OG route tracing escapes the catch-all route and includes only normal 400 fonts", () => {
  const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

  assert.ok(config.includes('"/og/\\\\[\\\\.\\\\.\\\\.slug\\\\]"'));
  assert.ok(config.includes('"../../node_modules/@fontsource/*/400.css"'));
  assert.ok(config.includes('"../../node_modules/@fontsource/*/files/*-400-normal.woff"'));
  assert.ok(!config.includes('"../../node_modules/@fontsource/*/files/*.woff"'));
});
