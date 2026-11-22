import { useEffect, useState, type FormEvent } from "react";
import { Clock, FolderOpen, Sparkles, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { useProjectStore } from "../store/useProjectStore";

export function WorkspaceModal() {
  const open = useProjectStore((s) => s.workspaceModalOpen);
  const setOpen = useProjectStore((s) => s.setWorkspaceModalOpen);
  const openWorkspace = useProjectStore((s) => s.openWorkspace);
  const createExampleWorkspace = useProjectStore((s) => s.createExampleWorkspace);
  const settings = useAppStore((s) => s.settings);

  const [wsPath, setWsPath] = useState("");
  const [projName, setProjName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setWsPath(
        settings.defaultWorkspace ||
          settings.recentWorkspaces[0] ||
          "~/rosforge_ws"
      );
      setProjName("");
    }
  }, [open, settings.defaultWorkspace, settings.recentWorkspaces]);

  if (!open) return null;

  const handleOpen = async (e: FormEvent) => {
    e.preventDefault();
    if (!wsPath.trim()) return;
    setBusy(true);
    await openWorkspace(wsPath, projName || undefined);
    setBusy(false);
  };

  const handleExample = async () => {
    if (!wsPath.trim()) return;
    setBusy(true);
    await createExampleWorkspace(wsPath);
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold">New / Open Workspace</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Creates <code className="font-mono">src/</code> and{" "}
              <code className="font-mono">.rosforge.json</code> if missing
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

        <form onSubmit={(e) => void handleOpen(e)} className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Workspace Folder Path (Linux path, <code className="font-mono">~</code> supported)
            </label>
            <input
              autoFocus
              type="text"
              required
              value={wsPath}
              onChange={(e) => setWsPath(e.target.value)}
              placeholder="~/ros2_ws"
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Project Name (optional, for new workspaces)
            </label>
            <input
              type="text"
              value={projName}
              onChange={(e) => setProjName(e.target.value)}
              placeholder="Derived from folder name"
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          {settings.recentWorkspaces.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <Clock className="h-3 w-3" />
                Recent Workspaces
              </div>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5 dark:border-slate-800">
                {settings.recentWorkspaces.map((recent) => (
                  <button
                    key={recent}
                    type="button"
                    onClick={() => void openWorkspace(recent)}
                    className="block w-full truncate rounded px-2 py-1 text-left font-mono text-xs text-slate-700 hover:bg-sky-500/15 dark:text-slate-300"
                  >
                    {recent}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleExample()}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Create Talker/Listener Example Here
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {busy ? "Opening…" : "Open Workspace"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
