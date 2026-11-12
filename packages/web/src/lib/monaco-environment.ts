import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

let monacoWorkersConfigured = false;

/**
 * Must be called once before the first `monaco.editor.create`.
 *
 * Each language label needs its own dedicated worker: a language worker is a
 * self-contained bundle, whereas the plain editor worker would be asked to
 * `$loadForeignModule` the language service over the wire, which fails under
 * Vite's ESM build (no AMD loader inside the worker) with
 * `FileAccess.asBrowserUri: Cannot read properties of undefined (reading 'toUrl')`.
 */
export function ensureMonacoWorkers(): void {
  if (monacoWorkersConfigured || typeof globalThis === "undefined") {
    return;
  }
  monacoWorkersConfigured = true;
  (
    globalThis as unknown as {
      MonacoEnvironment: { getWorker: (_workerId: string, _label: string) => Worker };
    }
  ).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case "json":
          return new JsonWorker();
        case "css":
        case "scss":
        case "less":
          return new CssWorker();
        case "html":
        case "handlebars":
        case "razor":
          return new HtmlWorker();
        case "typescript":
        case "javascript":
          return new TsWorker();
        default:
          return new EditorWorker();
      }
    },
  };
}
