import { useState } from "react";
import {
  Activity,
  CheckCircle2,
  Cpu,
  RefreshCw,
  Settings as SettingsIcon,
  Terminal,
  XCircle,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";

export function CanvasPlaceholder() {
  const settings = useAppStore((s) => s.settings);
  const rosHealth = useAppStore((s) => s.rosHealth);
  const pingResult = useAppStore((s) => s.pingResult);
  const pinging = useAppStore((s) => s.pinging);
  const checkingHealth = useAppStore((s) => s.checkingHealth);
  const runPing = useAppStore((s) => s.runPing);
  const refreshRosHealth = useAppStore((s) => s.refreshRosHealth);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);

  const [pingInput, setPingInput] = useState("hello rosforge");

  return (
    <div className="relative flex flex-1 flex-col overflow-auto bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:20px_20px] p-6 dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)]">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-6">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-600 dark:text-sky-300">
            Milestone M0 — Scaffolding Ready
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            RosForge Workspace Shell
          </h1>
          <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            Tauri 2 + React + TypeScript + Specta bindings + Settings store + ROS 2
            environment wrapper are wired up. The interactive React Flow graph canvas
            and package generator arrive in M1.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* F0.2 Ping / Specta Card */}
          <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <Cpu className="h-3.5 w-3.5 text-sky-500" />
                  Backend IPC (F0.2)
                </span>
                {pingResult?.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-slate-400" />
                )}
              </div>

              <div className="rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-800 dark:bg-slate-950 dark:text-slate-200">
                {pingResult ? (
                  <div className="space-y-0.5">
                    <div>reply: {pingResult.reply}</div>
                    <div className="text-slate-500">
                      v{pingResult.appVersion} · {pingResult.platform}
                    </div>
                  </div>
                ) : (
                  <span className="text-slate-500">No response yet</span>
                )}
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <input
                type="text"
                value={pingInput}
                onChange={(e) => setPingInput(e.target.value)}
                placeholder="Ping message"
                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => void runPing(pingInput)}
                disabled={pinging}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
              >
                <Activity className={`h-3.5 w-3.5 ${pinging ? "animate-pulse" : ""}`} />
                Ping
              </button>
            </div>
          </section>

          {/* F0.4 ROS Env Card */}
          <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <Terminal className="h-3.5 w-3.5 text-emerald-500" />
                  ROS 2 Env (F0.4)
                </span>
                {rosHealth?.available ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-amber-500" />
                )}
              </div>

              <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                <div className="font-medium">
                  {rosHealth ? rosHealth.message : "Checking ROS 2…"}
                </div>
                <div className="truncate font-mono text-[11px] text-slate-500">
                  {settings.rosSetupPath}
                </div>
                <div className="font-mono text-[11px] text-slate-500">
                  ROS_DOMAIN_ID={settings.rosDomainId}
                  {rosHealth?.rosDistro ? ` · distro=${rosHealth.rosDistro}` : ""}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={() => void refreshRosHealth()}
                disabled={checkingHealth}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${checkingHealth ? "animate-spin" : ""}`}
                />
                Re-check `ros2 --help`
              </button>
            </div>
          </section>

          {/* F0.3 Settings Card */}
          <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <SettingsIcon className="h-3.5 w-3.5 text-indigo-400" />
                  Settings Store (F0.3)
                </span>
              </div>

              <dl className="space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Editor:</dt>
                  <dd className="truncate font-mono text-slate-800 dark:text-slate-200">
                    {settings.externalEditorCommand}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Workspace:</dt>
                  <dd className="truncate font-mono text-slate-800 dark:text-slate-200">
                    {settings.defaultWorkspace ?? "(not set)"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Maintainer:</dt>
                  <dd className="truncate text-slate-800 dark:text-slate-200">
                    {settings.defaultMaintainerName || "(not set)"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <SettingsIcon className="h-3.5 w-3.5" />
                Edit Settings
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
