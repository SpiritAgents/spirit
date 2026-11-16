import {
  SpiritStreamdownMarkdown as SharedMarkdown,
  type SpiritStreamdownMarkdownProps as SharedProps,
} from "@spiritagent/ui/rendering/spirit-streamdown-markdown";
import { useTheme } from "@/hooks/useTheme";
export { spiritStreamdownControls } from "@spiritagent/ui/rendering/spirit-streamdown-markdown";
export type SpiritStreamdownMarkdownProps = Omit<SharedProps, "resolvedDark">;
export function SpiritStreamdownMarkdown(props: SpiritStreamdownMarkdownProps) {
  const { resolvedDark } = useTheme();
  return <SharedMarkdown {...props} resolvedDark={resolvedDark} />;
}
