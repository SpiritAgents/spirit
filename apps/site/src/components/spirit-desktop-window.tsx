import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { DesktopMacTrafficLights } from "@/components/desktop-mac-traffic-lights";
import { DesktopConversationPreview } from "@/components/desktop-conversation-preview";
import { DesktopModelsPreview } from "@/components/desktop-models-preview";
import { DesktopLayoutChromeBar } from "@/components/layout/desktop-layout-chrome-bar";
import { SessionSidebar, type SettingsSidebarTab } from "@/components/session-sidebar";
import { SessionSidebarShell } from "@/components/session-sidebar-shell";
import { WorkspaceToolsDock } from "@/components/workspace-tools-panel";
import { EmptyCard } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Messages } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import {
  NESTED_SESSION_SIDEBAR_MAX_WIDTH_PX,
  NESTED_SESSION_SIDEBAR_MIN_WIDTH_PX,
  NESTED_SESSION_SIDEBAR_WIDTH_PX,
  sessionSidebarShellWidth,
} from "@/lib/desktop-chrome";
import {
  readWorkspaceToolsWidthPx,
  computeDesignModeWorkspaceToolsWidthPx,
} from "@/lib/layout-prefs";
import {
  INITIAL_DESIGN_MODE_DEMO_STATE,
  type DesignModeDemoState,
} from "@/lib/design-mode-demo-state";
import { cn } from "@/lib/utils";
import {
  SessionSidebarChromeProvider,
  useSessionSidebarChrome,
} from "@/contexts/session-sidebar-chrome-context";
import { DesktopPreviewDensityProvider } from "@/contexts/desktop-preview-density-context";
import type {
  DesktopModelCatalogHint,
  ModelProfileSnapshot,
  PlanSnapshot,
  SessionListItem,
  WorkspaceExplorerEntry,
  WorkspaceExplorerListResult,
} from "@/types/spirit-desktop";

type SurfaceMode = "conversation" | "settings" | "marketplace";
type NonSettingsSurface = "conversation" | "marketplace";
type DemoVariant = "default" | "agentPlan" | "designMode";
type InitialSessionKey = "hero" | "landing" | "agent" | "design";

export type SpiritDesktopWindowProps = {
  initialSurface?: SurfaceMode;
  initialSettingsTab?: SettingsSidebarTab;
  demoVariant?: DemoVariant;
  initialPlanMode?: boolean;
  initialWorkspaceToolsOpen?: boolean;
  initialSessionKey?: InitialSessionKey;
  demoPlaybackActive?: boolean;
  demoStaticSnapshot?: "defaultEnd";
  className?: string;
  viewportClassName?: string;
  useTranslucency?: boolean;
  heroBaseTone?: boolean;
  /** Smaller typography for in-browser nested previews (fonts only, not layout scale). */
  nestedPreview?: boolean;
};

type AvailableWorkspace = {
  label: string;
  path: string;
};

type WorkspacePreviewState = {
  branch: string;
  tree: Record<string, WorkspaceExplorerEntry[]>;
  texts: Record<string, string>;
};

const SITE_WORKSPACE_ROOT = "D:\\spiritagent.app";
const DESKTOP_WORKSPACE_ROOT = "D:\\spiritagent.app\\SPIRIT\\desktop";

const CONVERSATION_MAX_W = "max-w-[min(84vw,38rem)]";

const MOCK_MODELS: ModelProfileSnapshot[] = [
  {
    name: "GPT 5.5",
    apiBase: "https://api.openai.com/v1",
    provider: "openai",
  },
  {
    name: "DeepSeek V4 Pro",
    apiBase: "https://api.deepseek.com/v1",
    provider: "deepseek",
  },
];

const MOCK_MODEL_CATALOG_HINTS: DesktopModelCatalogHint[] = [
  {
    apiBase: "https://api.openai.com/v1",
    modelIds: ["GPT 5.5"],
    fetchedAtUnixMs: 1_775_500_000_000,
  },
  {
    apiBase: "https://api.deepseek.com/v1",
    modelIds: ["DeepSeek V4 Pro"],
    fetchedAtUnixMs: 1_775_500_000_000,
  },
];

const INITIAL_WORKSPACES: AvailableWorkspace[] = [
  { label: "spiritagent.app", path: SITE_WORKSPACE_ROOT },
  { label: "desktop", path: DESKTOP_WORKSPACE_ROOT },
];

function createSitePreview(copy: Messages["desktop"]["previews"]): WorkspacePreviewState {
  return {
    branch: "main",
    tree: {
      "": [
        { name: "src", kind: "dir" },
        { name: "public", kind: "dir" },
        { name: "package.json", kind: "file" },
        { name: "vite.config.ts", kind: "file" },
        { name: "README.md", kind: "file" },
      ],
      src: [
        { name: "App.tsx", kind: "file" },
        { name: "main.tsx", kind: "file" },
        { name: "index.css", kind: "file" },
        { name: "components", kind: "dir" },
      ],
      "src/components": [
        { name: "hero.tsx", kind: "file" },
        { name: "spirit-desktop-window.tsx", kind: "file" },
        { name: "ui", kind: "dir" },
      ],
      "src/components/ui": [
        { name: "button.tsx", kind: "file" },
        { name: "dropdown-menu.tsx", kind: "file" },
        { name: "scroll-area.tsx", kind: "file" },
      ],
      public: [{ name: "favicon.svg", kind: "file" }],
    },
    texts: {
      "package.json": `{
  "name": "spiritagent.app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}`,
      "vite.config.ts": `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`,
      "README.md": `# spiritagent.app

${copy.siteReadmeDescription}
`,
      "src/App.tsx": `import { Hero } from './components/hero'

export default function App() {
  return <Hero />
}
`,
      "src/main.tsx": `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,
      "src/index.css": `html, body, #root {
  min-height: 100%;
  background: #0a0a0a;
}
`,
      "src/components/hero.tsx": `import { SpiritDesktopWindow } from './spirit-desktop-window'

export function Hero() {
  return <SpiritDesktopWindow />
}
`,
      "src/components/spirit-desktop-window.tsx": `export function SpiritDesktopWindow() {
  return <div>Desktop hero preview</div>
}
`,
      "src/components/ui/button.tsx": `export function Button() {
  return null
}
`,
      "src/components/ui/dropdown-menu.tsx": `export function DropdownMenu() {
  return null
}
`,
      "src/components/ui/scroll-area.tsx": `export function ScrollArea() {
  return null
}
`,
      "public/favicon.svg": `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"></svg>`,
    },
  };
}

function createDesktopPreview(copy: Messages["desktop"]["previews"]): WorkspacePreviewState {
  return {
    branch: "feature/desktop-hero",
    tree: {
      "": [
        { name: "src", kind: "dir" },
        { name: "electron", kind: "dir" },
        { name: "package.json", kind: "file" },
        { name: "README.md", kind: "file" },
      ],
      src: [
        { name: "App.tsx", kind: "file" },
        { name: "styles.css", kind: "file" },
        { name: "components", kind: "dir" },
      ],
      "src/components": [
        { name: "desktop-mac-traffic-lights.tsx", kind: "file" },
        { name: "session-sidebar.tsx", kind: "file" },
        { name: "workspace-tools-panel.tsx", kind: "file" },
      ],
      electron: [
        { name: "main.ts", kind: "file" },
        { name: "preload.ts", kind: "file" },
      ],
    },
    texts: {
      "package.json": `{
  "name": "spirit-desktop",
  "private": true,
  "type": "module"
}`,
      "README.md": `# Spirit Desktop

${copy.desktopReadmeDescription}
`,
      "src/App.tsx": `export default function App() {
  return <div className="desktop-shell" />
}
`,
      "src/styles.css": `html.dark {
  color-scheme: dark;
}
`,
      "src/components/desktop-mac-traffic-lights.tsx": `export function DesktopMacTrafficLights() {
  return null
}
`,
      "src/components/session-sidebar.tsx": `export function SessionSidebar() {
  return null
}
`,
      "src/components/workspace-tools-panel.tsx": `export function WorkspaceToolsDock() {
  return null
}
`,
      "electron/main.ts": `export function createMainWindow() {
  return null
}
`,
      "electron/preload.ts": `export const preload = true
`,
    },
  };
}

function createInitialSessions(copy: Messages["desktop"]["previews"]): SessionListItem[] {
  return [
    {
      path: `${SITE_WORKSPACE_ROOT}\\.spirit\\sessions\\hero-preview.json`,
      displayName: copy.heroSession,
      modifiedAtUnixMs: 1_775_499_100_000,
      workspaceRoot: SITE_WORKSPACE_ROOT,
    },
    {
      path: `${SITE_WORKSPACE_ROOT}\\.spirit\\sessions\\landing-polish.json`,
      displayName: copy.landingSession,
      modifiedAtUnixMs: 1_775_498_700_000,
      workspaceRoot: SITE_WORKSPACE_ROOT,
    },
    {
      path: `${SITE_WORKSPACE_ROOT}\\.spirit\\sessions\\agent-plan.json`,
      displayName: copy.agentSession,
      modifiedAtUnixMs: 1_775_499_400_000,
      workspaceRoot: SITE_WORKSPACE_ROOT,
    },
    {
      path: `${SITE_WORKSPACE_ROOT}\\.spirit\\sessions\\design-copy.json`,
      displayName: copy.designSession,
      modifiedAtUnixMs: 1_775_499_550_000,
      workspaceRoot: SITE_WORKSPACE_ROOT,
    },
    {
      path: `${DESKTOP_WORKSPACE_ROOT}\\.spirit\\sessions\\desktop-runtime.json`,
      displayName: copy.desktopSession,
      modifiedAtUnixMs: 1_775_498_100_000,
      workspaceRoot: DESKTOP_WORKSPACE_ROOT,
    },
  ];
}

function resolveInitialSessionPath(
  sessions: SessionListItem[],
  sessionKey: InitialSessionKey | undefined,
): string | null {
  if (!sessions.length) {
    return null;
  }
  if (sessionKey === "agent") {
    return (
      sessions.find((session) => session.path.includes("agent-plan"))?.path ??
      sessions[0]?.path ??
      null
    );
  }
  if (sessionKey === "design") {
    return (
      sessions.find((session) => session.path.includes("design-copy"))?.path ??
      sessions[0]?.path ??
      null
    );
  }
  if (sessionKey === "landing") {
    return (
      sessions.find((session) => session.path.includes("landing-polish"))?.path ??
      sessions[0]?.path ??
      null
    );
  }
  return sessions[0]?.path ?? null;
}

function clonePreview(preview: WorkspacePreviewState): WorkspacePreviewState {
  return {
    branch: preview.branch,
    tree: Object.fromEntries(
      Object.entries(preview.tree).map(([key, entries]) => [
        key,
        entries.map((entry) => ({ ...entry })),
      ]),
    ),
    texts: { ...preview.texts },
  };
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/\/+$/gu, "").toLowerCase();
}

function sameWorkspacePath(left: string, right: string): boolean {
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right);
}

function deriveWorkspaceLabel(workspaceRoot: string): string {
  const normalized = workspaceRoot.replace(/\\/gu, "/").replace(/\/+$/gu, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) || normalized : normalized;
}

function slugifySessionLabel(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/\s+/gu, "-")
      .replace(/[^a-z0-9-]/gu, "")
      .replace(/-+/gu, "-")
      .replace(/^-|-$/gu, "") || "session"
  );
}

function sortSessionsNewestFirst(sessions: SessionListItem[]): SessionListItem[] {
  return [...sessions].sort((left, right) => right.modifiedAtUnixMs - left.modifiedAtUnixMs);
}

function buildSessionPath(workspaceRoot: string, label: string, stamp: number): string {
  return `${workspaceRoot}\\.spirit\\sessions\\${slugifySessionLabel(label)}-${stamp}.json`;
}

function createPreviewForWorkspace(
  root: string,
  copy: Messages["desktop"]["previews"],
): WorkspacePreviewState {
  const label = deriveWorkspaceLabel(root);
  return {
    branch: "preview",
    tree: {
      "": [
        { name: "README.md", kind: "file" },
        { name: "notes", kind: "dir" },
      ],
      notes: [{ name: "overview.md", kind: "file" }],
    },
    texts: {
      "README.md": `# ${label}\n\n${copy.generatedWorkspaceDescription(label)}\n`,
      "notes/overview.md": `${copy.generatedWorkspaceOverview(root)}\n`,
    },
  };
}

function createSession(workspaceRoot: string, label: string): SessionListItem {
  const stamp = Date.now();
  return {
    path: buildSessionPath(workspaceRoot, label, stamp),
    displayName: label,
    modifiedAtUnixMs: stamp,
    workspaceRoot,
  };
}

function PreviewSurfacePlaceholder({
  title,
  baseToneClassName,
}: {
  title: string;
  baseToneClassName?: string;
}) {
  return (
    <ScrollArea
      className={cn("min-h-0 flex-1", baseToneClassName ?? "bg-background")}
      type="hover"
      scrollHideDelay={450}
    >
      <div
        className={cn("mx-auto flex min-h-full w-full items-center px-3 py-12", CONVERSATION_MAX_W)}
      >
        <EmptyCard className="w-full">{title}</EmptyCard>
      </div>
    </ScrollArea>
  );
}

export function SpiritDesktopWindow({
  initialSurface = "conversation",
  initialSettingsTab = "basic",
  demoVariant = "default",
  initialPlanMode = false,
  initialWorkspaceToolsOpen,
  initialSessionKey,
  demoPlaybackActive = true,
  demoStaticSnapshot,
  className,
  viewportClassName,
  useTranslucency = false,
  heroBaseTone = false,
  nestedPreview = false,
}: SpiritDesktopWindowProps) {
  const { messages } = useI18n();
  const agentDemoCopy = messages.desktop.conversation.agentDemo;
  const sitePreview = useMemo(
    () => createSitePreview(messages.desktop.previews),
    [messages.desktop.previews],
  );
  const desktopPreview = useMemo(
    () => createDesktopPreview(messages.desktop.previews),
    [messages.desktop.previews],
  );
  const initialSessions = useMemo(
    () => createInitialSessions(messages.desktop.previews),
    [messages.desktop.previews],
  );
  const [windowRootElement, setWindowRootElement] = useState<HTMLDivElement | null>(null);
  const [availableWorkspaces, setAvailableWorkspaces] =
    useState<AvailableWorkspace[]>(INITIAL_WORKSPACES);
  const [workspacePreviews, setWorkspacePreviews] = useState<Record<string, WorkspacePreviewState>>(
    () => ({
      [normalizeWorkspacePath(SITE_WORKSPACE_ROOT)]: clonePreview(sitePreview),
      [normalizeWorkspacePath(DESKTOP_WORKSPACE_ROOT)]: clonePreview(desktopPreview),
    }),
  );
  const [workspaceRoot, setWorkspaceRoot] = useState(SITE_WORKSPACE_ROOT);
  const [sessions, setSessions] = useState<SessionListItem[]>(() =>
    sortSessionsNewestFirst(initialSessions),
  );
  const [activeSessionPath, setActiveSessionPath] = useState<string | null>(() =>
    resolveInitialSessionPath(
      initialSessions,
      initialSessionKey ?? (demoVariant === "agentPlan" ? "agent" : "hero"),
    ),
  );
  const [activeSurface, setActiveSurface] = useState<SurfaceMode>(initialSurface);
  const [lastNonSettingsSurface, setLastNonSettingsSurface] = useState<NonSettingsSurface>(
    initialSurface === "marketplace" ? "marketplace" : "conversation",
  );
  const [settingsTab, setSettingsTab] = useState<SettingsSidebarTab>(initialSettingsTab);
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(() => {
    if (demoVariant === "agentPlan" || demoVariant === "designMode") {
      return false;
    }
    // Deterministic SSR/client snapshot; viewport adjustments run after mount.
    return true;
  });
  const [workspaceToolsOpen, setWorkspaceToolsOpen] = useState(() => {
    if (initialWorkspaceToolsOpen !== undefined) {
      return initialWorkspaceToolsOpen;
    }
    if (demoVariant === "agentPlan") {
      return false;
    }
    if (demoVariant === "designMode") {
      return true;
    }
    // Deterministic SSR/client snapshot; viewport adjustments run after mount.
    return initialSurface === "conversation";
  });
  const [workspaceToolsWidthPx, setWorkspaceToolsWidthPx] = useState(() =>
    readWorkspaceToolsWidthPx(),
  );
  const [activeModel, setActiveModel] = useState(MOCK_MODELS[0]?.name ?? "");
  const [planMode, setPlanMode] = useState(initialPlanMode);
  const [planSnapshot, setPlanSnapshot] = useState<PlanSnapshot>(() => ({
    path: agentDemoCopy.planPath,
    exists: false,
    content: "",
  }));
  const [planRevealNonce, setPlanRevealNonce] = useState(0);
  const [planPreviewContent, setPlanPreviewContent] = useState("");
  const [designModeDemoState, setDesignModeDemoState] = useState<DesignModeDemoState>(
    INITIAL_DESIGN_MODE_DEMO_STATE,
  );
  const designModeUserInteractRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleResize = () => {
      const width = window.innerWidth;
      if (width < 640) {
        setSessionSidebarOpen(false);
        setWorkspaceToolsOpen(false);
        return;
      }
      if (width < 1120) {
        setWorkspaceToolsOpen(false);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (demoVariant !== "designMode" || !windowRootElement) {
      return;
    }

    const contentRow = windowRootElement.querySelector(
      '[data-spirit-surface="conversation-tools-row"]',
    );
    if (!(contentRow instanceof HTMLElement)) {
      return;
    }

    const syncDesignModeToolsWidth = () => {
      const rowWidth = contentRow.clientWidth;
      if (rowWidth < 1) {
        return;
      }
      setWorkspaceToolsWidthPx(computeDesignModeWorkspaceToolsWidthPx(rowWidth));
    };

    syncDesignModeToolsWidth();
    const observer = new ResizeObserver(syncDesignModeToolsWidth);
    observer.observe(contentRow);
    return () => observer.disconnect();
  }, [demoVariant, windowRootElement]);

  const previewKey = useMemo(() => normalizeWorkspacePath(workspaceRoot), [workspaceRoot]);
  const currentPreview = useMemo(
    () =>
      workspacePreviews[previewKey] ??
      createPreviewForWorkspace(workspaceRoot, messages.desktop.previews),
    [messages.desktop.previews, previewKey, workspacePreviews, workspaceRoot],
  );
  const currentBranch = currentPreview.branch;

  const ensureSessionForWorkspace = (nextWorkspaceRoot: string): string => {
    const existing = sessions.find((session) =>
      sameWorkspacePath(session.workspaceRoot, nextWorkspaceRoot),
    );
    if (existing) {
      return existing.path;
    }
    const newSession = createSession(nextWorkspaceRoot, messages.desktop.window.newSession);
    setSessions((current) => sortSessionsNewestFirst([newSession, ...current]));
    return newSession.path;
  };

  const handleSelectWorkspace = (nextWorkspaceRoot: string) => {
    if (sameWorkspacePath(nextWorkspaceRoot, workspaceRoot)) {
      return;
    }
    const nextSessionPath = ensureSessionForWorkspace(nextWorkspaceRoot);
    setWorkspaceRoot(nextWorkspaceRoot);
    setActiveSessionPath(nextSessionPath);
    setActiveSurface("conversation");
    setLastNonSettingsSurface("conversation");
  };

  const handleAddWorkspace = () => {
    const nextIndex = availableWorkspaces.length + 1;
    const nextRoot = `${SITE_WORKSPACE_ROOT}\\playgrounds\\preview-${nextIndex}`;
    const nextWorkspace: AvailableWorkspace = {
      label: `preview-${nextIndex}`,
      path: nextRoot,
    };
    const preview = createPreviewForWorkspace(nextRoot, messages.desktop.previews);
    const nextSession = createSession(nextRoot, messages.desktop.window.newSession);

    setAvailableWorkspaces((current) => [...current, nextWorkspace]);
    setWorkspacePreviews((current) => ({
      ...current,
      [normalizeWorkspacePath(nextRoot)]: preview,
    }));
    setSessions((current) => sortSessionsNewestFirst([nextSession, ...current]));
    setWorkspaceRoot(nextRoot);
    setActiveSessionPath(nextSession.path);
    setActiveSurface("conversation");
    setLastNonSettingsSurface("conversation");
  };

  const handleNewSession = () => {
    const nextSession = createSession(workspaceRoot, messages.desktop.window.newSession);
    setSessions((current) => sortSessionsNewestFirst([nextSession, ...current]));
    setActiveSessionPath(nextSession.path);
    setActiveSurface("conversation");
    setLastNonSettingsSurface("conversation");
  };

  const listExplorerChildren = useCallback(
    async (relativePath: string): Promise<WorkspaceExplorerListResult> => ({
      entries: currentPreview.tree[relativePath] ?? [],
    }),
    [currentPreview],
  );

  const contentBaseToneClassName = heroBaseTone
    ? "bg-background dark:bg-[#000000]"
    : "bg-background";
  const activeSessionTitle =
    sessions.find((session) => session.path === activeSessionPath)?.displayName ?? null;

  return (
    <DesktopPreviewDensityProvider nested={nestedPreview}>
      <TooltipProvider>
        <SessionSidebarChromeProvider
          open={sessionSidebarOpen}
          onOpenChange={setSessionSidebarOpen}
          defaultOpen={sessionSidebarOpen}
          initialWidthPx={nestedPreview ? NESTED_SESSION_SIDEBAR_WIDTH_PX : undefined}
        >
          <SpiritDesktopWindowBody
            windowRootElement={windowRootElement}
            setWindowRootElement={setWindowRootElement}
            className={className}
            viewportClassName={viewportClassName}
            useTranslucency={useTranslucency}
            heroBaseTone={heroBaseTone}
            nestedPreview={nestedPreview}
            contentBaseToneClassName={contentBaseToneClassName}
            activeSurface={activeSurface}
            lastNonSettingsSurface={lastNonSettingsSurface}
            setActiveSurface={setActiveSurface}
            setLastNonSettingsSurface={setLastNonSettingsSurface}
            workspaceRoot={workspaceRoot}
            sessions={sessions}
            activeSessionPath={activeSessionPath}
            setActiveSessionPath={setActiveSessionPath}
            settingsTab={settingsTab}
            setSettingsTab={setSettingsTab}
            workspaceToolsOpen={workspaceToolsOpen}
            setWorkspaceToolsOpen={setWorkspaceToolsOpen}
            workspaceToolsWidthPx={workspaceToolsWidthPx}
            setWorkspaceToolsWidthPx={setWorkspaceToolsWidthPx}
            handleNewSession={handleNewSession}
            handleSelectWorkspace={handleSelectWorkspace}
            handleAddWorkspace={handleAddWorkspace}
            activeSessionTitle={activeSessionTitle}
            availableWorkspaces={availableWorkspaces}
            activeModel={activeModel}
            setActiveModel={setActiveModel}
            planMode={planMode}
            setPlanMode={setPlanMode}
            demoVariant={demoVariant}
            demoPlaybackActive={demoPlaybackActive}
            demoStaticSnapshot={demoStaticSnapshot}
            planSnapshot={planSnapshot}
            planRevealNonce={planRevealNonce}
            planPreviewContent={planPreviewContent}
            setPlanSnapshot={setPlanSnapshot}
            setPlanRevealNonce={setPlanRevealNonce}
            setPlanPreviewContent={setPlanPreviewContent}
            designModeDemoState={designModeDemoState}
            setDesignModeDemoState={setDesignModeDemoState}
            designModeUserInteractRef={designModeUserInteractRef}
            listExplorerChildren={listExplorerChildren}
            currentBranch={currentBranch}
            messages={messages}
          />
        </SessionSidebarChromeProvider>
      </TooltipProvider>
    </DesktopPreviewDensityProvider>
  );
}

type SpiritDesktopWindowBodyProps = {
  windowRootElement: HTMLDivElement | null;
  setWindowRootElement: (element: HTMLDivElement | null) => void;
  className?: string;
  viewportClassName?: string;
  useTranslucency: boolean;
  heroBaseTone: boolean;
  nestedPreview: boolean;
  contentBaseToneClassName: string;
  activeSurface: SurfaceMode;
  lastNonSettingsSurface: NonSettingsSurface;
  setActiveSurface: (surface: SurfaceMode) => void;
  setLastNonSettingsSurface: (surface: NonSettingsSurface) => void;
  workspaceRoot: string;
  sessions: SessionListItem[];
  activeSessionPath: string | null;
  setActiveSessionPath: (path: string) => void;
  settingsTab: SettingsSidebarTab;
  setSettingsTab: (tab: SettingsSidebarTab) => void;
  workspaceToolsOpen: boolean;
  setWorkspaceToolsOpen: Dispatch<SetStateAction<boolean>>;
  workspaceToolsWidthPx: number;
  setWorkspaceToolsWidthPx: Dispatch<SetStateAction<number>>;
  handleNewSession: () => void;
  handleSelectWorkspace: (path: string) => void;
  handleAddWorkspace: () => void;
  activeSessionTitle: string | null;
  availableWorkspaces: AvailableWorkspace[];
  activeModel: string;
  setActiveModel: (model: string) => void;
  planMode: boolean;
  setPlanMode: (plan: boolean) => void;
  demoVariant: DemoVariant;
  demoPlaybackActive: boolean;
  demoStaticSnapshot?: "defaultEnd";
  planSnapshot: PlanSnapshot;
  planRevealNonce: number;
  planPreviewContent: string;
  setPlanSnapshot: Dispatch<SetStateAction<PlanSnapshot>>;
  setPlanRevealNonce: Dispatch<SetStateAction<number>>;
  setPlanPreviewContent: Dispatch<SetStateAction<string>>;
  designModeDemoState: DesignModeDemoState;
  setDesignModeDemoState: Dispatch<SetStateAction<DesignModeDemoState>>;
  designModeUserInteractRef: React.MutableRefObject<(() => void) | null>;
  listExplorerChildren: (relativePath: string) => Promise<WorkspaceExplorerListResult>;
  currentBranch: string;
  messages: Messages;
};

function SpiritDesktopWindowBody({
  windowRootElement,
  setWindowRootElement,
  className,
  viewportClassName,
  useTranslucency,
  heroBaseTone,
  nestedPreview,
  contentBaseToneClassName,
  activeSurface,
  lastNonSettingsSurface,
  setActiveSurface,
  setLastNonSettingsSurface,
  workspaceRoot,
  sessions,
  activeSessionPath,
  setActiveSessionPath,
  settingsTab,
  setSettingsTab,
  workspaceToolsOpen,
  setWorkspaceToolsOpen,
  workspaceToolsWidthPx,
  setWorkspaceToolsWidthPx,
  handleNewSession,
  handleSelectWorkspace,
  handleAddWorkspace,
  activeSessionTitle,
  availableWorkspaces,
  activeModel,
  setActiveModel,
  planMode,
  setPlanMode,
  demoVariant,
  demoPlaybackActive,
  demoStaticSnapshot,
  planSnapshot,
  planRevealNonce,
  planPreviewContent,
  setPlanSnapshot,
  setPlanRevealNonce,
  setPlanPreviewContent,
  designModeDemoState,
  setDesignModeDemoState,
  designModeUserInteractRef,
  listExplorerChildren,
  currentBranch,
  messages,
}: SpiritDesktopWindowBodyProps) {
  const {
    open: sessionSidebarOpen,
    widthPx: sessionSidebarWidthPx,
    openSidebar,
  } = useSessionSidebarChrome();

  return (
    <div
      ref={setWindowRootElement}
      data-spirit-preview-shell="darwin"
      {...(nestedPreview ? { "data-nested-preview": true } : {})}
      className={cn(
        "relative isolate overflow-hidden rounded-[10px] border border-border shadow-[0_24px_64px_-16px_rgba(0,0,0,0.18)] ring-0 dark:border-white/12 dark:shadow-[0_34px_96px_rgba(0,0,0,0.54)] dark:ring-1 dark:ring-black/35",
        heroBaseTone ? "h-full w-full" : "w-[min(94vw,70rem)]",
        useTranslucency
          ? "bg-transparent"
          : heroBaseTone
            ? "bg-sidebar dark:bg-[#000000]"
            : "bg-sidebar dark:bg-[#0a0a0a]",
        className,
      )}
    >
      <div
        className={cn(
          "relative flex flex-col text-foreground",
          heroBaseTone
            ? cn("h-full min-h-0", viewportClassName)
            : cn("h-[min(81vh,42rem)] min-h-[33rem]", viewportClassName),
        )}
      >
        <DesktopMacTrafficLights />
        {useTranslucency ? (
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 right-0 z-20 h-px dark:bg-white/8"
            style={{
              left: sessionSidebarOpen ? sessionSidebarShellWidth(true, sessionSidebarWidthPx) : 0,
            }}
          />
        ) : null}
        <div
          data-spirit-surface="app-body"
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <div
            data-spirit-surface="main-frame"
            className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            <SessionSidebarShell
              useTranslucency={useTranslucency}
              minWidthPx={nestedPreview ? NESTED_SESSION_SIDEBAR_MIN_WIDTH_PX : undefined}
              maxWidthPx={nestedPreview ? NESTED_SESSION_SIDEBAR_MAX_WIDTH_PX : undefined}
            >
              <SessionSidebar
                narrow={false}
                mode={activeSurface === "settings" ? "settings" : "sessions"}
                sessions={sessions}
                activeFilePath={activeSessionPath}
                onNewSession={handleNewSession}
                onSelectSession={(path) => {
                  setActiveSessionPath(path);
                  setActiveSurface("conversation");
                  setLastNonSettingsSurface("conversation");
                }}
                onOpenMarketplace={() => {
                  openSidebar();
                  setLastNonSettingsSurface("marketplace");
                  setActiveSurface("marketplace");
                }}
                onOpenSettings={() => {
                  openSidebar();
                  if (activeSurface !== "settings") {
                    setLastNonSettingsSurface(
                      activeSurface === "marketplace" ? "marketplace" : "conversation",
                    );
                  }
                  setActiveSurface("settings");
                }}
                onBackToSessions={() => setActiveSurface(lastNonSettingsSurface)}
                marketplaceActive={activeSurface === "marketplace"}
                settingsTab={settingsTab}
                onSettingsTabChange={setSettingsTab}
                translucency={useTranslucency}
              />
            </SessionSidebarShell>

            <div
              data-spirit-surface="conversation-tools-row"
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden",
                contentBaseToneClassName,
              )}
            >
              <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", contentBaseToneClassName)}>
                <DesktopLayoutChromeBar
                  useTranslucency={useTranslucency}
                  baseToneClassName={contentBaseToneClassName}
                  showWorkspaceToggle={activeSurface === "conversation"}
                  workspaceToolsOpen={workspaceToolsOpen}
                  onToggleWorkspaceTools={() => setWorkspaceToolsOpen((open) => !open)}
                  onNewSession={handleNewSession}
                  sessionTitle={activeSurface === "settings" ? null : activeSessionTitle}
                />

                {activeSurface === "conversation" ? (
                  <DesktopConversationPreview
                    workspaceRoot={workspaceRoot}
                    availableWorkspaces={availableWorkspaces}
                    onSelectWorkspace={handleSelectWorkspace}
                    onAddWorkspace={handleAddWorkspace}
                    models={MOCK_MODELS}
                    catalogHints={MOCK_MODEL_CATALOG_HINTS}
                    activeModel={activeModel}
                    planMode={planMode}
                    demoVariant={demoVariant}
                    demoPlaybackActive={demoPlaybackActive}
                    demoStaticSnapshot={demoStaticSnapshot}
                    baseToneClassName={contentBaseToneClassName}
                    onModelSelect={setActiveModel}
                    onPlanModeChange={setPlanMode}
                    {...(demoVariant === "agentPlan"
                      ? {
                          onPlanReveal: () => {
                            setPlanSnapshot((current) => ({ ...current, exists: true }));
                            setPlanRevealNonce((current) => current + 1);
                          },
                          onPlanContentUpdate: (content: string) => {
                            setPlanPreviewContent(content);
                            setPlanSnapshot((current) => ({ ...current, exists: true, content }));
                          },
                          onPlanReset: () => {
                            setPlanSnapshot((current) => ({
                              ...current,
                              exists: false,
                              content: "",
                            }));
                            setPlanPreviewContent("");
                            setPlanRevealNonce(0);
                          },
                          onWorkspaceToolsOpen: () => setWorkspaceToolsOpen(true),
                          onWorkspaceToolsClose: () => setWorkspaceToolsOpen(false),
                        }
                      : demoVariant === "designMode"
                        ? {
                            onDesignModeStateChange: (patch: Partial<DesignModeDemoState>) => {
                              setDesignModeDemoState((current) => ({ ...current, ...patch }));
                            },
                            onDesignModeReset: () => {
                              setDesignModeDemoState(INITIAL_DESIGN_MODE_DEMO_STATE);
                            },
                            onWorkspaceToolsOpen: () => setWorkspaceToolsOpen(true),
                            designModeUserInteractRef,
                          }
                        : {})}
                  />
                ) : activeSurface === "settings" ? (
                  settingsTab === "models" ? (
                    <div className={cn("relative min-h-0 flex-1", contentBaseToneClassName)}>
                      <ScrollArea
                        className={cn("h-full min-h-0", contentBaseToneClassName)}
                        type="hover"
                        scrollHideDelay={450}
                      >
                        <div className="flex min-h-full flex-col justify-center">
                          <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
                            <DesktopModelsPreview
                              activeModel={activeModel}
                              dialogContainer={windowRootElement}
                            />
                          </div>
                        </div>
                      </ScrollArea>
                    </div>
                  ) : (
                    <PreviewSurfacePlaceholder
                      title={messages.desktop.window.settingsPlaceholderTitle}
                      baseToneClassName={contentBaseToneClassName}
                    />
                  )
                ) : (
                  <PreviewSurfacePlaceholder
                    title={messages.desktop.window.marketplacePlaceholderTitle}
                    baseToneClassName={contentBaseToneClassName}
                  />
                )}
              </div>

              {activeSurface === "conversation" ? (
                <div data-spirit-surface="workspace-dock" className="flex min-h-0">
                  <WorkspaceToolsDock
                    workspaceRoot={workspaceRoot}
                    branch={currentBranch}
                    listExplorerChildren={listExplorerChildren}
                    baseToneClassName={contentBaseToneClassName}
                    useTranslucency={useTranslucency}
                    open={workspaceToolsOpen}
                    widthPx={workspaceToolsWidthPx}
                    onWidthPxChange={setWorkspaceToolsWidthPx}
                    plan={demoVariant === "agentPlan" ? planSnapshot : undefined}
                    planPreviewContent={planPreviewContent}
                    planRevealNonce={planRevealNonce}
                    hideFileTree={demoVariant === "agentPlan"}
                    dockMode={demoVariant === "designMode" ? "designMode" : "legacy"}
                    designModeState={demoVariant === "designMode" ? designModeDemoState : undefined}
                    onDesignModeStateChange={
                      demoVariant === "designMode"
                        ? (patch) => setDesignModeDemoState((current) => ({ ...current, ...patch }))
                        : undefined
                    }
                    onDesignModeUserInteract={
                      demoVariant === "designMode"
                        ? () => designModeUserInteractRef.current?.()
                        : undefined
                    }
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
