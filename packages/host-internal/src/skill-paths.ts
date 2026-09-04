/**
 * Skill path constants and pure path utilities (no Node built-in dependencies; safe to import from the Desktop renderer).
 *
 * Format-level helpers (SKILL.md frontmatter parsing, skill-name rules) live
 * in `@spiritagent/marketplace-toolkit` as the single source of truth for the
 * extension package layout contract; they are re-exported here so existing
 * call sites keep working.
 */

import {
  isSkillMarkdownPath,
  parseSkillFrontmatterFields,
  splitSkillFrontmatter,
  unquoteYamlScalar,
} from "@spiritagent/marketplace-toolkit";

export {
  isSkillMarkdownPath,
  parseSkillFrontmatterFields,
  SKILL_FILE_NAME,
  SKILLS_DIR_NAME,
  splitSkillFrontmatter,
} from "@spiritagent/marketplace-toolkit";

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}

function pathSegments(path: string): string[] {
  return normalizePath(path).split("/").filter(Boolean);
}

function pathBasename(path: string): string {
  const segments = pathSegments(path);
  if (segments.length === 0) {
    return normalizePath(path);
  }
  return segments[segments.length - 1] ?? normalizePath(path);
}

/** Parse top-level `name:` from SKILL.md YAML frontmatter; tolerates incomplete closing `---`. */
export function parseSkillNameFromMarkdown(raw: string): string | undefined {
  const split = splitSkillFrontmatter(raw);
  if (split) {
    const name = parseSkillFrontmatterFields(split.frontmatter).name?.trim();
    if (name) {
      return name;
    }
  }

  const content = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  if (!content.startsWith("---")) {
    return undefined;
  }

  for (const line of content.split(/\r?\n/u).slice(1)) {
    if (line === "---") {
      break;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("name:")) {
      const name = unquoteYamlScalar(trimmed.slice("name:".length).trim()).trim();
      return name || undefined;
    }
  }

  return undefined;
}

/** Line prefix from host read_file tool output: `     1 | content` */
const READ_FILE_TOOL_OUTPUT_LINE = /^\s*\d+\s*\|\s?(.*)$/u;

function stripReadFileToolOutputWrapper(output: string): string | undefined {
  if (!output.trimStart().startsWith("[read]")) {
    return undefined;
  }

  const bodyLines: string[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = READ_FILE_TOOL_OUTPUT_LINE.exec(line);
    if (match) {
      bodyLines.push(match[1] ?? "");
    }
  }
  return bodyLines.length > 0 ? bodyLines.join("\n") : undefined;
}

function readFileSkillDisplayName(skillMarkdownContent?: string): string | undefined {
  if (!skillMarkdownContent?.trim()) {
    return undefined;
  }
  const fromRaw = parseSkillNameFromMarkdown(skillMarkdownContent);
  if (fromRaw) {
    return fromRaw;
  }
  const stripped = stripReadFileToolOutputWrapper(skillMarkdownContent);
  if (stripped) {
    return parseSkillNameFromMarkdown(stripped);
  }
  return undefined;
}

function workspaceRelativeDirectoryPath(path: string, workspaceRoot: string): string | undefined {
  const pathSegs = pathSegments(path);
  const rootSegs = pathSegments(workspaceRoot);
  if (pathSegs.length < rootSegs.length) {
    return undefined;
  }
  for (let i = 0; i < rootSegs.length; i += 1) {
    if (pathSegs[i]!.toLowerCase() !== rootSegs[i]!.toLowerCase()) {
      return undefined;
    }
  }
  const relativeSegs = pathSegs.slice(rootSegs.length);
  if (relativeSegs.length === 0) {
    return ".";
  }
  let relative = relativeSegs.join("/");
  if (normalizePath(path).endsWith("/") && relative) {
    relative += "/";
  }
  return relative;
}

/** Path shown on the ls tool card: relative path inside the workspace, absolute path outside it. */
export function lsToolDisplayPath(
  path: string,
  workspaceRoot: string | undefined,
  emptyLabel: string,
): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return emptyLabel;
  }

  const normalized = normalizePath(trimmed);
  const root = workspaceRoot?.trim();
  if (root) {
    const relative = workspaceRelativeDirectoryPath(normalized, root);
    if (relative !== undefined) {
      return relative;
    }
  }

  return normalized;
}

/** Right-side detail of the read_file tool card: SKILL.md shows only the frontmatter name. */
export function readFileToolDisplayBase(
  path: string,
  emptyLabel: string,
  options?: { skillMarkdownContent?: string },
): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return emptyLabel;
  }
  if (isSkillMarkdownPath(trimmed)) {
    return readFileSkillDisplayName(options?.skillMarkdownContent) ?? "";
  }

  const normalized = normalizePath(trimmed);
  const absolute = normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized);
  if (!absolute) {
    return normalized;
  }
  return pathBasename(normalized);
}
