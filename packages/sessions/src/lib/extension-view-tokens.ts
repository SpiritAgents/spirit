export interface HostDocumentChrome {
  htmlClassName: string;
  htmlStyle: string;
}

/** Read live stylesheet text from the host document. Do not maintain a second token file. */
export function collectHostStylesheetCssText(doc: Document = document): string {
  const parts: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      const text = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
      if (text.trim()) {
        parts.push(text);
      }
    } catch {
      // Cross-origin sheets cannot be read; skip. Href reuse is optional.
    }
  }
  return parts.join("\n");
}

export function collectHostDocumentChrome(doc: Document = document): HostDocumentChrome {
  return {
    htmlClassName: doc.documentElement.className,
    htmlStyle: doc.documentElement.getAttribute("style") ?? "",
  };
}
