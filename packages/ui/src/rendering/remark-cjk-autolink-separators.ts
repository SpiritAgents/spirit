import type { Link, Root, Text } from "mdast";
import type { Node, Parent } from "unist";

const CJK_AUTOLINK_DELIMITER =
  /([，。；：、・！？…“”‘’＂＇（）【】《》〈〉「」『』〔〕〖〗〘〙〚〛［］｛｝])/u;
const BARE_URL_PREFIX = /^(?:(https?:\/\/)|(www\.))/i;
const TRAILING_ASCII_PUNCTUATION = /[!"&'),.:;<>?\]}]+$/;

function isBareAutolink(node: Node): node is Link {
  if (node.type !== "link") return false;
  const link = node as Link;
  const start = link.position?.start.offset;
  const end = link.position?.end.offset;
  if (start === undefined || end === undefined) return false;
  if (link.children.length !== 1 || link.children[0]?.type !== "text") return false;
  const label = (link.children[0] as Text).value;
  return BARE_URL_PREFIX.test(label) && end - start === label.length;
}

function text(value: string): Text {
  return { type: "text", value };
}

function appendText(nodes: Array<Link | Text>, value: string): void {
  if (!value) return;
  const previous = nodes.at(-1);
  if (previous?.type === "text") {
    previous.value += value;
  } else {
    nodes.push(text(value));
  }
}

function countCharacter(value: string, character: string): number {
  return [...value].filter((candidate) => candidate === character).length;
}

/** Match GFM's existing trailing punctuation behavior for URLs after a CJK delimiter. */
function splitTrailingAsciiPunctuation(value: string): [string, string] {
  const match = TRAILING_ASCII_PUNCTUATION.exec(value);
  if (!match) return [value, ""];

  let url = value.slice(0, match.index);
  let trail = match[0];
  let closingParenIndex = trail.indexOf(")");
  const openingParens = countCharacter(url, "(");
  let closingParens = countCharacter(url, ")");

  while (closingParenIndex !== -1 && openingParens > closingParens) {
    url += trail.slice(0, closingParenIndex + 1);
    trail = trail.slice(closingParenIndex + 1);
    closingParenIndex = trail.indexOf(")");
    closingParens += 1;
  }
  return [url, trail];
}

function hasValidGfmDomain(value: string): boolean {
  const parts = value.split(".");
  const last = parts.at(-1);
  const previous = parts.at(-2);
  return (
    parts.length >= 2 &&
    (!last || (!/_/.test(last) && /[a-zA-Z\d]/.test(last))) &&
    (!previous || (!/_/.test(previous) && /[a-zA-Z\d]/.test(previous)))
  );
}

function appendBareUrl(nodes: Array<Link | Text>, value: string): boolean {
  const prefix = BARE_URL_PREFIX.exec(value);
  if (!prefix) return false;

  const [urlText, trailing] = splitTrailingAsciiPunctuation(value);
  const protocolLength = prefix[0].length;
  const domain = urlText.slice(protocolLength).split(/[/?#]/, 1)[0]!.replace(/:\d+$/, "");
  if (!hasValidGfmDomain(domain)) return false;

  nodes.push({
    type: "link",
    title: null,
    url: prefix[2] ? `http://${urlText}` : urlText,
    children: [text(urlText)],
  });
  appendText(nodes, trailing);
  return true;
}

function splitBareAutolink(link: Link): Array<Link | Text> | null {
  const raw = (link.children[0] as Text).value;
  if (!CJK_AUTOLINK_DELIMITER.test(raw)) return null;

  const pieces = raw.split(CJK_AUTOLINK_DELIMITER);
  const nodes: Array<Link | Text> = [];
  if (!appendBareUrl(nodes, pieces.shift() ?? "")) return null;

  for (let index = 0; index < pieces.length; index += 2) {
    appendText(nodes, pieces[index] ?? "");
    const candidate = pieces[index + 1] ?? "";
    if (!appendBareUrl(nodes, candidate)) {
      appendText(nodes, candidate);
    }
  }
  return nodes;
}

function transformChildren(parent: Parent): void {
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index]!;
    if (isBareAutolink(child)) {
      const replacement = splitBareAutolink(child);
      if (replacement) {
        parent.children.splice(index, 1, ...replacement);
        index += replacement.length - 1;
        continue;
      }
    }
    if ("children" in child && Array.isArray(child.children)) {
      transformChildren(child as Parent);
    }
  }
}

/** GFM otherwise consumes unspaced CJK prose into a bare URL until the next ASCII whitespace. */
export function remarkCjkAutolinkSeparators() {
  return (tree: Root): void => {
    transformChildren(tree);
  };
}
