import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  commands,
  type BuildFinishedEvent,
  type BuildMode,
  type BuildOutputEvent,
  type Diagnostic,
  type Package,
  type RosNode,
  type RunExitedEvent,
  type RunOutputEvent,
  type RunRequest,
} from "../bindings";
import { useAppStore } from "./useAppStore";
import { useProjectStore } from "./useProjectStore";

export interface StreamLine {
  id: number;
  stream: "stdout" | "stderr" | "system";
  line: string;
  nodePrefix?: string | null;
  level?: string | null;
}

export interface RunSession {
  runId: string;
  label: string;
  command: string;
  request: RunRequest;
  nodeIds: string[];
  status: "running" | "stopped" | "exited" | "failed";
  exitCode: number | null;
  lines: StreamLine[];
  startedAt: number;
}

interface RunnerStoreState {
  initialized: boolean;
  building: boolean;
  activeBuildId: string | null;
  buildCommand: string | null;
  buildLines: StreamLine[];
  buildDiagnostics: Diagnostic[];
  lastBuild: {
    success: boolean;
    cancelled: boolean;
    exitCode: number | null;
    durationMs: number;
  } | null;

  runs: RunSession[];
  activeRunId: string | null;
  pendingRunAfterBuild: RunRequest | null;

  initListeners: () => Promise<() => void>;
  buildProject: (mode: BuildMode, queuedRun?: RunRequest | null) => Promise<boolean>;
  cancelBuild: () => Promise<void>;
  cleanWorkspace: (cleanAll: boolean) => Promise<void>;
  clearBuildLogs: () => void;

  startRunDirect: (req: RunRequest) => Promise<boolean>;
  runWithBuildPolicy: (req: RunRequest, skipBuild?: boolean) => Promise<boolean>;
  runWholeProject: (skipBuild?: boolean) => Promise<boolean>;
  runPackageLaunch: (pkg: Package, launchFileName?: string, skipBuild?: boolean) => Promise<boolean>;
  runSingleNode: (pkg: Package, node: RosNode, skipBuild?: boolean) => Promise<boolean>;
  stopRun: (runId: string) => Promise<void>;
  restartRun: (runId: string) => Promise<void>;
  closeRunTab: (runId: string) => void;
  clearRunLogs: (runId: string) => void;
  setActiveRunId: (runId: string | null) => void;

  openInEditor: (file: string, line?: number | null) => Promise<void>;
  openNodeSource: (pkg: Package, node: RosNode) => Promise<void>;
}

let lineSeq = 1;
const MAX_LINES = 4000;

function nextLine(
  stream: StreamLine["stream"],
  line: string,
  nodePrefix?: string | null,
  level?: string | null
): StreamLine {
  return { id: lineSeq++, stream, line, nodePrefix, level };
}

function appendCapped(lines: StreamLine[], entry: StreamLine): StreamLine[] {
  if (lines.length >= MAX_LINES) {
    return [...lines.slice(lines.length - MAX_LINES + 1), entry];
  }
  return [...lines, entry];
}

function formatErr(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function resolveNodeSourcePath(
  workspacePath: string,
  pkg: Package,
  node: RosNode
): string {
  const ws = workspacePath.replace(/\/+$/, "");
  if (node.sourceFile && node.sourceFile.trim()) {
    const sf = node.sourceFile.trim();
    if (sf.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(sf)) {
      return sf;
    }
    return `${ws}/${sf.replace(/^\/+/, "")}`;
  }
  if (pkg.lang === "python") {
    return `${ws}/src/${pkg.name}/${pkg.name}/${node.name}.py`;
  }
  return `${ws}/src/${pkg.name}/src/${node.name}.cpp`;
}

export const useRunnerStore = create<RunnerStoreState>((set, get) => ({
  initialized: false,
  building: false,
  activeBuildId: null,
  buildCommand: null,
  buildLines: [],
  buildDiagnostics: [],
  lastBuild: null,
  runs: [],
  activeRunId: null,
  pendingRunAfterBuild: null,

  initListeners: async () => {
    if (get().initialized) {
      return () => {};
    }
    set({ initialized: true });

    const unlisteners: UnlistenFn[] = [];
    try {
      unlisteners.push(
        await listen<BuildOutputEvent>("rosforge:build-output", (event) => {
          const { buildId, stream, line } = event.payload;
          set((s) => {
            if (s.activeBuildId && s.activeBuildId !== buildId) return s;
            return {
              buildLines: appendCapped(
                s.buildLines,
                nextLine(stream === "stderr" ? "stderr" : "stdout", line)
              ),
            };
          });
        })
      );

      unlisteners.push(
        await listen<BuildFinishedEvent>("rosforge:build-finished", (event) => {
          const ev = event.payload;
          const queued = get().pendingRunAfterBuild;
          const statusLine = ev.cancelled
            ? `Build cancelled after ${(ev.durationMs / 1000).toFixed(1)}s.`
            : ev.success
              ? `Build succeeded in ${(ev.durationMs / 1000).toFixed(1)}s.`
              : `Build failed (exit ${ev.exitCode ?? "?"}) in ${(ev.durationMs / 1000).toFixed(1)}s — ${ev.diagnostics.length} diagnostic(s).`;

          set((s) => ({
            building: false,
            activeBuildId: null,
            pendingRunAfterBuild: null,
            buildDiagnostics: ev.diagnostics,
            lastBuild: {
              success: ev.success,
              cancelled: ev.cancelled,
              exitCode: ev.exitCode,
              durationMs: ev.durationMs,
            },
            buildLines: appendCapped(s.buildLines, nextLine("system", statusLine)),
          }));

          useProjectStore
            .getState()
            .appendLog(ev.success ? "info" : ev.cancelled ? "warn" : "error", statusLine);

          if (ev.success && queued) {
            void get().startRunDirect(queued);
          } else if (!ev.success && ev.diagnostics.length > 0) {
            useProjectStore.getState().setBottomTab("problems");
          }
        })
      );

      unlisteners.push(
        await listen<RunOutputEvent>("rosforge:run-output", (event) => {
          const ev = event.payload;
          set((s) => ({
            runs: s.runs.map((r) =>
              r.runId === ev.runId
                ? {
                    ...r,
                    lines: appendCapped(
                      r.lines,
                      nextLine(
                        ev.stream === "stderr" ? "stderr" : "stdout",
                        ev.line,
                        ev.nodePrefix,
                        ev.level
                      )
                    ),
                  }
                : r
            ),
          }));
        })
      );

      unlisteners.push(
        await listen<RunExitedEvent>("rosforge:run-exited", (event) => {
          const ev = event.payload;
          set((s) => ({
            runs: s.runs.map((r) => {
              if (r.runId !== ev.runId) return r;
              const status: RunSession["status"] = ev.stopped
                ? "stopped"
                : ev.exitCode === 0
                  ? "exited"
                  : "failed";
              const msg = ev.stopped
                ? "Process stopped (SIGINT)."
                : `Process exited with code ${ev.exitCode ?? "?"}.`;
              return {
                ...r,
                status,
                exitCode: ev.exitCode,
                lines: appendCapped(r.lines, nextLine("system", msg)),
              };
            }),
          }));
        })
      );
    } catch {
      // Running in non-Tauri Vitest/browser environment — ignore event listener errors
    }

    return () => {
      for (const un of unlisteners) un();
      set({ initialized: false });
    };
  },

  buildProject: async (mode, queuedRun = null) => {
    const project = useProjectStore.getState().project;
    if (!project) return false;
    if (get().building) {
      useProjectStore.getState().appendLog("warn", "A build is already running.");
      return false;
    }

    const packages = project.packages.map((p) => p.name);
    if (mode === "project" && packages.length === 0) {
      useProjectStore
        .getState()
        .appendLog("warn", "No packages in project to build.");
      return false;
    }

    useProjectStore.getState().setBottomPanelOpen(true);
    useProjectStore.getState().setBottomTab("build");

    set({
      building: true,
      buildLines: [
        nextLine(
          "system",
          `Starting colcon build (${mode === "all" ? "all packages" : packages.join(", ")})…`
        ),
      ],
      buildDiagnostics: [],
      lastBuild: null,
      pendingRunAfterBuild: queuedRun,
    });

    try {
      const resp = await commands.startBuild({
        workspacePath: project.workspacePath,
        mode,
        packages,
      });
      set((s) => ({
        activeBuildId: resp.buildId,
        buildCommand: resp.command,
        buildLines: appendCapped(s.buildLines, nextLine("system", `$ ${resp.command}`)),
      }));
      useProjectStore.getState().appendLog("info", `Started build: ${resp.command}`);
      return true;
    } catch (err) {
      const msg = formatErr(err);
      set((s) => ({
        building: false,
        activeBuildId: null,
        pendingRunAfterBuild: null,
        buildLines: appendCapped(s.buildLines, nextLine("stderr", `Error: ${msg}`)),
      }));
      useProjectStore.getState().appendLog("error", `Build failed to start: ${msg}`);
      return false;
    }
  },

  cancelBuild: async () => {
    try {
      await commands.cancelBuild();
      set((s) => ({
        pendingRunAfterBuild: null,
        buildLines: appendCapped(s.buildLines, nextLine("system", "Sending SIGINT to build…")),
      }));
    } catch (err) {
      useProjectStore
        .getState()
        .appendLog("error", `Cancel build failed: ${formatErr(err)}`);
    }
  },

  cleanWorkspace: async (cleanAll) => {
    const project = useProjectStore.getState().project;
    if (!project) return;
    try {
      const res = await commands.cleanWorkspace({
        workspacePath: project.workspacePath,
        packages: project.packages.map((p) => p.name),
        cleanAll,
      });
      const summary =
        res.removedPaths.length > 0
          ? `Cleaned ${res.removedPaths.length} build/install/log director(y/ies).`
          : "Nothing to clean (build/install/log already clean).";
      useProjectStore.getState().appendLog("info", summary);
      set((s) => ({
        buildLines: appendCapped(s.buildLines, nextLine("system", summary)),
        buildDiagnostics: [],
      }));
    } catch (err) {
      useProjectStore
        .getState()
        .appendLog("error", `Clean failed: ${formatErr(err)}`);
    }
  },

  clearBuildLogs: () => set({ buildLines: [], buildDiagnostics: [] }),

  startRunDirect: async (req) => {
    if (get().building) {
      useProjectStore
        .getState()
        .appendLog("warn", "Cannot start run while a build is in progress.");
      return false;
    }

    try {
      const resp = await commands.startRun(req);
      const session: RunSession = {
        runId: resp.runId,
        label: resp.label,
        command: resp.command,
        request: req,
        nodeIds: resp.nodeIds,
        status: "running",
        exitCode: null,
        lines: [nextLine("system", `$ ${resp.command}`)],
        startedAt: Date.now(),
      };
      set((s) => ({
        runs: [...s.runs, session],
        activeRunId: resp.runId,
      }));
      useProjectStore.getState().setBottomPanelOpen(true);
      useProjectStore.getState().setBottomTab("run");
      useProjectStore.getState().appendLog("info", `Started run '${resp.label}': ${resp.command}`);
      return true;
    } catch (err) {
      useProjectStore
        .getState()
        .appendLog("error", `Run failed to start: ${formatErr(err)}`);
      return false;
    }
  },

  runWithBuildPolicy: async (req, skipBuild = false) => {
    if (get().building) {
      useProjectStore
        .getState()
        .appendLog("warn", "Cannot start run while a build is in progress.");
      return false;
    }
    const buildBeforeRun = useAppStore.getState().settings.buildBeforeRun ?? true;
    if (buildBeforeRun && !skipBuild) {
      return get().buildProject("project", req);
    }
    return get().startRunDirect(req);
  },

  runWholeProject: async (skipBuild = false) => {
    const project = useProjectStore.getState().project;
    if (!project) return false;
    const packages = project.packages
      .filter((p) => p.nodes.length > 0)
      .map((p) => ({
        packageName: p.name,
        launchFile: p.launchFiles[0]?.name || `${p.name}.launch.py`,
      }));
    if (packages.length === 0) {
      useProjectStore
        .getState()
        .appendLog("warn", "Add at least one node in a package before running the project.");
      return false;
    }
    const nodeIds = project.packages.flatMap((p) => p.nodes.map((n) => n.id));
    return get().runWithBuildPolicy(
      {
        workspacePath: project.workspacePath,
        label: `Project: ${project.name}`,
        target: {
          kind: "whole_project",
          packages,
          nodeIds,
        },
      },
      skipBuild
    );
  },

  runPackageLaunch: async (pkg, launchFileName, skipBuild = false) => {
    const project = useProjectStore.getState().project;
    if (!project) return false;
    const lf = launchFileName || pkg.launchFiles[0]?.name || `${pkg.name}.launch.py`;
    return get().runWithBuildPolicy(
      {
        workspacePath: project.workspacePath,
        label: `${pkg.name} (${lf})`,
        target: {
          kind: "package_launch",
          packageName: pkg.name,
          launchFile: lf,
          nodeIds: pkg.nodes.map((n) => n.id),
        },
      },
      skipBuild
    );
  },

  runSingleNode: async (pkg, node, skipBuild = false) => {
    const project = useProjectStore.getState().project;
    if (!project) return false;
    return get().runWithBuildPolicy(
      {
        workspacePath: project.workspacePath,
        label: `${pkg.name}/${node.name}`,
        target: {
          kind: "single_node",
          packageName: pkg.name,
          executable: node.executable || node.name,
          nodeId: node.id,
          nodeName: node.name,
        },
      },
      skipBuild
    );
  },

  stopRun: async (runId) => {
    try {
      await commands.stopRun(runId);
    } catch (err) {
      useProjectStore
        .getState()
        .appendLog("error", `Stop run failed: ${formatErr(err)}`);
    }
  },

  restartRun: async (runId) => {
    const existing = get().runs.find((r) => r.runId === runId);
    if (!existing) return;
    if (existing.status === "running") {
      await get().stopRun(runId);
      await new Promise((r) => setTimeout(r, 350));
    }
    // Remove old tab and start fresh with same request (skip build on quick restart)
    set((s) => ({
      runs: s.runs.filter((r) => r.runId !== runId),
    }));
    await get().startRunDirect(existing.request);
  },

  closeRunTab: (runId) => {
    const existing = get().runs.find((r) => r.runId === runId);
    if (existing?.status === "running") {
      void get().stopRun(runId);
    }
    set((s) => {
      const remaining = s.runs.filter((r) => r.runId !== runId);
      const nextActive =
        s.activeRunId === runId
          ? remaining[remaining.length - 1]?.runId ?? null
          : s.activeRunId;
      return { runs: remaining, activeRunId: nextActive };
    });
  },

  clearRunLogs: (runId) =>
    set((s) => ({
      runs: s.runs.map((r) => (r.runId === runId ? { ...r, lines: [] } : r)),
    })),

  setActiveRunId: (runId) => set({ activeRunId: runId }),

  openInEditor: async (file, line = 1) => {
    try {
      await commands.openInEditor(file, line ?? 1);
    } catch (err) {
      useProjectStore
        .getState()
        .appendLog("error", `Open in editor failed: ${formatErr(err)}`);
    }
  },

  openNodeSource: async (pkg, node) => {
    const project = useProjectStore.getState().project;
    if (!project) return;
    const filePath = resolveNodeSourcePath(project.workspacePath, pkg, node);
    await get().openInEditor(filePath, 1);
  },
}));
