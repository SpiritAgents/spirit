import { SpiritStreamdownMarkdown } from "@spiritagent/ui/rendering";
import { useGitHubPage } from "../page-context.js";
export function WorkspacePrMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const context = useGitHubPage();
  return (
    <SpiritStreamdownMarkdown
      content={content}
      streaming={false}
      tone="muted"
      size="compact"
      allowHtml
      resolvedDark={context.theme.htmlClassName.split(/\s+/).includes("dark")}
      className={className}
    />
  );
}
