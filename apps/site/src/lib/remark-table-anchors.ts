import { remarkHeading, type RemarkHeadingOptions } from "fumadocs-core/mdx-plugins";

type HeadingTransformer = ReturnType<typeof remarkHeading>;
type MarkdownRoot = Parameters<HeadingTransformer>[0];
type MarkdownFile = Parameters<HeadingTransformer>[1];

export function remarkTableAnchors(options: RemarkHeadingOptions = {}) {
  const transformHeadings = remarkHeading({ ...options, generateToc: false });

  return (tree: MarkdownRoot, file: MarkdownFile) => {
    const headings: MarkdownRoot = { type: "root", children: [] };
    const rowHeadings: MarkdownRoot["children"] = [];

    function collect(nodes: MarkdownRoot["children"]) {
      for (const node of nodes) {
        if (node.type === "heading") {
          headings.children.push(node);
        } else if (node.type === "table") {
          for (const row of node.children.slice(1)) {
            const cell = row.children[0];
            if (!cell?.children.length) continue;
            row.data ??= {};
            rowHeadings.push({
              type: "heading",
              depth: 6,
              children: cell.children,
              data: row.data,
            });
          }
        } else if ("children" in node) {
          collect(node.children as MarkdownRoot["children"]);
        }
      }
    }

    collect(tree.children);
    headings.children.push(...rowHeadings);
    transformHeadings(headings, file, () => {});
  };
}
