import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Info, Terminal } from "lucide-react";
import { useProjectStore } from "../store/useProjectStore";

export function BottomPanel() {
  const project = useProjectStore((s) => s.project);
  const diagnostics = useProjectStore((s) => s.diagnostics);
  const outputLog = useProjectStore((s) => s.outputLog);
  const bottomTab = useProjectStore((s) => s.bottomTab);
  const bottomPanelOpen = useProjectStore((s) => s.bottomPanelOpen);
  const setBottomTab = useProjectStore((s) => s.setBottomTab);
  const setBottomPanelOpen = useProjectStore((s) => s.setBottomPanelOpen);
  const setSelected = useProjectStore((s) => s.setSelected);
  const requestFocusTarget = useProjectStore((s) => s.requestFocusTarget);

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;

  const selectDiagnosticTarget = (targetId?: string | null) => {
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

  return (
    <section
      className={`flex shrink-0 flex-col border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${
        bottomPanelOpen ? "h-44" : "h-9"
      }`}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-slate-200 px-3 dark:border-slate-800">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setBottomTab("problems")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${
              bottomTab === "problems" && bottomPanelOpen
                ? "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
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
            onClick={() => setBottomTab("output")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${
              bottomTab === "output" && bottomPanelOpen
                ? "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Terminal className="h-3 w-3" />
            Output
          </button>
        </div>

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

      {bottomPanelOpen && (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5 text-xs">
          {bottomTab === "problems" ? (
            diagnostics.length === 0 ? (
              <div className="px-2 py-3 text-slate-500">
                No problems detected in workspace.
              </div>
            ) : (
              <div className="space-y-0.5">
                {diagnostics.map((d, idx) => (
                  <button
                    key={`${d.targetId ?? "global"}-${idx}`}
                    type="button"
                    onClick={() => selectDiagnosticTarget(d.targetId)}
                    className="flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {d.severity === "error" ? (
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
                    ) : d.severity === "warning" ? (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    ) : (
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
                    )}
                    <span className="text-slate-800 dark:text-slate-200">
                      {d.message}
                    </span>
                  </button>
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
