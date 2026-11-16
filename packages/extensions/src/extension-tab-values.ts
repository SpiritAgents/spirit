import { Buffer } from "node:buffer";
import path from "node:path";
import { isSpiritIconName } from "@spiritagent/icons/names";

import type { HostExtensionDesktopTabRuntimeIcon } from "./extensions.js";

export const HOST_EXTENSION_TAB_IMAGE_MAX_BYTES = 64 * 1024;

export function parseHostExtensionTabRuntimeIcon(
  value: unknown,
): HostExtensionDesktopTabRuntimeIcon {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Extension tab icon must be a descriptor object.");
  }
  const record = value as Record<string, unknown>;
  if (record.monochrome !== undefined && typeof record.monochrome !== "boolean")
    throw new Error("Icon monochrome must be a boolean.");
  if (record.type === "spirit") {
    if (typeof record.name !== "string" || !isSpiritIconName(record.name)) {
      throw new Error(`Unknown Spirit Icon name: ${String(record.name)}`);
    }
    return { type: "spirit", name: record.name };
  }
  if (record.type === "file") {
    if (typeof record.path !== "string") {
      throw new Error("Extension tab icon path must be a string.");
    }
    assertPackagedIconPath(record.path);
    return {
      type: "file",
      path: record.path,
      ...(record.monochrome === true ? { monochrome: true } : {}),
    };
  }
  if (record.type === "image") {
    if (typeof record.dataUrl !== "string") {
      throw new Error("Extension tab image data must be a data URL.");
    }
    const match = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([a-zA-Z0-9+/]+={0,2})$/u.exec(
      record.dataUrl,
    );
    if (!match) {
      throw new Error("Extension tab images must be base64 PNG, JPEG, WebP, or SVG data URLs.");
    }
    const bytes = Buffer.from(match[2]!, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > HOST_EXTENSION_TAB_IMAGE_MAX_BYTES) {
      throw new Error(
        `Extension tab images must contain between 1 and ${HOST_EXTENSION_TAB_IMAGE_MAX_BYTES} bytes.`,
      );
    }
    return {
      type: "image",
      dataUrl: record.dataUrl,
      ...(record.monochrome === true ? { monochrome: true } : {}),
    };
  }
  throw new Error("Extension tab icon type must be spirit, file, or image.");
}

export function assertHostExtensionJsonValue(value: unknown, fieldName: string): void {
  const seen = new WeakSet<object>();
  const visit = (entry: unknown, pathName: string): void => {
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") {
      return;
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) {
        throw new Error(`${pathName} must be a finite number.`);
      }
      return;
    }
    if (typeof entry !== "object") {
      throw new Error(`${pathName} must be JSON-serializable.`);
    }
    if (seen.has(entry)) {
      throw new Error(`${pathName} must not contain circular references.`);
    }
    seen.add(entry);
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${pathName}[${index}]`));
      seen.delete(entry);
      return;
    }
    const prototype = Object.getPrototypeOf(entry) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${pathName} must contain only plain JSON objects.`);
    }
    for (const [key, item] of Object.entries(entry)) {
      visit(item, `${pathName}.${key}`);
    }
    seen.delete(entry);
  };
  visit(value, fieldName);
}

function assertPackagedIconPath(iconPath: string): void {
  if (!/\.(?:svg|png|jpe?g|webp)$/iu.test(iconPath)) {
    throw new Error("Extension tab icons must be SVG, PNG, JPEG, or WebP files.");
  }
  if (path.posix.isAbsolute(iconPath) || iconPath.includes("\\")) {
    throw new Error("Extension tab icon path must be relative to the extension package.");
  }
  const segments = iconPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Extension tab icon path escapes the extension package.");
  }
}
