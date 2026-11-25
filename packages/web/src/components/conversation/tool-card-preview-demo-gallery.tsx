import { ToolCallCollapsible } from "@/components/tool-call/tool-call-collapsible";
import { CONVERSATION_GUTTER_X, CONVERSATION_MAX_W } from "@/lib/conversation-layout-constants";
import {
  TOOL_CARD_PREVIEW_DEMO_SOLID_BLACK_IMAGE_PATH,
  TOOL_CARD_PREVIEW_DEMO_SOLID_WHITE_IMAGE_PATH,
  TOOL_CARD_PREVIEW_DEMO_WORKSPACE,
} from "@/lib/tool-card-preview-demo";
import { cn } from "@/lib/utils";
import type { ToolBlockSnapshot } from "@/types";

const demoImageDataUrlCache = new Map<string, string>();

/**
 * Locally painted PNGs (no network, no disk) so the generate_image cards and zoom dialog
 * exercise the real preview pipeline in the demo.
 */
function demoGeneratedImageDataUrl(filePath: string): string | null {
  const cached = demoImageDataUrlCache.get(filePath);
  if (cached) {
    return cached;
  }
  if (typeof document === "undefined") {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  if (filePath === TOOL_CARD_PREVIEW_DEMO_SOLID_BLACK_IMAGE_PATH) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 640, 640);
  } else if (filePath === TOOL_CARD_PREVIEW_DEMO_SOLID_WHITE_IMAGE_PATH) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 640, 640);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 640, 640);
    gradient.addColorStop(0, "#7c3aed");
    gradient.addColorStop(1, "#0ea5e9");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 640, 640);
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.arc(320, 280, 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    ctx.font = "600 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Demo image", 320, 460);
  }
  const dataUrl = canvas.toDataURL("image/png");
  demoImageDataUrlCache.set(filePath, dataUrl);
  return dataUrl;
}

const demoReadLocalImagePreviewDataUrl = async (filePath: string): Promise<string | null> =>
  demoGeneratedImageDataUrl(filePath);
const demoUnavailableMediaPreview = async (): Promise<string | null> => null;
const demoSaveLocalImageAs = async (): Promise<boolean> => false;

/**
 * Stacks the demo tool snapshots through the real conversation dispatch (ToolCallCollapsible),
 * collapsed by default; expanding a card renders the same detail body as the conversation area.
 * Media reads are local stubs: the demo never touches the network or the filesystem.
 */
export function ToolCardPreviewDemoGallery({ tools }: { tools: readonly ToolBlockSnapshot[] }) {
  return (
    <div
      data-spirit-surface="tool-card-preview-demo-gallery"
      className={cn("mx-auto w-full py-6", CONVERSATION_GUTTER_X, CONVERSATION_MAX_W)}
    >
      <div className="flex flex-col gap-3">
        {tools.map((tool) => (
          <ToolCallCollapsible
            key={tool.toolCallId}
            tool={tool}
            workspaceRoot={TOOL_CARD_PREVIEW_DEMO_WORKSPACE}
            readLocalImagePreviewDataUrl={demoReadLocalImagePreviewDataUrl}
            readLocalVideoPreviewUrl={demoUnavailableMediaPreview}
            readManagedVideoPreviewUrl={demoUnavailableMediaPreview}
            saveLocalImageAs={demoSaveLocalImageAs}
            onOpenSubagentViewer={() => {}}
            onOpenReadFile={() => {}}
            onOpenPlan={() => {}}
            onAbortShell={() => {}}
          />
        ))}
      </div>
    </div>
  );
}
