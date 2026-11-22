import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

export interface ChannelEdgeData extends Record<string, unknown> {
  label: string;
  color: string;
  dashed?: boolean;
}

export type ChannelFlowEdge = Edge<ChannelEdgeData, "channelEdge">;

export const ChannelEdge = memo(function ChannelEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}: EdgeProps<ChannelFlowEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const color = data?.color ?? "#38bdf8";
  const label = data?.label ?? "";
  const dashed = Boolean(data?.dashed);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{
          stroke: selected ? "#38bdf8" : color,
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: dashed ? "6 4" : undefined,
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              color: selected ? "#f8fafc" : color,
              borderColor: selected ? "#38bdf8" : `${color}55`,
            }}
            className={`nodrag nopan rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none shadow-sm select-none ${
              selected
                ? "bg-sky-600/95 ring-2 ring-sky-400/50"
                : "bg-slate-950/90"
            }`}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
