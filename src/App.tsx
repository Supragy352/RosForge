import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bug,
  Check,
  ChevronDown,
  ClipboardCopy,
  Cpu,
  FolderOpen,
  Hammer,
  LayoutGrid,
  Loader2,
  Moon,
  Package as PackageIcon,
  Play,
  Redo2,
  Rocket,
  Save,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Square,
  Sun,
  Terminal,
  Trash2,
  Undo2,
  Workflow,
} from "lucide-react";
import { commands } from "./bindings";
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
import { useRunnerStore } from "./store/useRunnerStore";

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
  const setBottomTab = useProjectStore((s) => s.setBottomTab);

  const initRunnerListeners = useRunnerStore((s) => s.initListeners);
  const building = useRunnerStore((s) => s.building);
  const runs = useRunnerStore((s) => s.runs);
  const buildDiagnostics = useRunnerStore((s) => s.buildDiagnostics);
  const buildProject = useRunnerStore((s) => s.buildProject);
  const cancelBuild = useRunnerStore((s) => s.cancelBuild);
  const cleanWorkspace = useRunnerStore((s) => s.cleanWorkspace);
  const runWholeProject = useRunnerStore((s) => s.runWholeProject);
  const runPackageLaunch = useRunnerStore((s) => s.runPackageLaunch);
  const runSingleNode = useRunnerStore((s) => s.runSingleNode);

  const [searchOpen, setSearchOpen] = useState(false);
  const [layingOut, setLayingOut] = useState(false);
  const [inspectMenuOpen, setInspectMenuOpen] = useState(false);
  const [buildMenuOpen, setBuildMenuOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [copiedSnapshot, setCopiedSnapshot] = useState(false);
  const inspectMenuRef = useRef<HTMLDivElement | null>(null);
  const buildMenuRef = useRef<HTMLDivElement | null>(null);
  const runMenuRef = useRef<HTMLDivElement | null>(null);

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const buildErrorCount = buildDiagnostics.filter((d) => d.severity === "error").length;
  const activeRunCount = runs.filter((r) => r.status === "running").length;

  useEffect(() => {
    void bootstrap().then(() => {
      void loadCatalog(false);
    });
  }, [bootstrap, loadCatalog]);

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let disposed = false;
    void initRunnerListeners().then((fn) => {
      if (disposed) {
        fn();
      } else {
        cleanup = fn;
      }
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [initRunnerListeners]);

  useEffect(() => {
    if (!inspectMenuOpen && !buildMenuOpen && !runMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        inspectMenuOpen &&
        inspectMenuRef.current &&
        !inspectMenuRef.current.contains(target)
      ) {
        setInspectMenuOpen(false);
      }
      if (
        buildMenuOpen &&
        buildMenuRef.current &&
        !buildMenuRef.current.contains(target)
      ) {
        setBuildMenuOpen(false);
      }
      if (
        runMenuOpen &&
        runMenuRef.current &&
        !runMenuRef.current.contains(target)
      ) {
        setRunMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [inspectMenuOpen, buildMenuOpen, runMenuOpen]);

  const handleOpenDevtools = useCallback(
    async (toggle = false) => {
      try {
        await commands.openDevtools(toggle);
      } catch (err) {
        appendLog("error", `Failed to open Web Inspector: ${String(err)}`);
      }
    },
    [appendLog]
  );

  const handleCopyDebugSnapshot = useCallback(async () => {
    const pState = useProjectStore.getState();
    const aState = useAppStore.getState();
    const domNodes = Array.from(
      document.querySelectorAll<HTMLElement>(".react-flow__node")
    ).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.id ?? el.getAttribute("data-id"),
        classes: el.className,
        rect: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
      };
    });

    const snapshot = {
      capturedAt: new Date().toISOString(),
      appVersion: aState.pingResult?.appVersion ?? "0.1.0",
      platform: aState.pingResult?.platform ?? navigator.platform,
      window: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        theme: aState.settings.theme,
      },
      rosHealth: aState.rosHealth,
      project: pState.project
        ? {
            name: pState.project.name,
            workspacePath: pState.project.workspacePath,
            dirty: pState.dirty,
            counts: {
              packages: pState.project.packages.length,
              nodes: pState.project.packages.reduce((acc, p) => acc + p.nodes.length, 0),
              channels: pState.project.channels.length,
            },
            positions: pState.project.canvas.positions,
          }
        : null,
      selected: pState.selected,
      domNodes,
      diagnostics: pState.diagnostics,
      recentLogs: pState.outputLog.slice(-15),
    };

    const text = JSON.stringify(snapshot, null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }

    setCopiedSnapshot(true);
    appendLog("info", "Copied RosForge debug snapshot JSON to clipboard.");
    window.setTimeout(() => setCopiedSnapshot(false), 1800);
  }, [appendLog]);

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

  // Global keyboard shortcuts (SPEC §5 & F1.2 / F1.3 / F1.11 + F12 Web Inspector)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (e.key === "F12" || (mod && e.shiftKey && key === "i")) {
        e.preventDefault();
        void handleOpenDevtools(true);
        return;
      }

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
      if (mod && key === "b") {
        e.preventDefault();
        if (project && rosHealth?.available) {
          if (building) {
            setBottomTab("build");
          } else {
            void buildProject("project");
          }
        }
        return;
      }
      if (e.key === "F5") {
        e.preventDefault();
        if (project && rosHealth?.available && !building && project.packages.length > 0) {
          void runWholeProject();
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
    rosHealth,
    building,
    errorCount,
    saveNow,
    openGeneratePreview,
    buildProject,
    runWholeProject,
    setBottomTab,
    addPackage,
    addNode,
    addChannel,
    handleOpenDevtools,
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

            {/* Build Split Button (F2.1 / F2.2) */}
            <div ref={buildMenuRef} className="relative inline-flex">
              <button
                type="button"
                disabled={!project || !rosHealth?.available}
                onClick={() => {
                  if (building) {
                    void cancelBuild();
                  } else {
                    void buildProject("project");
                  }
                }}
                title={
                  !project
                    ? "Open a workspace first"
                    : !rosHealth?.available
                      ? "ROS 2 environment not detected"
                      : building
                        ? "Cancel active colcon build (SIGINT)"
                        : "Build project packages with colcon (Ctrl+B)"
                }
                className={`inline-flex items-center gap-1.5 rounded-l-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  building
                    ? "border-amber-500/60 bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                {building ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
                    <span>Cancel</span>
                  </>
                ) : (
                  <>
                    <Hammer className="h-3.5 w-3.5 text-amber-500" />
                    <span>Build</span>
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={!project || !rosHealth?.available}
                onClick={() => {
                  setRunMenuOpen(false);
                  setBuildMenuOpen((v) => !v);
                }}
                aria-label="Build options"
                title="Build & Clean options"
                className="inline-flex items-center rounded-r-md border border-l-0 border-slate-200 bg-white px-1.5 py-1 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ChevronDown className="h-3 w-3" />
              </button>

              {buildMenuOpen && project && (
                <div className="absolute left-0 top-full z-50 mt-1.5 w-64 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    disabled={building}
                    onClick={() => {
                      setBuildMenuOpen(false);
                      void buildProject("project");
                    }}
                    className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Hammer className="h-3.5 w-3.5 text-amber-500" />
                      Build Project Packages
                    </span>
                    <kbd className="rounded border border-slate-300 px-1 py-0.5 font-mono text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      Ctrl+B
                    </kbd>
                  </button>
                  <button
                    type="button"
                    disabled={building}
                    onClick={() => {
                      setBuildMenuOpen(false);
                      void buildProject("all");
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <PackageIcon className="h-3.5 w-3.5 text-sky-500" />
                    <span>Build All Workspace Packages</span>
                  </button>

                  {building && (
                    <button
                      type="button"
                      onClick={() => {
                        setBuildMenuOpen(false);
                        void cancelBuild();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                    >
                      <Square className="h-3.5 w-3.5" />
                      <span>Cancel Active Build (SIGINT)</span>
                    </button>
                  )}

                  <div className="my-1 border-t border-slate-200 dark:border-slate-800" />

                  <button
                    type="button"
                    disabled={building || project.packages.length === 0}
                    onClick={() => {
                      setBuildMenuOpen(false);
                      const names = project.packages.map((p) => p.name).join(", ");
                      if (
                        window.confirm(
                          `Remove build/ and install/ artifacts for project package(s): ${names}?`
                        )
                      ) {
                        void cleanWorkspace(false);
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-40 dark:text-slate-300 dark:hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    <span>Clean Project Packages…</span>
                  </button>
                  <button
                    type="button"
                    disabled={building}
                    onClick={() => {
                      setBuildMenuOpen(false);
                      if (
                        window.confirm(
                          `Delete entire build/, install/, and log/ directories inside ${project.workspacePath}?`
                        )
                      ) {
                        void cleanWorkspace(true);
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-rose-600 hover:bg-rose-500/10 disabled:opacity-40 dark:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Clean Entire Workspace…</span>
                  </button>
                </div>
              )}
            </div>

            {/* Run Split Button (F2.4 / F2.5 / F2.6) */}
            <div ref={runMenuRef} className="relative inline-flex">
              <button
                type="button"
                disabled={
                  !project ||
                  !rosHealth?.available ||
                  building ||
                  project.packages.length === 0
                }
                onClick={() => void runWholeProject()}
                title={
                  !project
                    ? "Open a workspace first"
                    : !rosHealth?.available
                      ? "ROS 2 environment not detected"
                      : building
                        ? "Wait for active build to finish before running"
                        : project.packages.length === 0
                          ? "Add at least one package to run"
                          : "Run whole project via aggregated launch file (F5)"
                }
                className="inline-flex items-center gap-1.5 rounded-l-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-transparent disabled:text-slate-400 dark:text-emerald-300 dark:disabled:border-slate-800 dark:disabled:text-slate-600"
              >
                <Play className="h-3.5 w-3.5" />
                <span>Run</span>
                {activeRunCount > 0 && (
                  <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-500 px-1 font-mono text-[10px] font-bold text-slate-950">
                    {activeRunCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                disabled={!project || !rosHealth?.available || building}
                onClick={() => {
                  setBuildMenuOpen(false);
                  setRunMenuOpen((v) => !v);
                }}
                aria-label="Run targets"
                title="Choose launch target or single node"
                className="inline-flex items-center rounded-r-md border border-l-0 border-emerald-500/40 bg-emerald-500/10 px-1.5 py-1 text-emerald-700 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-transparent disabled:text-slate-400 dark:text-emerald-300 dark:disabled:border-slate-800 dark:disabled:text-slate-600"
              >
                <ChevronDown className="h-3 w-3" />
              </button>

              {runMenuOpen && project && (
                <div className="absolute left-0 top-full z-50 mt-1.5 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <button
                    type="button"
                    disabled={building || project.packages.length === 0}
                    onClick={() => {
                      setRunMenuOpen(false);
                      void runWholeProject();
                    }}
                    className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs font-medium text-slate-800 hover:bg-emerald-500/15 dark:text-slate-100"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Rocket className="h-3.5 w-3.5 text-emerald-500" />
                      Run Whole Project
                    </span>
                    <kbd className="rounded border border-slate-300 px-1 py-0.5 font-mono text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      F5
                    </kbd>
                  </button>

                  {project.packages.length > 0 && (
                    <>
                      <div className="mt-1.5 px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Package Launch Files
                      </div>
                      {project.packages.map((pkg) => (
                        <button
                          key={`launch-${pkg.id}`}
                          type="button"
                          disabled={building || pkg.nodes.length === 0}
                          onClick={() => {
                            setRunMenuOpen(false);
                            void runPackageLaunch(pkg);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <span className="inline-flex min-w-0 items-center gap-2">
                            <PackageIcon className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                            <span className="truncate font-mono">{pkg.name}</span>
                          </span>
                          <span className="ml-2 shrink-0 text-[10px] text-slate-400">
                            {pkg.nodes.length} node{pkg.nodes.length === 1 ? "" : "s"}
                          </span>
                        </button>
                      ))}
                    </>
                  )}

                  {project.packages.some((p) => p.nodes.length > 0) && (
                    <>
                      <div className="mt-1.5 border-t border-slate-200 px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                        Single Nodes (ros2 run)
                      </div>
                      {project.packages.flatMap((pkg) =>
                        pkg.nodes.map((node) => (
                          <button
                            key={`node-${node.id}`}
                            type="button"
                            disabled={building}
                            onClick={() => {
                              setRunMenuOpen(false);
                              void runSingleNode(pkg, node);
                            }}
                            className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <Cpu className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                              <span className="truncate font-mono">{node.name}</span>
                            </span>
                            <span className="ml-2 shrink-0 font-mono text-[10px] text-slate-400">
                              {pkg.name}
                            </span>
                          </button>
                        ))
                      )}
                    </>
                  )}

                  <div className="mt-1.5 flex items-center justify-between border-t border-slate-200 px-2.5 pt-1.5 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <span>
                      Build before run:{" "}
                      <strong
                        className={
                          settings.buildBeforeRun
                            ? "text-emerald-500"
                            : "text-slate-400"
                        }
                      >
                        {settings.buildBeforeRun ? "ON" : "OFF"}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setRunMenuOpen(false);
                        setSettingsOpen(true);
                      }}
                      className="text-sky-500 hover:underline"
                    >
                      Configure
                    </button>
                  </div>
                </div>
              )}
            </div>
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

          <div ref={inspectMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setInspectMenuOpen((v) => !v)}
              aria-label="Inspect & Debug tools"
              title="Web Inspector (F12) & Copy Debug Snapshot"
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                copiedSnapshot
                  ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                  : "border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              {copiedSnapshot ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Bug className="h-3.5 w-3.5" />
              )}
              {copiedSnapshot ? "Copied!" : "Inspect"}
            </button>

            {inspectMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => {
                    setInspectMenuOpen(false);
                    void handleOpenDevtools(false);
                  }}
                  className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <span className="inline-flex items-center gap-2">
                    <Terminal className="h-3.5 w-3.5 text-sky-500" />
                    Open Web Inspector
                  </span>
                  <kbd className="rounded border border-slate-300 px-1 py-0.5 font-mono text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    F12
                  </kbd>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInspectMenuOpen(false);
                    void handleCopyDebugSnapshot();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ClipboardCopy className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Copy Debug Snapshot (JSON)</span>
                </button>
                <div className="mt-1 border-t border-slate-200 px-2.5 pt-1.5 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  Shortcut: <span className="font-mono">F12</span> or{" "}
                  <span className="font-mono">Ctrl+Shift+I</span>
                </div>
              </div>
            )}
          </div>

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
              building
                ? "animate-pulse bg-amber-400"
                : errorMessage || errorCount + buildErrorCount > 0
                  ? "bg-rose-500"
                  : bootstrapping || saving
                    ? "animate-pulse bg-sky-500"
                    : "bg-emerald-500"
            }`}
          />
          <span className="truncate">
            {building
              ? "Building workspace with colcon…"
              : saving
                ? "Saving workspace…"
                : errorMessage ??
                  (project
                    ? `${project.workspacePath} · ${errorCount + buildErrorCount} error(s), ${warningCount} warning(s)`
                    : statusMessage)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-3 font-mono">
          {activeRunCount > 0 && (
            <button
              type="button"
              onClick={() => setBottomTab("run")}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 hover:bg-emerald-500/25 dark:text-emerald-300"
              title="View running processes"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {activeRunCount} running
            </button>
          )}
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
