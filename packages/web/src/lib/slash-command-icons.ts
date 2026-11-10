import type { LucideIcon } from "lucide-react";
import {
  Bug,
  ClipboardList,
  FoldVertical,
  GitFork,
  MessageCircle,
  MessageCircleQuestionMark,
  Repeat,
  ScrollText,
  Sparkles,
} from "lucide-react";

import type { SkillSlashSuggestionKind } from "@spiritagent/ui/composer";

export const SLASH_SUGGESTION_ICONS: Record<SkillSlashSuggestionKind, LucideIcon> = {
  "export-session": ScrollText,
  compact: FoldVertical,
  fork: GitFork,
  "side-chat": MessageCircle,
  loop: Repeat,
  plan: ClipboardList,
  ask: MessageCircleQuestionMark,
  debug: Bug,
  skill: Sparkles,
};
