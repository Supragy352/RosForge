import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  FileDiff,
  FilePlus2,
  Sparkles,
  X,
} from "lucide-react";
import type { FileChangeStatus, FileResolution } from "../bindings";
import { useProjectStore } from "../store/useProjectStore";

const STATUS_META: Record<
  FileChangeStatus,
  { label: string; badgeClass: string }
> = {
  created: {
    label: "New",
    badgeClass: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  },
  modified: {
    label: "Modified",
    badgeClass: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  },
  unchanged: {
    label: "Unchanged",
    badgeClass: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  },
  modified_outside_regions: {
    label: "Hand-edited!",
    badgeClass: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  },
};

export function GeneratePreviewModal() {
  const open = useProjectStore((s) => s.generateModalOpen);
  const preview = useProjectStore((s) => s.generatePreview);
  const generating = useProjectStore((s) => s.generating);
  const setOpen = useProjectStore((s) => s.setGenerateModalOpen);
  const applyGenerate = useProjectStore((s) => s.applyGenerate);

  const [selectedPath, setSelectedPath] = useState<string>("");
  const [viewMode, setViewMode] = useState<"diff" | "full">("diff");
  const [resolutions, setResolutions] = useState<Record<string, FileResolution>>({});

  useEffect(() => {
    if (!open || !preview) return;
    const firstInteresting =
      preview.files.find((f) => f.status === "modified_outside_regions") ??
      preview.files.find((f) => f.status !== "unchanged") ??
      preview.files[0];
    setSelectedPath(firstInteresting?.relPath ?? "");

    const initial: Record<string, FileResolution> = {};
    for (const f of preview.files) {
      initial[f.relPath] =
        f.status === "modified_outside_regions" ? "skip" : "overwrite";
    }
    setResolutions(initial);
  }, [open, preview]);

  const activeFile = useMemo(
    () => preview?.files.find((f) => f.relPath === selectedPath) ?? preview?.files[0],
    [preview, selectedPath]
  );

  if (!open || !preview) return null;

  const handEditedCount = preview.files.filter(
    (f) => f.status === "modified_outside_regions"
  ).length;
  const changedCount = preview.files.filter((f) => f.status !== "unchanged").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="flex h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="h-4 w-4 text-sky-400" />
              Generate Packages Preview
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {preview.files.length} files · {changedCount} changed
              {handEditedCount > 0 ? ` · ${handEditedCount} modified outside regions` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Validation Error Banner (F1.21) */}
        {preview.hasErrors && (
          <div className="flex items-center gap-2 border-b border-rose-500/40 bg-rose-500/10 px-5 py-2.5 text-xs text-rose-500">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Generation is blocked while validation errors exist. Fix errors in the Problems
            panel first.
          </div>
        )}

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* File Tree */}
          <div className="w-72 shrink-0 overflow-y-auto border-r border-slate-200 p-2 dark:border-slate-800">
            <div className="space-y-1">
              {preview.files.map((f) => {
                const meta = STATUS_META[f.status];
                const isSelected = activeFile?.relPath === f.relPath;
                return (
                  <button
                    key={f.relPath}
                    type="button"
                    onClick={() => setSelectedPath(f.relPath)}
                    className={`flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left text-xs transition ${
                      isSelected
                        ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40"
                        : "hover:bg-slate-100 dark:hover:bg-slate-800/70"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {f.status === "created" ? (
                        <FilePlus2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      ) : f.status === "modified_outside_regions" ? (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      ) : f.status === "modified" ? (
                        <FileDiff className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                      ) : (
                        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      )}
                      <span className="truncate font-mono text-[11px]">{f.relPath}</span>
                    </div>
                    <div className="flex items-center justify-between pl-5">
                      <span
                        className={`rounded border px-1.5 py-0.2 text-[10px] font-medium ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                      {f.status === "modified_outside_regions" && (
                        <span className="font-mono text-[10px] text-amber-400">
                          {resolutions[f.relPath] ?? "skip"}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Diff / Content Viewer */}
          <div className="flex min-w-0 flex-1 flex-col">
            {activeFile ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2 dark:border-slate-800">
                  <span className="truncate font-mono text-xs font-semibold">
                    {activeFile.relPath}
                  </span>

                  <div className="flex items-center gap-2">
                    {activeFile.status === "modified_outside_regions" && (
                      <div className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px]">
                        <span className="font-medium text-amber-400">Action:</span>
                        <select
                          value={resolutions[activeFile.relPath] ?? "skip"}
                          onChange={(e) =>
                            setResolutions((prev) => ({
                              ...prev,
                              [activeFile.relPath]: e.target.value as FileResolution,
                            }))
                          }
                          className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100 outline-none"
                        >
                          <option value="skip">Skip this file</option>
                          <option value="overwrite">Overwrite (keep regions)</option>
                          {activeFile.nodeId && (
                            <option value="convert_to_handwritten">
                              Convert node to handwritten
                            </option>
                          )}
                        </select>
                      </div>
                    )}

                    <div className="inline-flex rounded-md border border-slate-300 p-0.5 text-[11px] dark:border-slate-700">
                      <button
                        type="button"
                        onClick={() => setViewMode("diff")}
                        className={`rounded px-2 py-0.5 ${
                          viewMode === "diff"
                            ? "bg-sky-500 font-semibold text-slate-950"
                            : "text-slate-500"
                        }`}
                      >
                        Diff
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode("full")}
                        className={`rounded px-2 py-0.5 ${
                          viewMode === "full"
                            ? "bg-sky-500 font-semibold text-slate-950"
                            : "text-slate-500"
                        }`}
                      >
                        Full File
                      </button>
                    </div>
                  </div>
                </div>

                <pre className="min-h-0 flex-1 overflow-auto bg-slate-950 p-4 font-mono text-[11.5px] leading-relaxed text-slate-200">
                  {viewMode === "diff" && activeFile.unifiedDiff
                    ? activeFile.unifiedDiff.split("\n").map((line, idx) => {
                        const cls = line.startsWith("+") && !line.startsWith("+++")
                          ? "bg-emerald-500/15 text-emerald-300"
                          : line.startsWith("-") && !line.startsWith("---")
                            ? "bg-rose-500/15 text-rose-300"
                            : line.startsWith("@@")
                              ? "text-sky-400"
                              : "text-slate-300";
                        return (
                          <div key={idx} className={`px-1 ${cls}`}>
                            {line || " "}
                          </div>
                        );
                      })
                    : activeFile.content || "(empty file)"}
                </pre>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-slate-500">
                No files to generate. Add a package first.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Protected <code className="font-mono">rosforge:user</code> regions are preserved
            automatically.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-slate-300 px-3.5 py-1.5 text-xs font-medium dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={generating || preview.hasErrors || preview.files.length === 0}
              onClick={() => void applyGenerate(resolutions)}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {generating ? "Generating…" : "Generate Files"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
