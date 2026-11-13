import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createOpticalLogoSvg } from "./optical-logo.js";

const dark = fs.readFileSync(new URL("../assets/logo-dark.svg", import.meta.url), "utf8");
const light = fs.readFileSync(new URL("../assets/logo-light.svg", import.meta.url), "utf8");

function opticalTag(svg, role) {
  const pattern = new RegExp(`<(?:path|feGaussianBlur)\\b[^>]*data-optical="${role}"[^>]*>`);
  const tag = svg.match(pattern)?.[0];
  assert.ok(tag, `Missing optical role ${role}`);
  return tag;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  assert.ok(match, `Missing ${name}: ${tag}`);
  return match[1];
}

test("small sizes receive independent stroke, glow, and opacity compensation", () => {
  const svg = createOpticalLogoSvg(dark, 32);
  assert.match(svg, /width="32" height="32"/);

  const crisp = opticalTag(svg, "crisp-stroke");
  assert.equal(attribute(crisp, "stroke-width"), "4.5471");
  assert.equal(attribute(crisp, "stroke-opacity"), "0.92");

  const soft = opticalTag(svg, "soft-stroke");
  assert.equal(attribute(soft, "stroke-width"), "9.0943");
  assert.equal(attribute(soft, "stroke-opacity"), "0.3438");
  assert.equal(attribute(soft, "opacity"), "0.57");

  assert.equal(attribute(opticalTag(svg, "blur-sm"), "stdDeviation"), "9.0943");
  assert.equal(attribute(opticalTag(svg, "blur-md"), "stdDeviation"), "24.2515");
});

test("light and dark palettes retain separate opacity values", () => {
  const darkSoft = opticalTag(createOpticalLogoSvg(dark, 32), "soft-stroke");
  const lightSoft = opticalTag(createOpticalLogoSvg(light, 32), "soft-stroke");
  assert.equal(attribute(darkSoft, "stroke-opacity"), "0.3438");
  assert.equal(attribute(lightSoft, "stroke-opacity"), "0.215");
});

test("master and larger sizes preserve the source geometry", () => {
  for (const size of [512, 1024]) {
    const svg = createOpticalLogoSvg(dark, size);
    assert.match(svg, new RegExp(`width="${size}" height="${size}"`));
    assert.equal(attribute(opticalTag(svg, "crisp-stroke"), "stroke-width"), "0.75");
    assert.equal(attribute(opticalTag(svg, "blur-md"), "stdDeviation"), "4");
  }
});

test("invalid sizes are rejected", () => {
  assert.throws(() => createOpticalLogoSvg(dark, 0), /positive finite number/);
  assert.throws(() => createOpticalLogoSvg(dark, Number.NaN), /positive finite number/);
});
