import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(join(here, "../../../ui/src/theme.css"), "utf8");
const stylesCss = readFileSync(join(here, "../../src/styles.css"), "utf8");

test("AnimatedCollapse's motion ships with the shared theme, not with one host's stylesheet", () => {
  for (const name of ["spirit-collapsible-down", "spirit-collapsible-up"]) {
    assert.match(themeCss, new RegExp(String.raw`--animate-${name}:\s*${name} \d+ms`));
    assert.match(themeCss, new RegExp(String.raw`@keyframes ${name}\s*\{`));
    // A host copy would shadow the theme's keyframes and drift from them.
    assert.doesNotMatch(stylesCss, new RegExp(String.raw`@keyframes ${name}\b`));
    assert.doesNotMatch(stylesCss, new RegExp(String.raw`--animate-${name}:`));
  }
  assert.match(stylesCss, /@import "@spiritagent\/ui\/theme\.css";/);
});

test("reduced motion ends the collapse animation at once instead of removing it", () => {
  const rule = themeCss.match(
    /html\.spirit-reduce-motion \[data-slot="animated-collapse-content"\]\s*\{([^}]*)\}/,
  );
  assert.ok(rule, "expected the reduced-motion rule for AnimatedCollapse content");
  // A zero-length animation still fires animationend, so the component settles and drops its
  // animation class. `animation: none` never ends: the class stayed and the animation
  // replayed on every open section when the setting was switched off.
  assert.match(rule[1], /animation-duration:\s*0s\s*!important/);
  assert.doesNotMatch(rule[1], /animation:\s*none/);
  const reducedBlock = stylesCss.slice(stylesCss.indexOf("  html.spirit-reduce-motion {"));
  assert.doesNotMatch(reducedBlock, /animated-collapse-content/);
});
