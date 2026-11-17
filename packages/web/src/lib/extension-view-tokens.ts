export interface HostDocumentChrome {
  htmlClassName: string;
  htmlStyle: string;
}

/** Share resolved design tokens, not the host application's component stylesheet. */
export function collectHostThemeCssText(doc: Document = document): string {
  const computed = doc.defaultView?.getComputedStyle(doc.documentElement);
  if (!computed) return "";
  const declarations: string[] = [];
  for (const name of Array.from(computed)) {
    if (name.startsWith("--")) declarations.push(`${name}:${computed.getPropertyValue(name)};`);
  }
  for (const name of ["font-family", "font-size", "color-scheme"]) {
    const value = computed.getPropertyValue(name);
    if (value) declarations.push(`${name}:${value};`);
  }
  return `:root{${declarations.join("")}}`;
}

export function collectHostDocumentChrome(doc: Document = document): HostDocumentChrome {
  return {
    htmlClassName: doc.documentElement.className,
    htmlStyle: doc.documentElement.getAttribute("style") ?? "",
  };
}
