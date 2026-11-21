import { useCallback, useEffect, useState } from "react";
import {
  FolderOpen,
  Hammer,
  LayoutGrid,
  Moon,
  Play,
  Redo2,
  Save,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  Undo2,
  Workflow,
} from "lucide-react";
import { GraphCanvas } from "./canvas/GraphCanvas";
import { computeAutoLayout } from "./canvas/layout";
import { RosHealthBanner } from "./components/RosHealthBanner";
import { BottomPanel } from "./panels/BottomPanel";
import { GeneratePreviewModal } from "./panels/GeneratePreviewModal";
import { Inspector } from "./panels/Inspector";
import { Palette } from "./panels/Palette";
import { SettingsModal } from "./panels/SettingsModal";
import { WorkspaceModal } from "./panels/WorkspaceModal";
import { useAppStore } from "./store/useAppStore";
import { useProjectStore } from "./store/useProjectStore";

export default function App() {
  const settings = useAppStore((s) => s.settings);
  const rosHealth = useAppStore((s) => s.rosHealth);
  const pingResult = useAppStore((s) => s.pingResult);
  const statusMessage = useAppStore((s) => s.statusMessage);
  const errorMessage = useAppStore((s) => s.errorMessage);
  const bootstrapping = useAppStore((s) => s.bootstrapping);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  const saving = useProjectStore((s) => s.saving);
  const diagnostics = useProjectStore((s) => s.diagnostics);
  const saveNow = useProjectStore((s) => s.saveNow);
  const setPositions = useProjectStore((s) => s.setPositions);
  const setWorkspaceModalOpen = useProjectStore((s) => s.setWorkspaceModalOpen);
  const openGeneratePreview = useProjectStore((s) => s.openGeneratePreview);
  const addPackage = useProjectStore((s) => s.addPackage);
  const addNode = useProjectStore((s) => s.addNode);
  const addChannel = useProjectStore((s) => s.addChannel);
  const loadCatalog = useProjectStore((s) => s.loadCatalog);
  const appendLog = useProjectStore((s) => s.appendLog);

  const [searchOpen, setSearchOpen] = useState(false);
  const [layingOut, setLayingOut] = useState(false);

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;

  useEffect(() => {
    void bootstrap().then(() => {
      void loadCatalog(false);
    });
  }, [bootstrap, loadCatalog]);

  const handleAutoLayout = useCallback(async () => {
    if (!project) return;
    setLayingOut(true);
    try {
      const positions = await computeAutoLayout(project);
      setPositions(positions);
      appendLog("info", "Applied ELK auto-layout to canvas.");
    } catch (err) {
      appendLog("error", `Auto-layout failed: ${String(err)}`);
    } finally {
      setLayingOut(false);
    }
  }, [project, setPositions, appendLog]);

  // Global keyboard shortcuts (SPEC §5 & F1.2 / F1.3 / F1.11)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "s") {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (mod && key === "z") {
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        if (e.shiftKey) {
          useProjectStore.temporal.getState().redo();
        } else {
          useProjectStore.temporal.getState().undo();
        }
        void useProjectStore.getState().runValidation();
        return;
      }
      if (mod && key === "g") {
        e.preventDefault();
        if (project && errorCount === 0) {
          void openGeneratePreview();
        }
        return;
      }
      if (mod && key === "f") {
        e.preventDefault();
        if (project) setSearchOpen(true);
        return;
      }

      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || mod || !project) {
        return;
      }
      if (key === "n") {
        e.preventDefault();
        const pkgId = project.packages[0]?.id ?? addPackage("python");
        if (pkgId) addNode(pkgId);
      } else if (key === "t") {
        e.preventDefault();
        addChannel("topic");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    project,
    errorCount,
    saveNow,
    openGeneratePreview,
    addPackage,
    addNode,
    addChannel,
  ]);

  const canUndo = useProjectStore.temporal.getState().pastStates.length > 0;
  const canRedo = useProjectStore.temporal.getState().futureStates.length > 0;

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Top Toolbar (F1.4) */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 text-slate-950">
              <Workflow className="h-4 w-4" />
            </div>
            <span className="text-sm font-bold tracking-tight">RosForge</span>
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />

          {/* Workspace Picker + Save */}
          <button
            type="button"
            onClick={() => setWorkspaceModalOpen(true)}
            className="inline-flex max-w-[200px] items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
            title={project ? project.workspacePath : "Open or create workspace"}
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sky-500" />
            <span className="truncate">{project ? project.name : "Open Workspace…"}</span>
            {dirty && (
              <span
                title="Unsaved changes"
                className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
              />
            )}
          </button>

          {project && (
            <>
              <button
                type="button"
                disabled={saving || !dirty}
                onClick={() => void saveNow()}
                title="Save project (Ctrl+S)"
                className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Save className="h-3.5 w-3.5" />
              </button>

              <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />

              {/* Undo / Redo (F1.3) */}
              <button
                type="button"
                disabled={!canUndo}
                onClick={() => {
                  useProjectStore.temporal.getState().undo();
                  void useProjectStore.getState().runValidation();
                }}
                title="Undo (Ctrl+Z)"
                className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={!canRedo}
                onClick={() => {
                  useProjectStore.temporal.getState().redo();
                  void useProjectStore.getState().runValidation();
                }}
                title="Redo (Ctrl+Shift+Z)"
                className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                disabled={layingOut}
                onClick={() => void handleAutoLayout()}
                title="Auto-layout graph (ELK)"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Layout
              </button>

              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                title="Find on canvas (Ctrl+F)"
                className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Search className="h-3.5 w-3.5" />
              </button>
            </>
          )}

          <div className="hidden h-4 w-px bg-slate-200 dark:bg-slate-800 md:block" />

          {/* Generate / Build / Run */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!project || errorCount > 0}
              onClick={() => void openGeneratePreview()}
              title={
                !project
                  ? "Open a workspace first"
                  : errorCount > 0
                    ? `Blocked: fix ${errorCount} validation error(s) first`
                    : "Preview & Generate ROS 2 packages (Ctrl+G)"
              }
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Generate
            </button>
            <button
              type="button"
              disabled
              title="Available in M2"
              className="hidden items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-400 dark:border-slate-800 dark:text-slate-600 lg:inline-flex"
            >
              <Hammer className="h-3.5 w-3.5" />
              Build
            </button>
            <button
              type="button"
              disabled
              title="Available in M2"
              className="hidden items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-400 dark:border-slate-800 dark:text-slate-600 lg:inline-flex"
            >
              <Play className="h-3.5 w-3.5" />
              Run
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs dark:border-slate-800 dark:bg-slate-950">
            <span
              className={`h-2 w-2 rounded-full ${
                rosHealth?.available
                  ? "bg-emerald-500"
                  : rosHealth
                    ? "bg-amber-500"
                    : "bg-slate-400"
              }`}
            />
            <span className="text-slate-700 dark:text-slate-300">
              {rosHealth?.available
                ? `ROS 2 ${rosHealth.rosDistro ?? "OK"}`
                : rosHealth
                  ? "ROS 2 Missing"
                  : "Checking ROS…"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => void toggleTheme()}
            aria-label="Toggle theme"
            title={`Switch to ${settings.theme === "dark" ? "light" : "dark"} theme`}
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            {settings.theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
            title="Settings"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            Settings
          </button>
        </div>
      </header>

      {/* F0.4 ROS Health Banner */}
      <RosHealthBanner />

      {/* Main Workspace Area: Palette | Canvas + BottomPanel | Inspector */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Palette />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className="flex min-h-0 flex-1 overflow-hidden">
            <GraphCanvas
              searchOpen={searchOpen}
              onCloseSearch={() => setSearchOpen(false)}
            />
          </main>
          <BottomPanel />
        </div>

        <Inspector />
      </div>

      {/* Status Bar */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-3 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              errorMessage || errorCount > 0
                ? "bg-rose-500"
                : bootstrapping || saving
                  ? "animate-pulse bg-sky-500"
                  : "bg-emerald-500"
            }`}
          />
          <span className="truncate">
            {saving
              ? "Saving workspace…"
              : errorMessage ??
                (project
                  ? `${project.workspacePath} · ${errorCount} error(s), ${warningCount} warning(s)`
                  : statusMessage)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-3 font-mono">
          <span>DOMAIN={settings.rosDomainId}</span>
          <span>v{pingResult?.appVersion ?? "0.1.0"}</span>
        </div>
      </footer>

      <SettingsModal />
      <WorkspaceModal />
      <GeneratePreviewModal />
    </div>
  );
}
