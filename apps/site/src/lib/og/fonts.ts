import fs from "node:fs/promises";
import path from "node:path";

import type { AppLocale } from "@/i18n/config";

const MONOREPO_ROOT = path.resolve(process.cwd(), "../..");

const PACKAGE_CSS_PATHS: Record<string, string> = {
  "@fontsource/inter": path.join(MONOREPO_ROOT, "node_modules/@fontsource/inter/400.css"),
  "@fontsource/noto-sans-sc": path.join(
    MONOREPO_ROOT,
    "node_modules/@fontsource/noto-sans-sc/400.css",
  ),
  "@fontsource/noto-sans-tc": path.join(
    MONOREPO_ROOT,
    "node_modules/@fontsource/noto-sans-tc/400.css",
  ),
  "@fontsource/noto-sans-jp": path.join(
    MONOREPO_ROOT,
    "node_modules/@fontsource/noto-sans-jp/400.css",
  ),
  "@fontsource/noto-sans-kr": path.join(
    MONOREPO_ROOT,
    "node_modules/@fontsource/noto-sans-kr/400.css",
  ),
};

type UnicodeRange = [start: number, end: number];

export type FontRecord = {
  family: string;
  filePath: string;
  ranges: UnicodeRange[];
};

export type OgFont = {
  name: string;
  data: Buffer;
  weight: 400;
  style: "normal";
};

export type OgFontSet = {
  fonts: OgFont[];
  fontFamily: string;
  text: string;
};

const manifestCache = new Map<string, Promise<FontRecord[]>>();
const bufferCache = new Map<string, Promise<Buffer>>();

const CJK_PACKAGES: Partial<Record<AppLocale, string>> = {
  "zh-CN": "@fontsource/noto-sans-sc",
  "zh-TW": "@fontsource/noto-sans-tc",
  ja: "@fontsource/noto-sans-jp",
  ko: "@fontsource/noto-sans-kr",
};

function parseUnicodeRanges(value: string): UnicodeRange[] {
  return value.split(",").map((part) => {
    const normalized = part.trim().replace(/^U\+/i, "");
    const [start, end] = normalized.split("-").map((hex) => Number.parseInt(hex, 16));
    return [start, end ?? start];
  });
}

export function parseFontCss(css: string, cssPath: string): FontRecord[] {
  const records: FontRecord[] = [];
  for (const match of css.matchAll(/@font-face\s*{([^}]+)}/g)) {
    const block = match[1];
    const family = block.match(/font-family:\s*['"]([^'"]+)['"]/)?.[1];
    const source = block.match(/url\(['"]?([^)'"]+\.woff)['"]?\)/)?.[1];
    const unicodeRange = block.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (!family || !source || !unicodeRange) continue;
    records.push({
      family,
      filePath: path.resolve(path.dirname(cssPath), source),
      ranges: parseUnicodeRanges(unicodeRange),
    });
  }
  return records;
}

function covers(record: FontRecord, codePoint: number): boolean {
  return record.ranges.some(([start, end]) => start <= codePoint && codePoint <= end);
}

function isCovered(records: FontRecord[], character: string): boolean {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return false;
  return records.some((record) => covers(record, codePoint));
}

export function sanitizeOgText(text: string, records: FontRecord[]): string {
  return Array.from(text, (character) => {
    if (/\p{Extended_Pictographic}/u.test(character)) return "�";
    if (/\s/.test(character)) return character;
    return isCovered(records, character) ? character : "�";
  }).join("");
}

function selectRecords(records: FontRecord[], text: string): FontRecord[] {
  return records.filter((record) =>
    Array.from(text).some((character) => isCovered([record], character)),
  );
}

async function loadManifest(packageName: string): Promise<FontRecord[]> {
  let pending = manifestCache.get(packageName);
  if (!pending) {
    const cssPath = PACKAGE_CSS_PATHS[packageName];
    if (!cssPath) throw new Error(`Unknown OG font package: ${packageName}`);
    pending = fs.readFile(cssPath, "utf8").then((css) => parseFontCss(css, cssPath));
    manifestCache.set(packageName, pending);
  }
  return pending;
}

function readFontBuffer(filePath: string): Promise<Buffer> {
  let pending = bufferCache.get(filePath);
  if (!pending) {
    pending = fs.readFile(filePath);
    bufferCache.set(filePath, pending);
  }
  return pending;
}

export async function loadOgFonts(text: string, locale: AppLocale): Promise<OgFontSet> {
  const packages = ["@fontsource/inter", CJK_PACKAGES[locale]].filter(
    (packageName): packageName is string => Boolean(packageName),
  );
  const manifests = await Promise.all(packages.map(loadManifest));
  const records = manifests.flat();
  const sanitizedText = sanitizeOgText(text, records);
  const selected = selectRecords(records, sanitizedText);
  const fonts = await Promise.all(
    selected.map(async (record) => ({
      name: record.family,
      data: await readFontBuffer(record.filePath),
      weight: 400 as const,
      style: "normal" as const,
    })),
  );
  const fontFamily = [...new Set(selected.map((record) => record.family))].join(", ");
  return { fonts, fontFamily, text: sanitizedText };
}
