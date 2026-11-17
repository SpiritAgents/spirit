export type {
  ReadLocalImagePreview,
  ReadManagedImagePreview,
  ReadLocalVideoPreview,
  ReadManagedVideoPreview,
} from "@spiritagent/ui/rendering/media-types";
export type SaveLocalImageAs = (filePath: string) => Promise<boolean>;
