import path from "node:path";
import { mkdirSync } from "node:fs";
import { product } from "@spiritagent/product";

export function configureElectronProductStorage(app: {
  setName(name: string): void;
  getPath(name: "appData"): string;
  setPath(name: "userData" | "sessionData", value: string): void;
}): void {
  app.setName(product.name);
  const privateDataDir = path.join(app.getPath("appData"), product.name);
  mkdirSync(privateDataDir, { recursive: true });
  app.setPath("userData", privateDataDir);
  app.setPath("sessionData", privateDataDir);
}
