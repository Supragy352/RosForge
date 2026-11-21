import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertCircle, AlertTriangle } from "lucide-react";
import type { RosChannel } from "../bindings";
import { channelColorForType, channelKindLabel } from "./channelColors";

export interface ChannelPillData extends Record<string, unknown> {
  channel: RosChannel;
  hasError: boolean;
  hasWarning: boolean;
}

export type ChannelFlowNode = Node<ChannelPillData, "channelPill">;

export const ChannelPillNode = memo(function ChannelPillNode({
  data,
  selected,
}: NodeProps<ChannelFlowNode>) {
  const { channel, hasError, hasWarning } = data;
  const accent = channelColorForType(channel.type);

  return (
    <div
      className={`relative min-w-[200px] max-w-[260px] rounded-full border-2 bg-white px-4 py-2 shadow-sm transition-all dark:bg-slate-900 ${
        selected ? "ring-2 ring-sky-500/40" : ""
      }`}
      style={{
        borderColor: hasError ? "#f43f5e" : accent,
      }}
    >
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        title="Connect from node"
        className="!h-3 !w-3 !border-2 !border-slate-900"
        style={{ backgroundColor: accent }}
      />
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        title="Drag to node to subscribe/serve"
        className="!h-3 !w-3 !border-2 !border-slate-900"
        style={{ backgroundColor: accent }}
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-950"
            style={{ backgroundColor: accent }}
          >
            {channelKindLabel(channel.kind)}
          </span>
          <span className="truncate font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
            {channel.name}
          </span>
        </div>

        {hasError && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />}
        {!hasError && hasWarning && (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        )}
      </div>

      <div className="mt-0.5 truncate pl-1 font-mono text-[10px] text-slate-500 dark:text-slate-400">
        {channel.type || "(no type)"}
      </div>
    </div>
  );
});
