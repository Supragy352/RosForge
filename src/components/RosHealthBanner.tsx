import { AlertTriangle, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { useAppStore } from "../store/useAppStore";

export function RosHealthBanner() {
  const rosHealth = useAppStore((s) => s.rosHealth);
  const checkingHealth = useAppStore((s) => s.checkingHealth);
  const refreshRosHealth = useAppStore((s) => s.refreshRosHealth);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  if (!rosHealth || rosHealth.available) {
    return null;
  }

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-900 dark:text-amber-200"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0">
          <div className="font-medium">
            ROS 2 environment not detected — {rosHealth.message}
          </div>
          <div className="mt-0.5 truncate text-xs text-amber-800/80 dark:text-amber-300/80">
            Configured setup script:{" "}
            <code className="rounded bg-amber-500/15 px-1 py-0.5 font-mono">
              {rosHealth.rosSetupPath}
            </code>
            {rosHealth.detail ? ` · ${rosHealth.detail}` : ""}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void refreshRosHealth()}
          disabled={checkingHealth}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium hover:bg-amber-500/25 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checkingHealth ? "animate-spin" : ""}`} />
          Retry
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-medium text-slate-950 hover:bg-amber-400"
        >
          <SettingsIcon className="h-3.5 w-3.5" />
          Configure ROS Path
        </button>
      </div>
    </div>
  );
}
