import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GitPullRequest } from "lucide-react";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "dist/extension");
await mkdir(output, { recursive: true });
for (const name of ["README.md", "LICENSE", "icon.svg"])
  await copyFile(path.join(root, name), path.join(output, name));
await writeFile(
  path.join(output, "package.json"),
  JSON.stringify(
    {
      name: "github",
      version: "1.0.0",
      type: "module",
      main: "index.mjs",
      license: "MIT",
      author: { name: "Spirit", email: "hi@spirit.dev", url: "https://spirit.dev" },
      homepage: "https://spirit.dev",
    },
    null,
    2,
  ) + "\n",
);

await mkdir(path.join(output, "icons"), { recursive: true });
await copyFile(path.join(root, "icons/github.svg"), path.join(output, "icons/github.svg"));
await writeFile(
  path.join(output, "icons/pull-request.svg"),
  renderToStaticMarkup(createElement(GitPullRequest, { strokeWidth: 1.75, stroke: "black" })) +
    "\n",
);
