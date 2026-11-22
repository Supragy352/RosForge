import { useEffect, useState, type FormEvent } from "react";
import { X, Save, RotateCcw } from "lucide-react";
import {
  DEFAULT_SETTINGS,
  useAppStore,
  type ResolvedSettings,
} from "../store/useAppStore";

export function SettingsModal() {
  const open = useAppStore((s) => s.settingsOpen);
  const settings = useAppStore((s) => s.settings);
  const saving = useAppStore((s) => s.savingSettings);
  const errorMessage = useAppStore((s) => s.errorMessage);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const clearError = useAppStore((s) => s.clearError);

  const [draft, setDraft] = useState<ResolvedSettings>(settings);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      clearError();
    }
  }, [open, settings, clearError]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await saveSettings(draft);
    if (ok) {
      setSettingsOpen(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div>
            <h2
              id="settings-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Settings
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Stored in <code className="font-mono">~/.config/rosforge/settings.json</code>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-5 py-4">
          {errorMessage && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
              {errorMessage}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              ROS 2 Setup Script Path
            </label>
            <input
              type="text"
              value={draft.rosSetupPath}
              onChange={(e) => setDraft({ ...draft, rosSetupPath: e.target.value })}
              placeholder="/opt/ros/jazzy/setup.bash"
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                Default Workspace Path
              </label>
              <input
                type="text"
                value={draft.defaultWorkspace ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultWorkspace: e.target.value.trim() ? e.target.value : null,
                  })
                }
                placeholder="~/ros2_ws"
                className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                ROS_DOMAIN_ID
              </label>
              <input
                type="number"
                min={0}
                max={232}
                value={draft.rosDomainId}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    rosDomainId: Number.parseInt(e.target.value || "0", 10),
                  })
                }
                className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                Default Maintainer Name
              </label>
              <input
                type="text"
                value={draft.defaultMaintainerName}
                onChange={(e) =>
                  setDraft({ ...draft, defaultMaintainerName: e.target.value })
                }
                placeholder="Jane Doe"
                className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                Default Maintainer Email
              </label>
              <input
                type="email"
                value={draft.defaultMaintainerEmail}
                onChange={(e) =>
                  setDraft({ ...draft, defaultMaintainerEmail: e.target.value })
                }
                placeholder="jane@example.com"
                className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              External Editor Command
            </label>
            <input
              type="text"
              value={draft.externalEditorCommand}
              onChange={(e) =>
                setDraft({ ...draft, externalEditorCommand: e.target.value })
              }
              placeholder="code -g {file}:{line}"
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-sm text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Placeholders: <code className="font-mono">{"{file}"}</code> and{" "}
              <code className="font-mono">{"{line}"}</code>
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-800">
            <div>
              <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                Build before running
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Automatically run colcon build before launching nodes
              </div>
            </div>
            <input
              type="checkbox"
              checked={draft.buildBeforeRun}
              onChange={(e) =>
                setDraft({ ...draft, buildBeforeRun: e.target.checked })
              }
              className="h-4 w-4 rounded border-slate-300 accent-sky-500"
            />
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...DEFAULT_SETTINGS,
                  theme: draft.theme,
                  recentWorkspaces: draft.recentWorkspaces,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Defaults
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "Saving…" : "Save Settings"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
