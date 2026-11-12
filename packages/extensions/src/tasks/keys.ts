export interface ParsedTaskKey {
  filePath: string;
  label: string;
  instance: number;
}

export function taskKey(fileAbsPath: string, label: string): string {
  return `${fileAbsPath}#${label}`;
}

export function taskKeyWithInstance(key: string, instance: number): string {
  return instance > 1 ? `${key}|${instance}` : key;
}

export function parseTaskKey(key: string): ParsedTaskKey {
  let base = key;
  let instance = 1;
  const pipeIndex = key.lastIndexOf("|");
  if (pipeIndex >= 0) {
    const suffix = key.slice(pipeIndex + 1);
    if (/^\d+$/.test(suffix)) {
      base = key.slice(0, pipeIndex);
      instance = Number(suffix);
    }
  }
  // Split on the first "#": labels may contain "#", absolute file paths practically do not.
  const hashIndex = base.indexOf("#");
  if (hashIndex < 0) {
    return { filePath: "", label: base, instance };
  }
  return { filePath: base.slice(0, hashIndex), label: base.slice(hashIndex + 1), instance };
}
