import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertCircle, AlertTriangle, Clock, Code2, Sliders } from "lucide-react";
import type { PackageLang, PortKind, RosNode } from "../bindings";
import { channelColorForType } from "./channelColors";

export interface ResolvedPortSummary {
  id: string;
  kind: PortKind;
  channelName: string;
  interfaceType: string;
  origin: "ui" | "code";
}

export interface RosNodeCardData extends Record<string, unknown> {
  packageId: string;
  lang: PackageLang;
  node: RosNode;
  ports: ResolvedPortSummary[];
  hasError: boolean;
  hasWarning: boolean;
}

export type RosFlowNode = Node<RosNodeCardData, "rosNode">;

const PORT_GROUPS: Array<{ kind: PortKind; label: string; side: "in" | "out" }> = [
  { kind: "pub", label: "Publishes", side: "out" },
  { kind: "sub", label: "Subscribes", side: "in" },
  { kind: "srv_server", label: "Serves", side: "in" },
  { kind: "srv_client", label: "Calls", side: "out" },
  { kind: "action_server", label: "Action Server", side: "in" },
  { kind: "action_client", label: "Action Client", side: "out" },
];

export const RosNodeCard = memo(function RosNodeCard({
  data,
  selected,
}: NodeProps<RosFlowNode>) {
  const { node, lang, ports, hasError, hasWarning } = data;
  const isPy = lang === "python";

  return (
    <div
      className={`relative w-[248px] rounded-xl border bg-white shadow-md transition-all dark:bg-slate-900 ${
        selected
          ? "border-sky-500 ring-2 ring-sky-500/30"
          : hasError
            ? "border-rose-500"
            : "border-slate-300 dark:border-slate-700"
      }`}
    >
      {/* Left target handle (Subscribe / Server / Incoming) */}
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        title="Connect from Topic/Service/Action"
        className="!h-3 !w-3 !border-2 !border-slate-900 !bg-sky-400 hover:!scale-125"
      />

      {/* Right source handle (Publish / Client / Outgoing) */}
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        title="Drag to Topic/Service/Action (or empty canvas to create topic)"
        className="!h-3 !w-3 !border-2 !border-slate-900 !bg-emerald-400 hover:!scale-125"
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 rounded-t-[10px] border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/70">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
              isPy
                ? "bg-amber-500/20 text-amber-600 dark:text-amber-300"
                : "bg-indigo-500/20 text-indigo-600 dark:text-indigo-300"
            }`}
          >
            {isPy ? "PY" : "C++"}
          </span>
          <span className="truncate font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
            {node.name}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {node.ownership === "handwritten" && (
            <span
              title="Handwritten node (source owned by user)"
              className="inline-flex items-center rounded bg-violet-500/15 px-1 py-0.5 text-[10px] text-violet-400"
            >
              <Code2 className="h-3 w-3" />
            </span>
          )}
          {hasError && (
            <span title="Validation error">
              <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
            </span>
          )}
          {!hasError && hasWarning && (
            <span title="Validation warning">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            </span>
          )}
        </div>
      </div>

      {/* Grouped Port Rows */}
      <div className="space-y-1.5 px-3 py-2 text-[11px]">
        {ports.length === 0 ? (
          <div className="py-1 text-center text-[11px] italic text-slate-400 dark:text-slate-500">
            Drag handles to wire channels
          </div>
        ) : (
          PORT_GROUPS.map((group) => {
            const groupPorts = ports.filter((p) => p.kind === group.kind);
            if (groupPorts.length === 0) return null;
            return (
              <div key={group.kind} className="space-y-0.5">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {group.label}
                </div>
                {groupPorts.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-1.5 rounded bg-slate-100/80 px-1.5 py-0.5 dark:bg-slate-800/70"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: channelColorForType(p.interfaceType) }}
                      />
                      <span className="truncate font-mono text-[11px] text-slate-800 dark:text-slate-200">
                        {p.channelName}
                      </span>
                    </div>
                    {p.origin === "code" && (
                      <span className="font-mono text-[9px] text-violet-400">&lt;/&gt;</span>
                    )}
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* Footer: Params & Timers counts */}
      <div className="flex items-center justify-between border-t border-slate-200/80 px-3 py-1.5 text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="inline-flex items-center gap-1">
          <Sliders className="h-3 w-3" />
          {node.params.length} {node.params.length === 1 ? "param" : "params"}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {node.timers.length} {node.timers.length === 1 ? "timer" : "timers"}
        </span>
      </div>
    </div>
  );
});
