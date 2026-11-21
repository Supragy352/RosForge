import type { DragEvent } from "react";
import { Box, Cpu, Radio, Wrench, Zap } from "lucide-react";
import { channelColorForType } from "../canvas/channelColors";
import { useProjectStore } from "../store/useProjectStore";

const PALETTE_ITEMS = [
  {
    id: "package_python",
    label: "Python Package",
    hint: "ament_python",
    icon: Box,
    accent: "text-amber-400",
  },
  {
    id: "package_cpp",
    label: "C++ Package",
    hint: "ament_cmake",
    icon: Box,
    accent: "text-indigo-400",
  },
  {
    id: "node",
    label: "ROS Node",
    hint: "Drop in package",
    icon: Cpu,
    accent: "text-emerald-400",
  },
  {
    id: "topic",
    label: "Topic",
    hint: "pub / sub",
    icon: Radio,
    accent: "text-sky-400",
  },
  {
    id: "service",
    label: "Service",
    hint: "req / res",
    icon: Wrench,
    accent: "text-pink-400",
  },
  {
    id: "action",
    label: "Action",
    hint: "goal / feedback",
    icon: Zap,
    accent: "text-teal-400",
  },
] as const;

export function Palette() {
  const project = useProjectStore((s) => s.project);
  const selected = useProjectStore((s) => s.selected);
  const setSelected = useProjectStore((s) => s.setSelected);
  const requestFocusTarget = useProjectStore((s) => s.requestFocusTarget);
  const addPackage = useProjectStore((s) => s.addPackage);
  const addNode = useProjectStore((s) => s.addNode);
  const addChannel = useProjectStore((s) => s.addChannel);

  const onDragStart = (e: DragEvent, itemId: string) => {
    e.dataTransfer.setData("application/rosforge-item", itemId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleQuickClick = (itemId: string) => {
    if (!project) return;
    if (itemId === "package_python") addPackage("python");
    else if (itemId === "package_cpp") addPackage("cpp");
    else if (itemId === "node") {
      const targetPkgId =
        selected?.kind === "package"
          ? selected.id
          : selected?.kind === "node"
            ? selected.packageId
            : project.packages[0]?.id ?? addPackage("python");
      if (targetPkgId) addNode(targetPkgId);
    } else if (itemId === "topic" || itemId === "service" || itemId === "action") {
      addChannel(itemId);
    }
  };

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Palette
      </div>

      <div className="space-y-1.5 p-2.5">
        {PALETTE_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              draggable={Boolean(project)}
              disabled={!project}
              onDragStart={(e) => onDragStart(e, item.id)}
              onClick={() => handleQuickClick(item.id)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-left text-xs transition hover:border-sky-500/60 hover:bg-sky-500/5 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-sky-500/60"
            >
              <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
                <Icon className={`h-3.5 w-3.5 ${item.accent}`} />
                {item.label}
              </span>
              <span className="font-mono text-[10px] text-slate-400">{item.hint}</span>
            </button>
          );
        })}
      </div>

      {/* Workspace Outline */}
      <div className="mt-1 flex min-h-0 flex-1 flex-col border-t border-slate-200 dark:border-slate-800">
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Outline
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-3 text-xs">
          {!project ? (
            <div className="px-1 text-[11px] text-slate-500">No workspace open</div>
          ) : (
            <>
              <div>
                <div className="mb-1 px-1 text-[10px] font-semibold uppercase text-slate-400">
                  Packages ({project.packages.length})
                </div>
                {project.packages.map((pkg) => (
                  <div key={pkg.id} className="mb-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelected({ kind: "package", id: pkg.id });
                        requestFocusTarget(pkg.id);
                      }}
                      className={`flex w-full items-center justify-between rounded px-1.5 py-1 text-left font-mono text-[11px] ${
                        selected?.id === pkg.id
                          ? "bg-sky-500/20 text-sky-400"
                          : "hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      <span className="truncate">{pkg.name}</span>
                      <span className="text-[9px] uppercase text-slate-500">
                        {pkg.lang === "python" ? "py" : "cpp"}
                      </span>
                    </button>
                    <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2 dark:border-slate-800">
                      {pkg.nodes.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => {
                            setSelected({ kind: "node", id: node.id, packageId: pkg.id });
                            requestFocusTarget(node.id);
                          }}
                          className={`block w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-[11px] ${
                            selected?.id === node.id
                              ? "bg-sky-500/20 text-sky-400"
                              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                          }`}
                        >
                          {node.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <div className="mb-1 px-1 text-[10px] font-semibold uppercase text-slate-400">
                  Channels ({project.channels.length})
                </div>
                {project.channels.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      setSelected({ kind: "channel", id: ch.id });
                      requestFocusTarget(ch.id);
                    }}
                    className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono text-[11px] ${
                      selected?.id === ch.id
                        ? "bg-sky-500/20 text-sky-400"
                        : "hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: channelColorForType(ch.type) }}
                    />
                    <span className="truncate">{ch.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
