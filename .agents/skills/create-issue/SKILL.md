---
name: create-issue
description: Research and create a detailed GitHub issue (bug report or feature request) on SpiritAgents/spirit using the GitHub CLI. Use when the user asks to file, create, open, or draft an issue for a Spirit bug, problem, or feature idea.
---

# Create Issue

Create a GitHub issue on `SpiritAgents/spirit` with the GitHub CLI (`gh`), following the repository's issue templates. The goal is an issue a developer can act on without a follow-up round of questions.

## Workflow

1. **Understand the request.** The user describes a bug they hit or a feature they want. Classify it as a bug report or a feature request.
2. **Research the codebase.** Before drafting, deeply explore the parts of this project related to the request (Glob / Grep / Read): locate the relevant files, understand the current behavior and recent changes, and collect concrete facts (`path:line` references, existing patterns to reuse). The issue should read as written by someone who knows the code.
   - Do not browse existing GitHub issues for style or structure; the templates below already define both, and reading issues wastes time.
3. **Research upstream when relevant.** If a bug may involve an upstream package (e.g. Electron, Chromium, ratatui, an AI SDK), use the harness's web search / web fetch tools to look for upstream issues, PRs, and release notes. Cite what you find with links so developers can trace the clue.
4. **Clarify before writing.** If the request is ambiguous, contradictory, or missing key facts (reproduction steps, expected behavior, scope), ask the user with the harness's ask-question tool. Do not guess.
5. **Draft from the template.** Read the matching template and follow its section structure exactly:
   - Bug: `.github/ISSUE_TEMPLATE/bug_report.md`
   - Feature: `.github/ISSUE_TEMPLATE/feature_request.md`

   Fill the required sections with the researched facts. Optional sections exist for deep-dive content — include one only when there is real content for it, and drop it otherwise. Write the title and body in English.

6. **Create the issue** (see below) and report the issue URL to the user.

## Creating the Issue

Always target the repository explicitly with `--repo SpiritAgents/spirit`. Pass the body entirely in memory — never write it to a temp file.

bash (heredoc):

```bash
gh issue create --repo SpiritAgents/spirit \
  --title "Concise English title" \
  --body "$(cat <<'EOF'
## Description
...
EOF
)"
```

PowerShell (literal here-string):

```powershell
gh issue create --repo SpiritAgents/spirit --title "Concise English title" --body @'
## Description
...
'@
```

## Labels and Milestones (Internal Collaborators Only)

This section applies only when the user is an internal collaborator. Check once:

```bash
gh api repos/SpiritAgents/spirit --jq .permissions
```

Treat `push` or `triage` being `true` as an internal collaborator; otherwise skip labels and milestones entirely.

- **Labels**: list existing labels with `gh label list --repo SpiritAgents/spirit`, choose the ones that fit the content, and pass each with `--label <name>`.
- **Milestones**: default to none — do not list or add one unless the user explicitly asks (e.g. "Add 1.0.0 milestone"). When asked, list open milestones with `gh api repos/SpiritAgents/spirit/milestones --jq '.[].title'`, confirm the target with the user, then pass `--milestone <name>`.

## Attachments (Images and Videos)

`--attach` requires push (write) access, so this section is internal-collaborator-only, and additionally requires `gh --version` 2.99.0 or newer.

- Repeatable flag, up to 50 files per command: `--attach './repro.png#The error state'`. Text after `#` becomes the image alt text (the filename is used without it); videos render as a player and take no alt text.
- Prefer referencing the local path in the body where the image belongs, e.g. `![The error state](./repro.png)` — gh rewrites that reference to the uploaded URL in place. Attached files the body does not reference are appended to the end of the body.
- If some attachments fail to upload, the issue is still created with the ones that succeeded; the command exits non-zero but still prints the new issue's URL — check the output before retrying anything.

When the user is not an internal collaborator, the GitHub CLI cannot upload images (push / write permission is required). Tell the user to attach images through the GitHub web UI instead.

## Output

Print the created issue URL and a one-line summary (template used, labels, milestone if any).
