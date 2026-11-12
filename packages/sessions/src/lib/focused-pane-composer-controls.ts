export type FocusedPaneComposerControls = {
  focusComposer: () => void;
  setComposerText: (text: string) => void;
  setSlashSelectedIndex: (index: number) => void;
  prefillSkillChip: (skillName: string) => void;
};
