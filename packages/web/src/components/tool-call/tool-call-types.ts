export type ReadLocalImagePreview = (filePath: string) => Promise<string | null>;
export type ReadManagedImagePreview = (reference: string) => Promise<string | null>;
export type ReadLocalVideoPreview = (filePath: string) => Promise<string | null>;
export type ReadManagedVideoPreview = (reference: string) => Promise<string | null>;
export type SaveLocalImageAs = (filePath: string) => Promise<boolean>;
