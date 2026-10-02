import { remarkHeading } from "fumadocs-core/mdx-plugins";
import { defineConfig } from "fumadocs-mdx/config";

import { remarkTableAnchors } from "./src/lib/remark-table-anchors";

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (plugins) =>
      plugins.map((plugin): (typeof plugins)[number] => {
        if (Array.isArray(plugin) && plugin[0] === remarkHeading) {
          return [remarkTableAnchors, plugin[1]];
        }
        return plugin === remarkHeading ? remarkTableAnchors : plugin;
      }),
  },
});
