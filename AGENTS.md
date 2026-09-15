# Spirit — Project Guidelines

## Layering and Specialized Guides

- Capability and host boundary: `.github/instructions/agent-core-host-boundary.instructions.md`
- Rust CLI: `.github/instructions/cli-rust.instructions.md`

## Branch Names

- When the change is scoped to a **single** app or package, the branch name **must** be `{type}/{scope}/{description}` (three slash-separated segments).
- Do **not** write `{type}/{scope}-{description}` (hyphen joining scope and description).
- `type`: Conventional Commits type (`feat`, `fix`, `refactor`, `style`, `chore`, `ci`, …).
- `scope`: the app or package (`desktop`, `cli`, `site`, `agent-core`, …), matching commit `scope`.
- `description`: short kebab-case summary.

✅ `fix/desktop/align-message-bubble-chips`

❌ `fix/desktop-align-message-bubble-chips`

Cross-cutting changes that touch multiple apps or packages omit the scope segment: `{type}/{description}`.

## Commit Messages

- Conventional Commits: `type` and optional `scope` are in English; **subject and body must be in English** (except code identifiers, paths, API names, etc.).
- `subject`: one-line summary in English, no trailing period.
- `body`: optional; describe **the content and impact of this change** (user-visible behavior, external semantics, compatibility, etc.) in English.
- **`body` format**: pick the format that fits the change. Both `-` bullet points (one item per line, no trailing period per item) and continuous prose paragraphs are acceptable — bullets suit summary-style lists of what changed; when a difficult fix needs its rationale explained, write a prose paragraph instead.
- **Describe only the diff against the parent commit**: both subject and body should describe what this commit actually changed and what impact it brings relative to the previous version; do not include iterative narrative from the current session.
- **Forbidden mismatched comparisons**: If code that was just added in the same commit and did not exist in the parent commit is later revised during the session, **do not** write in the subject or body things like "avoid duplication with existing X" or "switch to reading Y to remove duplication" — the parent commit has no X, and Git cannot see this relationship, so it is a mismatched description.
- `scope`: English, optional; represents a module, package, or subsystem, e.g. `cli`, `agent-core`, `desktop`, `tui`, `site`. Omit the parenthesis segment if no suitable scope.
- Multiple scopes: only use when the change cannot be split into multiple commits. Separate multiple scopes with a comma followed by a space, e.g. `(desktop, agent-core)`.
- Do not use multiple scopes to summarize "changed a lot of files" or as a substitute for splitting commits; multiple scopes are allowed only when multiple independent modules are genuinely modified and cannot be separated.
- If there are too many scopes, either reduce to the single most relevant scope or remove all scopes; do not stack a long list of scopes.

Example (`body`, bullet points):

```
feat(desktop): pin sidebar toggle button to the right of traffic lights

- Fixed-position the sidebar toggle button to the right edge of hiddenInset traffic lights in non-fullscreen mode
- Fall back to inline top-bar layout in fullscreen mode, reusing spirit-desktop-darwin-fullscreen styles
```

Example (`body`, prose — for fixes where the rationale needs a paragraph):

```
fix(desktop): recognize image and file clipboards as pasteable in the Edit menu

The contextual Edit menu gated Paste on clipboard.readText(), which is empty
for image-only and Finder file clipboards, so Paste stayed disabled and Cmd+V
never reached the composer. The probe now reads clipboard.availableFormats(),
and composer paste dispatches through Chromium's native paste so the existing
paste-event pipeline (image attachments, rich segments) runs unchanged.
```

❌ Mismatched: `add useDarwinWindowFullscreen to read html class and avoid duplicate Electron IPC subscriptions` — the parent commit had no duplicate subscriptions; this is a subsequent rewrite narrative from the session and is unrelated to the diff.

### Passing Multi-line Subjects / Bodies via Command Line

- **PowerShell**: use a literal here-string `@' … '@` passed to `git commit -m`
- **bash**: use `git commit -m "$(cat <<'EOF' … EOF)"`

PowerShell example:

```powershell
git commit -m @'
feat(desktop): example subject

- first body item
- second body item
'@
```

bash example:

```bash
git commit -m "$(cat <<'EOF'
feat(desktop): example subject

- first body item
- second body item
EOF
)"
```

## Pull Requests That Close Issues

- Apply this only when the PR is intended to close an Issue. Do not add a closer on unrelated PRs.
- After the description body (Summary, Test plan, and any other sections), end the PR description with a standalone last line: `Closed #N` or `Fixed #N`, where `N` is the Issue number. Leave a blank line above it.
- Do not embed the closing keyword in the title, Summary, or Test plan.

## General Conventions

- Run repo-local tools (`tsx`, `tsc`, `oxfmt`, `oxlint`, etc.) via `pnpm exec`, never `npx` — `npx` may hit the network; `pnpm exec` resolves from workspace `node_modules/.bin`.
- Prefer cross-platform compatibility (including Windows branches and conditional compilation).
- User-visible UI copy uses Title Case for short label-style text (labels, buttons, dialog titles, settings entries, menu items, etc.): capitalize the first and last word and all major words; short words (≤3 letters) are capitalized when they are content words (verbs, nouns, adverbs — e.g. `Log In`, `Sign Out`) and kept lowercase when they are function words (such as `at` / `in` / `for` / `of` / `to` / `on`) in the middle.
- Full sentences (confirmation prompts, descriptions, toast/notification messages, etc.) use Sentence case: capitalize only the first word and proper nouns.
- Brand names and proper nouns keep their canonical casing (e.g. `GitHub`, `macOS`, `GLM Coding Plan`) under both rules above.
- User-visible UI copy and natural-language comments use the Unicode ellipsis … (U+2026), not three ASCII periods; this does not apply to language syntax, path or API placeholders, or machine-readable truncation markers.
- When referencing existing implementations, prefer linking to source paths instead of repeating long explanations here.
- Unless explicitly required by the test target, avoid adding third-party products, services, models, or brand strings in unit tests, snapshots, fixtures, example inputs, etc.; prefer in-project semantics or neutral descriptions.
- This project is in very early development; if a change involves user configuration structure, persistence format, or migration strategy and requires significant adjustment, avoid stacking too many compatibility fallbacks. Prefer keeping the implementation directly evolvable, and clearly communicate to developers the reasons, costs, and future evolution space for doing so. Note that "early stage" only means fewer compatibility fallbacks are needed; **it does not mean avoiding significant changes** — restructure directly when necessary, rather than bypassing necessary refactoring for the sake of stability.

## Bug Fixes: Logs, Root Cause, No Multiple Safeguards

### Process

1. **Add logs first**: prioritize observable logs (level, key state, timing) on the reproduction path before changing logic; do not change code blindly without logs.
2. **Chase the root cause before fixing**: even if the symptom trigger point is located, still ask "why did it enter this state" in the current context, and fix the **root cause** rather than just patching the symptom.
3. **Verify after fixing**: use logs or tests to confirm the root cause is eliminated; temporary logs used only for debugging should be removed or downgraded to debug before merging.

### No "Multiple Safeguards"

Do not stack multiple fallback layers "just in case", for example:

- Repeated validation / retry / rewrite of the same semantics in multiple places
- `try/catch` swallowing errors at the symptom point plus another fallback upstream
- "Delete A and then patch B/C" without explaining why A would be missing

**Allowed**: a single, provably necessary boundary (e.g., external API parameter validation); you must explain in the PR / description why this is the only line of defense.

```typescript
// ❌ Multiple safeguards: DOM deletes chip, sync re-inserts, Backspace deletes, effect inserts again
if (agentMode === "plan" && !hasChip) reinsertChip();
if (backspace) removeChip();
useEffect(() => {
  if (agentMode === "plan") insertChip();
}, [agentMode]);

// ✅ Single source: config.agentMode drives the pin; Backspace only changes config, effect syncs UI
```

### Upstream / Unexplainable Logic

If a fix depends on third-party behavior, historical debt, or logic that cannot be fully understood:

- Add an **English** comment next to the workaround describing the phenomenon, known limitations, and why further investigation is not pursued.
- Do not use comments as a substitute for root-cause analysis; fix the root cause when possible.

```typescript
// Vercel Gateway /models only uses type=image to indicate image generation; inferring vision from tags is error-prone, so it is not used.
if (record.type === "image") {
  modelEntry.supportsImageGeneration = true;
}
```

## Agent / LLM Conventions

- Model-visible text sent to LLMs should default to English, including but not limited to system messages, tool definition summaries, tool descriptions, and evaluation copy; unless a mechanism explicitly requires another language, avoid mixing Chinese and English to minimize output quality fluctuations.
- **Model-visible copy details** (when to write system prompts, when to use only tool definitions / API `tools`, bad/good examples): see [`.github/instructions/llm-visible-copy.instructions.md`](.github/instructions/llm-visible-copy.instructions.md).
- When modifying model-visible behavior in `packages/agent-core`, such as large additions/deletions/changes to system messages, adding a new tool, or significant adjustments to tool summaries or descriptions, run an eval after implementation to observe the actual effect before deciding whether further tuning is needed.
- Only run additional evals for large changes; small wording fixes, spelling fixes, non-model-visible refactoring, or pure host implementation adjustments usually do not require extra evals.
- Do not over-design System Prompts, Tool Descriptions, or similar text; avoid verbosity. **Especially do not repeat capabilities already declared in the request `tools` field inside the system prompt** (it distracts and wastes context). Short, focused content that helps the LLM understand usually works better.

## Context Pre-loading (push) vs On-demand Pulling (pull)

When the host injects facts into the model context (cwd, git status, open files, directory tree, etc.), default to **pushing less**; longer context dilutes effective attention, and irrelevant tokens are not "harmless to leave there". The goal is to place the **smallest set with the highest signal density** where the model will actually read it.

### When to push (pre-load)

Must satisfy all of the following:

- **High signal**: used by most tasks
- **Low token cost**: usually a few to a few dozen tokens
- **Pull is not worthwhile**: the model usually will not ask for it, or a single tool round-trip costs far more than the fact itself

### When to pull (on demand)

- Large, task-variable, and unused in most turns
- Can be indexed by lightweight identifiers (paths, queries, URLs); the path/name itself is a relevance signal
- Content changes: pulling gets the latest; **a stale pre-loaded snapshot is worse than not pre-loading**

### Common Items in This Repo

- ✅ push: git branch, dirty state, project type, test commands (written to system by `buildBasicInfoSystemMessage`, wrapped in `<basic_info>` block)
- ✅ push (only when the user explicitly references a Skill this turn): full Skill text written to the `<active_skill>` meta of that user message, not into system
- ❌ push: full directory tree; pull on demand with `glob` / `grep`
- Open files: push only a **reference** (path + cursor/selection), not the full text; `read_file` when relevant

### Validation and Evolution

- The right balance moves with model capability, latency budget, and whether content is static or dynamic; **do not decide intuitively** whether a piece of context should be pushed.
- After changing model-visible context, use `pnpm run eval:compare` to compare push vs no-push and see if it translates into accuracy.
- Make "what to push" a tunable, measurable knob rather than a hardcoded fallback.
