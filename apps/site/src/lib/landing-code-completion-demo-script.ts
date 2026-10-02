export const COMPLETION_DEMO_FILE_PATH = "apps/desktop/src/lib/completion-journal.ts";

export const COMPLETION_DEMO_TAB_LABEL = "completion-journal.ts";

/** Code the user has already typed — cursor sits at end of the open brace line. */
export const COMPLETION_DEMO_BASE = `export class CompletionJournal {
  private entries: JournalEntry[] = [];

  append(entry: JournalEntry): void {
`;

/** Each step: one full ghost suggestion, then Tab merges it into solid text. */
export const COMPLETION_DEMO_STEPS = [
  {
    ghost: `    this.entries.push(entry);
    await this.persist();
  }

`,
  },
  {
    ghost: `  private async persist(): Promise<void> {
    // flushed to workspace journal
  }
}
`,
  },
] as const;

export const COMPLETION_DEMO_INITIAL_DELAY_MS = 900;
export const COMPLETION_DEMO_GHOST_HOLD_MS = 720;
export const COMPLETION_DEMO_STEP_GAP_MS = 550;
export const COMPLETION_DEMO_FINAL_HOLD_MS = 2400;
export const COMPLETION_DEMO_RESET_FADE_MS = 280;
export const COMPLETION_DEMO_RESET_MS = 650;

export function buildCompletionDemoSolidText(acceptedStepCount: number): string {
  let text = COMPLETION_DEMO_BASE;
  for (let i = 0; i < acceptedStepCount; i++) {
    text += COMPLETION_DEMO_STEPS[i]!.ghost;
  }
  return text;
}

export function getCompletionDemoGhostText(
  acceptedStepCount: number,
  ghostVisible: boolean,
): string | null {
  if (!ghostVisible || acceptedStepCount >= COMPLETION_DEMO_STEPS.length) {
    return null;
  }
  return COMPLETION_DEMO_STEPS[acceptedStepCount]!.ghost;
}

export type LandingEditorTreeNode = {
  name: string;
  kind: "dir" | "file";
  children?: LandingEditorTreeNode[];
  selected?: boolean;
};

export const COMPLETION_DEMO_FILE_TREE: LandingEditorTreeNode = {
  name: product.name,
  kind: "dir",
  children: [
    {
      name: "apps",
      kind: "dir",
      children: [
        {
          name: "desktop",
          kind: "dir",
          children: [
            {
              name: "src",
              kind: "dir",
              children: [
                {
                  name: "lib",
                  kind: "dir",
                  children: [
                    { name: "completion-journal.ts", kind: "file", selected: true },
                    { name: "monaco-theme.ts", kind: "file" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "packages",
      kind: "dir",
      children: [{ name: "agent-core", kind: "dir" }],
    },
    { name: "README.md", kind: "file" },
    { name: "package.json", kind: "file" },
  ],
};
import { product } from "@spiritagent/product";
