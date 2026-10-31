import { ChevronDown } from "@spiritagent/icons/chevron-down";

import { workspaceExplorerIcon } from "@/lib/workspace-explorer-icon";
import type { LandingEditorTreeNode } from "@/lib/landing-code-completion-demo-script";
import { cn } from "@/lib/utils";

type LandingEditorFileTreeProps = {
  root: LandingEditorTreeNode;
  className?: string;
};

function TreeNode({ node, depth }: { node: LandingEditorTreeNode; depth: number }) {
  const Icon = workspaceExplorerIcon(node.name, node.kind);
  const isDir = node.kind === "dir";
  const paddingLeft = 6 + depth * 9;

  return (
    <>
      <div
        className={cn(
          "flex min-w-0 items-center gap-1 py-0.5 pr-2 text-[10px] leading-tight",
          node.selected ? "bg-foreground/10 text-foreground" : "text-foreground/72",
        )}
        style={{ paddingLeft }}
      >
        {isDir ? (
          <ChevronDown
            className="size-2.5 shrink-0 text-foreground/45"
            aria-hidden
            strokeWidth={1.75}
          />
        ) : (
          <span className="size-2.5 shrink-0" aria-hidden />
        )}
        <Icon className="size-3 shrink-0 text-foreground/55" aria-hidden strokeWidth={1.75} />
        <span className="truncate">{node.name}</span>
      </div>
      {node.children?.map((child) => (
        <TreeNode key={`${depth}-${child.name}`} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export function LandingEditorFileTree({ root, className }: LandingEditorFileTreeProps) {
  return (
    <div
      className={cn(
        "h-full min-h-0 w-[7rem] shrink-0 overflow-hidden border-r border-foreground/8 bg-background py-1.5",
        className,
      )}
    >
      <TreeNode node={root} depth={0} />
    </div>
  );
}
