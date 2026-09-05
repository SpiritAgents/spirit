/**
 * Skill markdown format helpers (SKILL.md frontmatter parsing and skill-name
 * rules). Single source of truth for the extension package layout contract;
 * host-internal re-exports these for its discovery code paths.
 *
 * Pure string utilities: no Node built-ins, safe for any consumer.
 */

export const SKILLS_DIR_NAME = "skills";
export const SKILL_FILE_NAME = "SKILL.md";
export const SKILL_NAME_MAX_CHARS = 64;

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

export function isSkillMarkdownPath(path: string): boolean {
  return pathBasename(path) === SKILL_FILE_NAME;
}

export function splitSkillFrontmatter(
  raw: string,
): { frontmatter: string; body: string } | undefined {
  const content = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const segments = content.split(/\r?\n/u);
  if (segments[0] !== "---") {
    return undefined;
  }

  let closingIndex = -1;
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index] === "---") {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex < 0) {
    return undefined;
  }

  return {
    frontmatter: segments.slice(1, closingIndex).join("\n"),
    body: segments.slice(closingIndex + 1).join("\n"),
  };
}

export function unquoteYamlScalar(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }

  return value;
}

export function parseSkillFrontmatterFields(frontmatter: string): {
  name?: string;
  description?: string;
} {
  const parsed: { name?: string; description?: string } = {};
  for (const line of frontmatter.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    if (line.startsWith(" ") || line.startsWith("\t")) {
      continue;
    }

    if (parsed.name === undefined && trimmed.startsWith("name:")) {
      parsed.name = unquoteYamlScalar(trimmed.slice("name:".length).trim());
      continue;
    }
    if (parsed.description === undefined && trimmed.startsWith("description:")) {
      parsed.description = unquoteYamlScalar(trimmed.slice("description:".length).trim());
    }
  }

  return parsed;
}

/** Returns an error message when invalid, undefined when valid. */
export function validateSkillName(name: string): string | undefined {
  if (!name || [...name].length > SKILL_NAME_MAX_CHARS) {
    return `skill-name must be 1-${SKILL_NAME_MAX_CHARS} characters`;
  }
  if (name.startsWith("-") || name.endsWith("-")) {
    return "skill-name must not start or end with a hyphen";
  }
  if (name.includes("--")) {
    return "skill-name must not contain consecutive hyphens";
  }
  if (![...name].every((character) => /[a-z0-9-]/u.test(character))) {
    return "skill-name only allows lowercase letters, digits, and hyphens";
  }

  return undefined;
}
