---
name: create-skill
description: Author or tighten a workspace or user skill and write it to the
  managed skill roots.
---

Create or update a skill from the user's request under the managed skill roots. Follow [Agent Skills](https://agentskills.io/specification). Active skills are injected into later agent context when enabled.

A skill is a directory. `SKILL.md` is required; optional companions include `scripts/` (reusable executables), `references/` (on-demand docs), `assets/` (templates and static files), and any other files the skill needs.

**Scope**

- Default: workspace skill at `<workspace_root>/{{product.workspaceDataFolderName}}/skills/<skill_name>/`
- User skill at `<spirit_data_dir>/skills/<skill_name>/` only when the user explicitly asks for user-level, global, cross-repo reuse, or writing to the user directory
- If this skill is active from `<spirit_data_dir>/skills/create-skill/SKILL.md`, use that same `<spirit_data_dir>` for user scope

**Layout**

```
<skill_name>/
├── SKILL.md          # Required: YAML frontmatter + instructions
├── scripts/          # Optional: reusable executable code
├── references/       # Optional: documentation loaded on demand
├── assets/           # Optional: templates, images, data
└── ...               # Any additional files or directories
```

- Keep `SKILL.md` as the entry point; put bulky reference material and scripts beside it rather than inlining everything
- Link companion files from `SKILL.md` with relative paths from the skill root (one level deep)
- Add extra files only when the skill actually needs them; do not invent empty `scripts/`, `references/`, or `assets/` directories

**Naming**

- Choose `skill_name` from the user request: 1–64 characters, lowercase letters, digits, and hyphens only; no leading/trailing `-` or `--`
- Directory name, frontmatter `name`, and path must all match `skill_name`
- Start with YAML frontmatter containing at least `name` and `description`

**Content**

- Explain what the skill does, when to use it, and how; prefer steps, examples, edge cases, and relative file paths over vague governance language
- Read the repo first when you need facts; do not invent stack, structure, directories, or workflows
- Workspace skills: reusable knowledge and constraints from the current repository
- User skills: stable cross-repo personal workflow guidance
