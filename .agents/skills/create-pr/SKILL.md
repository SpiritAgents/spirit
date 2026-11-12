---
name: create-pr
description: Research and create a GitHub pull request on SpiritAgents/spirit using the GitHub CLI. Use when the user asks to create, open, file, or draft a pull request for Spirit work on a branch.
---

# Create Pull Request

Create a GitHub pull request on `SpiritAgents/spirit` with the GitHub CLI (`gh`), following the repository's pull request template. The goal is a description a reviewer can act on without a follow-up round of questions.

## Workflow

1. **Understand the change.** Read the current branch's diff against its base (usually `main`): what landed, why, and which packages or apps it touches. Collect concrete facts (`path:line` references, commands actually run). The description should read as written by someone who knows the code.
   - Do not browse existing GitHub pull requests for style or structure; the template below already defines both, and reading pull requests wastes time.
2. **Clarify before writing.** If the base branch or whether this pull request should close an Issue is still unclear, ask the user with the harness's ask-question tool. When the change is visible and a before state cannot be reproduced from this branch alone, ask for that too.
3. **Draft from the template.** Read `.github/pull_request_template.md` and follow its section structure. Fill sections that have real content; drop **Changes** when there is nothing to compare. Write the title and body in English. The title follows Conventional Commits, in the same shape as commit subjects in `AGENTS.md`.

   Answer **What does this pull request do?** in complete sentences: what changed, why, and — when it matters — what was intentionally left alone. The Test plan lists what you actually ran, and mentions anything relevant that was not run.

4. **Create the pull request** (see below) and report the pull request URL to the user.

If the work is a large feature, a public API or persistence change, or a change to agent-visible behavior, and there is no Issue yet, mention that to the user before opening the pull request — `CONTRIBUTING.md` asks for an Issue first on work of that size. Smaller, focused changes can go straight to a pull request. When the change includes substantial model-visible copy in `packages/agent-core`, include `pnpm run eval:compare` in the Test plan when it was run.

When the pull request is meant to close an Issue, end the body with a standalone last line `Closed #N` or `Fixed #N`, with a blank line above it. Keep that closer as the last line of the body, not in the title or other sections.

## Changes

Fill the **Changes** section with a Before / After table, one comparison per row (several rows are fine). Screenshots and plain text both belong in this table.

- When the change is visible in the product and this harness can capture the screen — for example via Computer Use or Browser Use, or another screenshot path available in the session — put a screenshot of the prior state and a screenshot of the new state in the table. For motion, transitions, or Agent streaming UI, use a short video. If the change is large, capture representative moments rather than every path.
- When there is no interface change, or this session does not have permission, or the current harness cannot take those screenshots, describe the before and after in plain text in the same table. Behavior-only fixes belong here too. For example, a pull request that addresses a harness defect where the model tended to do an unexpected A rather than the expected B can put those two behaviors in the Before and After cells.
- Prefer referencing a local media path in the body so `gh` can rewrite it, for example `![Composer before the chip alignment](./before.png)`.
- A video plays inline only when its image reference is the only content in a paragraph, so place videos just under the table rather than inside a cell:

```markdown
## Changes

| Before                                                            | After                                             |
| ----------------------------------------------------------------- | ------------------------------------------------- |
| ![Composer before the chip alignment](./before.png)               | ![Composer after the chip alignment](./after.png) |
| The model tended to do A, the unexpected path, when the harness … | The model does B, the expected path               |

Streaming reply, last token preserved:

![](./streaming-fix.mp4)
```

Supported upload types are PNG, JPEG, GIF, WebP, SVG, and MP4, MOV, or WebM video (H.264 is the most widely playable). Images and GIFs are limited to 10 MB. Video is limited to 10 MB when the repository owner is on a free GitHub plan, and 100 MB when the owner is on a paid plan. Uploading a video larger than 10 MB to a paid-plan repository also requires that the uploader is an organization member, an outside collaborator, or on a paid plan.

## Creating the Pull Request

Always target the repository explicitly with `--repo SpiritAgents/spirit`. Pass the body entirely in memory — never write it to a temp file.

bash (heredoc):

```bash
gh pr create --repo SpiritAgents/spirit \
  --title "fix(desktop): align message bubble chips" \
  --body "$(cat <<'EOF'
## What does this pull request do?
...
EOF
)"
```

PowerShell (literal here-string):

```powershell
gh pr create --repo SpiritAgents/spirit --title "fix(desktop): align message bubble chips" --body @'
## What does this pull request do?
...
'@
```

Add `--attach` on the same command when there are local images or videos (see Attachments). Add `--draft` only when the user asks for a draft.

## Labels and Milestones (Internal Collaborators Only)

This section applies only when the user is an internal collaborator. Check once:

```bash
gh api repos/SpiritAgents/spirit --jq .permissions
```

Treat `push` or `triage` being `true` as an internal collaborator; otherwise skip labels and milestones entirely.

- **Labels**: list existing labels with `gh label list --repo SpiritAgents/spirit`, choose the ones that fit the content, and pass each with `--label <name>`.
- **Milestones**: default to none — do not list or add one unless the user explicitly asks (e.g. "Add 1.0.0 milestone"). When asked, list open milestones with `gh api repos/SpiritAgents/spirit/milestones --jq '.[].title'`, confirm the target with the user, then pass `--milestone <name>`.

## Attachments (Images and Videos)

`--attach` requires push (write) access, so this section is internal-collaborator-only, and additionally requires `gh --version` 2.99.0 or newer. `triage` is not enough for uploads.

- Repeatable flag, up to 50 files per command: `--attach './after.png#Composer after the chip alignment'`. Text after `#` becomes the image alt text (the filename is used without it); videos render as a player and take no alt text.
- Prefer referencing the local path in the body where the image or video belongs — `gh` rewrites that reference to the uploaded URL in place, including when the body is passed with `--body`. Attached files the body does not reference are appended to the end of the body.
- If some attachments fail to upload, the pull request is still created with the ones that succeeded; the command exits non-zero but still prints the new pull request's URL — check the output before retrying anything.

When the user is not an internal collaborator, the GitHub CLI cannot upload to `SpiritAgents/spirit` (push / write permission is required). Create the pull request with the text body, then tell the user they can drag images and videos into the pull request in the GitHub web UI — that path is available to anyone who can open or comment on the pull request, including authors working from a fork.

## Output

Print the created pull request URL and a one-line summary (whether it closes an Issue, whether media was attached, labels if any, milestone if any).
