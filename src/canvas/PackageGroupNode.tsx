import { memo } from "react";
import { type Node, type NodeProps, NodeResizer } from "@xyflow/react";
import { Box, Plus } from "lucide-react";
import type { PackageLang } from "../bindings";

export interface PackageGroupData extends Record<string, unknown> {
  packageId: string;
  name: string;
  lang: PackageLang;
  nodeCount: number;
  hasError: boolean;
  expandLeft?: number;
  expandTop?: number;
  onQuickAddNode: (pkgId: string) => void;
}

export type PackageFlowNode = Node<PackageGroupData, "packageGroup">;

export const PackageGroupNode = memo(function PackageGroupNode({
  data,
  selected,
}: NodeProps<PackageFlowNode>) {
  const isPy = data.lang === "python";
  const expandLeft = data.expandLeft ?? 0;
  const expandTop = data.expandTop ?? 0;

  return (
    <div
      style={{
        marginLeft: expandLeft ? -expandLeft : undefined,
        marginTop: expandTop ? -expandTop : undefined,
        width: expandLeft ? `calc(100% + ${expandLeft}px)` : "100%",
        height: expandTop ? `calc(100% + ${expandTop}px)` : "100%",
      }}
      className={`rounded-xl border-2 border-dashed transition-colors ${
        selected
          ? "border-sky-400 bg-sky-500/[0.08] ring-2 ring-sky-400/40 dark:border-sky-400 dark:bg-sky-400/[0.08]"
          : data.hasError
            ? "border-rose-500/70 bg-rose-500/[0.04]"
            : "border-slate-300/90 bg-slate-100/50 dark:border-slate-700/90 dark:bg-slate-900/45"
      }`}
    >
      <NodeResizer
        minWidth={290}
        minHeight={180}
        isVisible={selected}
        lineClassName="!border-sky-400"
        handleClassName="!h-2.5 !w-2.5 !rounded-sm !bg-sky-400 !border-slate-950"
      />
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-3 py-2 dark:border-slate-800/80">
        <div className="flex min-w-0 items-center gap-2">
          <Box className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
          <span className="truncate font-mono text-xs font-bold text-slate-800 dark:text-slate-100">
            {data.name}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
              isPy
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
                : "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
            }`}
          >
            {isPy ? "ament_python" : "ament_cmake"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500">
            {data.nodeCount} {data.nodeCount === 1 ? "node" : "nodes"}
          </span>
          <button
            type="button"
            title="Add ROS node to package"
            onClick={(e) => {
              e.stopPropagation();
              data.onQuickAddNode(data.packageId);
            }}
            className="inline-flex items-center gap-0.5 rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-sky-500 hover:text-slate-950 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-sky-500 dark:hover:text-slate-950"
          >
            <Plus className="h-3 w-3" />
            Node
          </button>
        </div>
      </div>
    </div>
  );
});
