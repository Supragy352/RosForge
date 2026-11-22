import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Hammer,
  Info,
  Play,
  RotateCcw,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useProjectStore } from "../store/useProjectStore";
import { useRunnerStore, type StreamLine } from "../store/useRunnerStore";
import { parseAnsi } from "../utils/ansi";

function AnsiLine({ entry }: { entry: StreamLine }) {
  const segments = useMemo(() => parseAnsi(entry.line), [entry.line]);
  const fallbackColor =
    entry.stream === "system"
      ? "text-sky-400"
      : entry.stream === "stderr"
        ? "text-rose-300/90"
        : "text-slate-700 dark:text-slate-200";

  return (
    <div className={`whitespace-pre-wrap break-all leading-relaxed ${fallbackColor}`}>
      {segments.map((seg, idx) => (
        <span key={idx} className={seg.className}>
          {seg.text}
        </span>
      ))}
    </div>
  );
}

const LOG_LEVELS = ["ALL", "INFO", "WARN", "ERROR", "DEBUG", "FATAL"] as const;

export function BottomPanel() {
  const project = useProjectStore((s) => s.project);
  const validationDiagnostics = useProjectStore((s) => s.diagnostics);
  const outputLog = useProjectStore((s) => s.outputLog);
  const bottomTab = useProjectStore((s) => s.bottomTab);
  const bottomPanelOpen = useProjectStore((s) => s.bottomPanelOpen);
  const setBottomTab = useProjectStore((s) => s.setBottomTab);
  const setBottomPanelOpen = useProjectStore((s) => s.setBottomPanelOpen);
  const setSelected = useProjectStore((s) => s.setSelected);
  const requestFocusTarget = useProjectStore((s) => s.requestFocusTarget);

  const building = useRunnerStore((s) => s.building);
  const buildLines = useRunnerStore((s) => s.buildLines);
  const buildDiagnostics = useRunnerStore((s) => s.buildDiagnostics);
  const lastBuild = useRunnerStore((s) => s.lastBuild);
  const cancelBuild = useRunnerStore((s) => s.cancelBuild);
  const clearBuildLogs = useRunnerStore((s) => s.clearBuildLogs);

  const runs = useRunnerStore((s) => s.runs);
  const activeRunId = useRunnerStore((s) => s.activeRunId);
  const setActiveRunId = useRunnerStore((s) => s.setActiveRunId);
  const stopRun = useRunnerStore((s) => s.stopRun);
  const restartRun = useRunnerStore((s) => s.restartRun);
  const closeRunTab = useRunnerStore((s) => s.closeRunTab);
  const clearRunLogs = useRunnerStore((s) => s.clearRunLogs);
  const openInEditor = useRunnerStore((s) => s.openInEditor);

  const [nodeFilter, setNodeFilter] = useState<string>("ALL");
  const [levelFilter, setLevelFilter] = useState<string>("ALL");

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const allDiagnostics = useMemo(
    () => [...buildDiagnostics, ...validationDiagnostics],
    [buildDiagnostics, validationDiagnostics]
  );

  const errorCount = allDiagnostics.filter((d) => d.severity === "error").length;
  const warningCount = allDiagnostics.filter((d) => d.severity === "warning").length;
  const activeRunningCount = runs.filter((r) => r.status === "running").length;

  const activeRun = useMemo(
    () => runs.find((r) => r.runId === activeRunId) ?? runs[runs.length - 1] ?? null,
    [runs, activeRunId]
  );

  const availableNodePrefixes = useMemo(() => {
    if (!activeRun) return [];
    const set = new Set<string>();
    for (const l of activeRun.lines) {
      if (l.nodePrefix) set.add(l.nodePrefix);
    }
    return Array.from(set).sort();
  }, [activeRun]);

  const filteredRunLines = useMemo(() => {
    if (!activeRun) return [];
    return activeRun.lines.filter((l) => {
      if (l.stream === "system") return true;
      if (nodeFilter !== "ALL" && l.nodePrefix !== nodeFilter) return false;
      if (levelFilter !== "ALL" && l.level !== levelFilter) return false;
      return true;
    });
  }, [activeRun, nodeFilter, levelFilter]);

  // Reset per-tab filters when switching run tabs
  useEffect(() => {
    setNodeFilter("ALL");
    setLevelFilter("ALL");
  }, [activeRun?.runId]);

  // Auto-scroll streaming logs
  useEffect(() => {
    if (!bottomPanelOpen) return;
    if (bottomTab === "build" || bottomTab === "run") {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [bottomPanelOpen, bottomTab, buildLines.length, filteredRunLines.length]);

  const selectDiagnosticTarget = (
    targetId?: string | null,
    file?: string | null,
    line?: number | null
  ) => {
    if (file) {
      void openInEditor(file, line ?? 1);
      return;
    }
    if (!targetId || !project) return;
    if (project.channels.some((c) => c.id === targetId)) {
      setSelected({ kind: "channel", id: targetId });
      requestFocusTarget(targetId);
      return;
    }
    for (const pkg of project.packages) {
      if (pkg.id === targetId) {
        setSelected({ kind: "package", id: pkg.id });
        requestFocusTarget(pkg.id);
        return;
      }
      for (const node of pkg.nodes) {
        if (
          node.id === targetId ||
          node.ports.some((pt) => pt.id === targetId) ||
          node.params.some((pr) => pr.id === targetId) ||
          node.timers.some((t) => t.id === targetId)
        ) {
          setSelected({ kind: "node", id: node.id, packageId: pkg.id });
          requestFocusTarget(node.id);
          return;
        }
      }
    }
  };

  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${
      active && bottomPanelOpen
        ? "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
        : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
    }`;

  return (
    <section
      className={`flex shrink-0 flex-col border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${
        bottomPanelOpen ? "h-56" : "h-9"
      }`}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-800">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setBottomPanelOpen(true);
              setBottomTab("problems");
            }}
            className={tabClass(bottomTab === "problems")}
          >
            Problems
            {errorCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-500/20 px-1.5 text-[10px] font-bold text-rose-500">
                {errorCount}
              </span>
            )}
            {warningCount > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] font-bold text-amber-500">
                {warningCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setBottomPanelOpen(true);
              setBottomTab("build");
            }}
            className={tabClass(bottomTab === "build")}
          >
            <Hammer className="h-3 w-3" />
            Build
            {building ? (
              <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
            ) : lastBuild ? (
              <span
                className={`h-2 w-2 rounded-full ${
                  lastBuild.success
                    ? "bg-emerald-400"
                    : lastBuild.cancelled
                      ? "bg-amber-400"
                      : "bg-rose-500"
                }`}
              />
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => {
              setBottomPanelOpen(true);
              setBottomTab("run");
            }}
            className={tabClass(bottomTab === "run")}
          >
            <Play className="h-3 w-3" />
            Run
            {activeRunningCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-1.5 text-[10px] font-bold text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                {activeRunningCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setBottomPanelOpen(true);
              setBottomTab("output");
            }}
            className={tabClass(bottomTab === "output")}
          >
            <Terminal className="h-3 w-3" />
            Output
          </button>
        </div>

        {/* Context actions on right side of bottom tab bar */}
        <div className="flex items-center gap-1.5">
          {bottomPanelOpen && bottomTab === "build" && (
            <>
              {building && (
                <button
                  type="button"
                  onClick={() => void cancelBuild()}
                  className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-400 hover:bg-rose-500/25"
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                  Cancel (SIGINT)
                </button>
              )}
              {buildLines.length > 0 && !building && (
                <button
                  type="button"
                  onClick={clearBuildLogs}
                  title="Clear build log"
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </>
          )}

          {bottomPanelOpen && bottomTab === "run" && activeRun && (
            <div className="flex items-center gap-1.5">
              {availableNodePrefixes.length > 0 && (
                <select
                  value={nodeFilter}
                  onChange={(e) => setNodeFilter(e.target.value)}
                  title="Filter by node prefix"
                  className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                >
                  <option value="ALL">All nodes</option>
                  {availableNodePrefixes.map((p) => (
                    <option key={p} value={p}>
                      [{p}]
                    </option>
                  ))}
                </select>
              )}
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                title="Filter by ROS log level"
                className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
              >
                {LOG_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl === "ALL" ? "All levels" : lvl}
                  </option>
                ))}
              </select>

              {activeRun.status === "running" && (
                <button
                  type="button"
                  onClick={() => void stopRun(activeRun.runId)}
                  className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-400 hover:bg-rose-500/25"
                >
                  <Square className="h-2.5 w-2.5 fill-current" />
                  Stop
                </button>
              )}
              <button
                type="button"
                disabled={building}
                onClick={() => void restartRun(activeRun.runId)}
                title="Restart this run"
                className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                Restart
              </button>
              <button
                type="button"
                onClick={() => clearRunLogs(activeRun.runId)}
                title="Clear run output"
                className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setBottomPanelOpen(!bottomPanelOpen)}
            title={bottomPanelOpen ? "Collapse panel" : "Expand panel"}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {bottomPanelOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Per-run sub-tabs strip when on Run tab */}
      {bottomPanelOpen && bottomTab === "run" && runs.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
          {runs.map((session) => {
            const isActive = activeRun?.runId === session.runId;
            return (
              <div
                key={session.runId}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] ${
                  isActive
                    ? "border-sky-500/50 bg-sky-500/10 text-slate-900 dark:text-slate-100"
                    : "border-transparent text-slate-500 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveRunId(session.runId)}
                  className="inline-flex items-center gap-1.5"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      session.status === "running"
                        ? "animate-pulse bg-emerald-400"
                        : session.status === "failed"
                          ? "bg-rose-500"
                          : "bg-slate-400"
                    }`}
                  />
                  <span className="max-w-[180px] truncate font-mono">{session.label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeRunTab(session.runId)}
                  title="Close run tab"
                  className="rounded p-0.5 text-slate-400 hover:text-slate-200"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {bottomPanelOpen && (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5 text-xs"
        >
          {bottomTab === "problems" ? (
            allDiagnostics.length === 0 ? (
              <div className="px-2 py-3 text-slate-500">
                No problems detected in workspace.
              </div>
            ) : (
              <div className="space-y-0.5">
                {allDiagnostics.map((d, idx) => (
                  <button
                    key={`${d.targetId ?? d.file ?? "global"}-${idx}`}
                    type="button"
                    onClick={() => selectDiagnosticTarget(d.targetId, d.file, d.line)}
                    className="flex w-full items-start justify-between gap-2 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      {d.severity === "error" ? (
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                      ) : d.severity === "warning" ? (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                      ) : (
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
                      )}
                      <span className="break-words text-slate-800 dark:text-slate-200">
                        {d.message}
                      </span>
                    </div>
                    {d.file && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] text-sky-600 dark:bg-slate-800 dark:text-sky-300">
                        {d.file.split(/[\\/]/).pop()}
                        {d.line ? `:${d.line}` : ""}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )
          ) : bottomTab === "build" ? (
            buildLines.length === 0 ? (
              <div className="px-2 py-3 font-mono text-slate-500">
                Click Build (Ctrl+B) to run colcon build --symlink-install.
              </div>
            ) : (
              <div className="space-y-0.5 px-2 font-mono text-[11px]">
                {buildLines.map((entry) => (
                  <AnsiLine key={entry.id} entry={entry} />
                ))}
              </div>
            )
          ) : bottomTab === "run" ? (
            !activeRun ? (
              <div className="px-2 py-3 font-mono text-slate-500">
                Click Run (F5) or right-click a node on the canvas to launch ROS 2 nodes.
              </div>
            ) : filteredRunLines.length === 0 ? (
              <div className="px-2 py-3 font-mono text-slate-500">
                Waiting for output…
              </div>
            ) : (
              <div className="space-y-0.5 px-2 font-mono text-[11px]">
                {filteredRunLines.map((entry) => (
                  <AnsiLine key={entry.id} entry={entry} />
                ))}
              </div>
            )
          ) : outputLog.length === 0 ? (
            <div className="px-2 py-3 font-mono text-slate-500">
              No output messages yet.
            </div>
          ) : (
            <div className="space-y-0.5 font-mono text-[11px]">
              {outputLog.map((entry) => (
                <div key={entry.id} className="flex gap-2 px-2 py-0.5">
                  <span className="shrink-0 text-slate-500">[{entry.ts}]</span>
                  <span
                    className={
                      entry.level === "error"
                        ? "text-rose-400"
                        : entry.level === "warn"
                          ? "text-amber-400"
                          : "text-slate-700 dark:text-slate-300"
                    }
                  >
                    {entry.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
