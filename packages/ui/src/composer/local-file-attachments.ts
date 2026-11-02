/** Host conversation snapshot attachment shape; structural subset of the desktop snapshot type. */
export type LocalFileAttachmentSnapshot = {
  path: string;
  name: string;
  isImage: boolean;
};

export interface ComposerLocalFileAttachmentView {
  id: string;
  path: string;
  name: string;
  isImage: boolean;
  previewDataUrl?: string | null;
}

export function basenameFromPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

const PREVIEWABLE_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
]);

export function isPreviewableImagePath(value: string): boolean {
  const lower = basenameFromPath(value).toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) {
    return false;
  }
  return PREVIEWABLE_IMAGE_EXTENSIONS.has(lower.slice(dot));
}

export function canPreviewComposerLocalFileAttachment(
  attachment: ComposerLocalFileAttachmentView,
): boolean {
  return (
    attachment.isImage &&
    isPreviewableImagePath(attachment.path) &&
    Boolean(attachment.previewDataUrl)
  );
}

const PREVIEWABLE_VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mpeg", ".mpg"]);

export function isPreviewableVideoPath(value: string): boolean {
  const lower = basenameFromPath(value).toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) {
    return false;
  }
  return PREVIEWABLE_VIDEO_EXTENSIONS.has(lower.slice(dot));
}

export function normalizeSlashPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function snapshotToComposerAttachmentView(
  snapshot: LocalFileAttachmentSnapshot,
): ComposerLocalFileAttachmentView {
  return {
    id: normalizeSlashPath(snapshot.path),
    path: snapshot.path,
    name: snapshot.name,
    isImage: snapshot.isImage,
    previewDataUrl: null,
  };
}

// Preview values can be MB-sized data URLs; the LRU cap prevents unbounded growth in long
// sessions / many attachments.
// The generated-image/video tool cards and composer attachments share this cache (keyed by the
// normalized path or managed reference), avoiding repeated IPC fetches when virtualized
// scrolling remounts cards.
export const LOCAL_FILE_PREVIEW_CACHE_MAX_ENTRIES = 20;

const localFilePreviewDataUrlCache = new Map<string, string>();

export function rememberLocalFilePreviewDataUrl(path: string, previewDataUrl: string): void {
  const normalizedPath = normalizeSlashPath(path);
  if (!previewDataUrl) {
    return;
  }
  // Map iteration follows insertion order; delete+set moves the hit entry to the tail, implementing LRU
  localFilePreviewDataUrlCache.delete(normalizedPath);
  localFilePreviewDataUrlCache.set(normalizedPath, previewDataUrl);
  if (localFilePreviewDataUrlCache.size > LOCAL_FILE_PREVIEW_CACHE_MAX_ENTRIES) {
    const oldestKey = localFilePreviewDataUrlCache.keys().next().value;
    if (oldestKey !== undefined) {
      localFilePreviewDataUrlCache.delete(oldestKey);
    }
  }
}

export function readCachedLocalFilePreviewDataUrl(path: string): string | undefined {
  const normalizedPath = normalizeSlashPath(path);
  const cached = localFilePreviewDataUrlCache.get(normalizedPath);
  if (cached !== undefined) {
    localFilePreviewDataUrlCache.delete(normalizedPath);
    localFilePreviewDataUrlCache.set(normalizedPath, cached);
  }
  return cached;
}

export function localFileAttachmentsSnapshotKey(
  snapshots: readonly LocalFileAttachmentSnapshot[] | undefined,
): string {
  if (!snapshots?.length) {
    return "";
  }
  return snapshots
    .map(
      (snapshot) =>
        `${normalizeSlashPath(snapshot.path)}|${snapshot.name}|${snapshot.isImage ? 1 : 0}`,
    )
    .join("\0");
}

export function mergeComposerAttachmentViews(
  previous: readonly ComposerLocalFileAttachmentView[],
  next: readonly ComposerLocalFileAttachmentView[],
): ComposerLocalFileAttachmentView[] {
  const previousByPath = new Map(
    previous.map((item) => [normalizeSlashPath(item.path), item] as const),
  );

  return next.map((item) => {
    const normalizedPath = normalizeSlashPath(item.path);
    const prior = previousByPath.get(normalizedPath);
    const cachedPreview = readCachedLocalFilePreviewDataUrl(normalizedPath);
    const previewDataUrl = item.previewDataUrl ?? prior?.previewDataUrl ?? cachedPreview ?? null;
    if (previewDataUrl) {
      rememberLocalFilePreviewDataUrl(normalizedPath, previewDataUrl);
    }
    return previewDataUrl === item.previewDataUrl ? item : { ...item, previewDataUrl };
  });
}

export function snapshotsToComposerAttachmentViews(
  snapshots: readonly LocalFileAttachmentSnapshot[] | undefined,
): ComposerLocalFileAttachmentView[] {
  if (!snapshots?.length) {
    return [];
  }
  return mergeComposerAttachmentViews(
    [],
    snapshots.map((snapshot) => snapshotToComposerAttachmentView(snapshot)),
  );
}

/**
 * Display attribution: `@` workspace-file references are already rendered as inline chips in the
 * message bubble, so their attachment snapshots must not also render as upload cards above the
 * bubble. Snapshots produced from `@` references carry the same normalized path recorded in the
 * chip (workspace-relative), while uploaded files keep their absolute paths.
 */
export function uploadOnlyLocalFileAttachmentSnapshots(
  snapshots: readonly LocalFileAttachmentSnapshot[] | undefined,
  referencedWorkspaceFilePathKeys: ReadonlySet<string>,
): LocalFileAttachmentSnapshot[] | undefined {
  if (!snapshots?.length || referencedWorkspaceFilePathKeys.size === 0) {
    return snapshots ? [...snapshots] : undefined;
  }
  return snapshots.filter(
    (snapshot) => !referencedWorkspaceFilePathKeys.has(normalizeSlashPath(snapshot.path)),
  );
}

const ATTACHMENT_ONLY_DISPLAY_TEXT_PATTERN = /^(已附加文件|Attached files):\s*.+$/u;

export function isAttachmentOnlyDisplayText(
  content: string,
  attachments: readonly LocalFileAttachmentSnapshot[] | undefined,
): boolean {
  if (!attachments?.length) {
    return false;
  }
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }
  return ATTACHMENT_ONLY_DISPLAY_TEXT_PATTERN.test(trimmed);
}

export function composerAttachmentViewFromPath(filePath: string): ComposerLocalFileAttachmentView {
  const normalizedPath = normalizeSlashPath(filePath);
  return {
    id: normalizedPath,
    path: normalizedPath,
    name: basenameFromPath(normalizedPath),
    isImage: isPreviewableImagePath(normalizedPath),
    previewDataUrl: null,
  };
}

type AttachmentListUpdater = (
  update:
    | ComposerLocalFileAttachmentView[]
    | ((current: ComposerLocalFileAttachmentView[]) => ComposerLocalFileAttachmentView[]),
) => void;

export function appendComposerLocalFileAttachment(
  setAttachments: AttachmentListUpdater,
  filePath: string,
  options?: {
    onAfterAttach?(): void;
  },
): void {
  const normalizedPath = normalizeSlashPath(filePath);
  setAttachments((current) => {
    if (current.some((item) => normalizeSlashPath(item.path) === normalizedPath)) {
      return current;
    }
    return [...current, composerAttachmentViewFromPath(normalizedPath)];
  });

  options?.onAfterAttach?.();
}

export function removeComposerLocalFileAttachment(
  setAttachments: AttachmentListUpdater,
  path: string,
): void {
  const normalizedPath = normalizeSlashPath(path);
  setAttachments((current) =>
    current.filter((item) => normalizeSlashPath(item.path) !== normalizedPath),
  );
}
