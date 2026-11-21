import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Box,
  Cpu,
  FolderOpen,
  Radio,
  Search,
  Sparkles,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { ChannelKind, PortKind, Project } from "../bindings";
import { useAppStore } from "../store/useAppStore";
import { useProjectStore } from "../store/useProjectStore";
import { channelColorForType } from "./channelColors";
import { ChannelPillNode, type ChannelFlowNode } from "./ChannelPillNode";
import {
  PACKAGE_MIN_HEIGHT,
  PACKAGE_MIN_WIDTH,
  ROS_NODE_WIDTH,
  estimateNodeHeight,
} from "./layout";
import { PackageGroupNode, type PackageFlowNode } from "./PackageGroupNode";
import {
  RosNodeCard,
  type ResolvedPortSummary,
  type RosFlowNode,
} from "./RosNodeCard";

type AnyFlowNode = PackageFlowNode | RosFlowNode | ChannelFlowNode;

const nodeTypes = {
  packageGroup: PackageGroupNode,
  rosNode: RosNodeCard,
  channelPill: ChannelPillNode,
};

interface QuickAddState {
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
  query: string;
}

interface PendingRolePrompt {
  nodeId: string;
  channelId: string;
  channelName: string;
  kind: "service" | "action";
}

function buildFlowElements(
  project: Project,
  diagnostics: Array<{ severity: string; targetId?: string | null }>,
  onQuickAddNode: (pkgId: string) => void
): { nodes: AnyFlowNode[]; edges: Edge[] } {
  const errorTargets = new Set(
    diagnostics
      .filter((d) => d.severity === "error" && d.targetId)
      .map((d) => d.targetId as string)
  );
  const warningTargets = new Set(
    diagnostics
      .filter((d) => d.severity === "warning" && d.targetId)
      .map((d) => d.targetId as string)
  );

  const channelsById = new Map(project.channels.map((c) => [c.id, c]));
  const nodes: AnyFlowNode[] = [];
  const edges: Edge[] = [];

  for (const pkg of project.packages) {
    // Compute package bounds dynamically from its children
    let maxRight = PACKAGE_MIN_WIDTH;
    let maxBottom = PACKAGE_MIN_HEIGHT;
    pkg.nodes.forEach((n, idx) => {
      const pos = project.canvas.positions[n.id] ?? {
        x: 24,
        y: 56 + idx * 150,
      };
      const rx = (pos.x ?? 24) + ROS_NODE_WIDTH + 24;
      const rb = (pos.y ?? 56) + estimateNodeHeight(n.ports.length) + 28;
      if (rx > maxRight) maxRight = rx;
      if (rb > maxBottom) maxBottom = rb;
    });

    const pkgPos = project.canvas.positions[pkg.id] ?? { x: 40, y: 60 };
    nodes.push({
      id: pkg.id,
      type: "packageGroup",
      position: { x: pkgPos.x ?? 40, y: pkgPos.y ?? 60 },
      style: { width: maxRight, height: maxBottom },
      data: {
        packageId: pkg.id,
        name: pkg.name,
        lang: pkg.lang,
        nodeCount: pkg.nodes.length,
        hasError: errorTargets.has(pkg.id),
        onQuickAddNode,
      },
    });

    pkg.nodes.forEach((rosNode, idx) => {
      const nodePos = project.canvas.positions[rosNode.id] ?? {
        x: 24,
        y: 56 + idx * 150,
      };

      const portSummaries: ResolvedPortSummary[] = rosNode.ports.map((pt) => {
        const ch = channelsById.get(pt.channelId);
        return {
          id: pt.id,
          kind: pt.kind,
          channelName: ch?.name ?? "(missing)",
          interfaceType: ch?.type ?? "",
          origin: pt.origin,
        };
      });

      const nodeHasError =
        errorTargets.has(rosNode.id) ||
        rosNode.ports.some((pt) => errorTargets.has(pt.id)) ||
        rosNode.params.some((pr) => errorTargets.has(pr.id)) ||
        rosNode.timers.some((tm) => errorTargets.has(tm.id));

      const nodeHasWarning =
        warningTargets.has(rosNode.id) ||
        rosNode.ports.some((pt) => warningTargets.has(pt.id)) ||
        rosNode.timers.some((tm) => warningTargets.has(tm.id));

      nodes.push({
        id: rosNode.id,
        type: "rosNode",
        parentId: pkg.id,
        position: { x: nodePos.x ?? 24, y: nodePos.y ?? 56 + idx * 150 },
        data: {
          packageId: pkg.id,
          lang: pkg.lang,
          node: rosNode,
          ports: portSummaries,
          hasError: nodeHasError,
          hasWarning: nodeHasWarning,
        },
      });

      for (const pt of rosNode.ports) {
        const ch = channelsById.get(pt.channelId);
        if (!ch) continue;
        const color = channelColorForType(ch.type);
        const isOutgoing =
          pt.kind === "pub" ||
          pt.kind === "srv_client" ||
          pt.kind === "action_client";
        const labelMap: Record<PortKind, string> = {
          pub: "pub",
          sub: "sub",
          srv_server: "serves",
          srv_client: "calls",
          action_server: "act srv",
          action_client: "act cli",
        };
        edges.push({
          id: `port:${pkg.id}:${rosNode.id}:${pt.id}`,
          source: isOutgoing ? rosNode.id : ch.id,
          sourceHandle: "out",
          target: isOutgoing ? ch.id : rosNode.id,
          targetHandle: "in",
          label: labelMap[pt.kind],
          animated: pt.kind === "action_client" || pt.kind === "action_server",
          style: { stroke: color, strokeWidth: 2 },
          labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: "#0f172a", fillOpacity: 0.85 },
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 4,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
            width: 16,
            height: 16,
          },
        });
      }
    });
  }

  project.channels.forEach((ch, idx) => {
    const pos = project.canvas.positions[ch.id] ?? {
      x: 420,
      y: 90 + idx * 100,
    };
    nodes.push({
      id: ch.id,
      type: "channelPill",
      position: { x: pos.x ?? 420, y: pos.y ?? 90 + idx * 100 },
      data: {
        channel: ch,
        hasError: errorTargets.has(ch.id),
        hasWarning: warningTargets.has(ch.id),
      },
    });
  });

  return { nodes, edges };
}

function GraphCanvasInner({
  searchOpen,
  onCloseSearch,
}: {
  searchOpen: boolean;
  onCloseSearch: () => void;
}) {
  const project = useProjectStore((s) => s.project);
  const diagnostics = useProjectStore((s) => s.diagnostics);
  const focusTargetId = useProjectStore((s) => s.focusTargetId);
  const requestFocusTarget = useProjectStore((s) => s.requestFocusTarget);
  const setSelected = useProjectStore((s) => s.setSelected);
  const setPositions = useProjectStore((s) => s.setPositions);
  const addPackage = useProjectStore((s) => s.addPackage);
  const addNode = useProjectStore((s) => s.addNode);
  const addChannel = useProjectStore((s) => s.addChannel);
  const moveNodeToPackage = useProjectStore((s) => s.moveNodeToPackage);
  const connectNodeAndChannel = useProjectStore((s) => s.connectNodeAndChannel);
  const deletePort = useProjectStore((s) => s.deletePort);
  const deleteIds = useProjectStore((s) => s.deleteIds);
  const duplicateIds = useProjectStore((s) => s.duplicateIds);
  const setWorkspaceModalOpen = useProjectStore((s) => s.setWorkspaceModalOpen);
  const createExampleWorkspace = useProjectStore((s) => s.createExampleWorkspace);
  const theme = useAppStore((s) => s.settings.theme);

  const rf = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selectedIdsRef = useRef<string[]>([]);

  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const [rolePrompt, setRolePrompt] = useState<PendingRolePrompt | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [livePositions, setLivePositions] = useState<
    Record<string, { x: number; y: number }>
  >({});

  const handleQuickAddNode = useCallback(
    (pkgId: string) => {
      addNode(pkgId);
    },
    [addNode]
  );

  const { nodes: baseNodes, edges } = useMemo(() => {
    if (!project) return { nodes: [], edges: [] };
    return buildFlowElements(project, diagnostics, handleQuickAddNode);
  }, [project, diagnostics, handleQuickAddNode]);

  // Overlay transient dragging positions smoothly without polluting undo history
  const nodes = useMemo(() => {
    if (Object.keys(livePositions).length === 0) return baseNodes;
    return baseNodes.map((n) =>
      livePositions[n.id] ? { ...n, position: livePositions[n.id] } : n
    );
  }, [baseNodes, livePositions]);

  // Focus & zoom to target when requested (Problems panel click or Ctrl+F search)
  useEffect(() => {
    if (!focusTargetId || !project) return;
    const targetNode = rf.getNode(focusTargetId);
    if (targetNode) {
      void rf.fitView({ nodes: [targetNode], padding: 0.4, duration: 250 });
    }
    requestFocusTarget(null);
  }, [focusTargetId, project, rf, requestFocusTarget]);

  // Keyboard shortcuts inside canvas (Ctrl+D duplicate, Delete/Backspace)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!project) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        if (selectedIdsRef.current.length > 0) {
          e.preventDefault();
          duplicateIds(selectedIdsRef.current);
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIdsRef.current.length > 0) {
          e.preventDefault();
          deleteIds(selectedIdsRef.current);
        }
      } else if (e.key === "Escape") {
        setQuickAdd(null);
        setRolePrompt(null);
        if (searchOpen) onCloseSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [project, duplicateIds, deleteIds, searchOpen, onCloseSearch]);

  const onNodesChange = useCallback((changes: NodeChange<AnyFlowNode>[]) => {
    const dragUpdates: Record<string, { x: number; y: number }> = {};
    let hasDrag = false;
    for (const ch of changes) {
      if (ch.type === "position" && ch.position && ch.dragging) {
        dragUpdates[ch.id] = ch.position;
        hasDrag = true;
      }
    }
    if (hasDrag) {
      setLivePositions((prev) => ({ ...prev, ...dragUpdates }));
    }
  }, []);

  const onNodeDragStop = useCallback(
    (_event: ReactMouseEvent | MouseEvent | TouchEvent, draggedNode: Node) => {
      setLivePositions((prev) => {
        if (!(draggedNode.id in prev)) return prev;
        const next = { ...prev };
        delete next[draggedNode.id];
        return next;
      });

      if (!project) return;

      // Check if a ROS node was dropped onto another package frame (F1.5)
      if (draggedNode.type === "rosNode" && draggedNode.parentId) {
        const currentPkg = project.packages.find((p) => p.id === draggedNode.parentId);
        const currentPkgPos = project.canvas.positions[draggedNode.parentId] ?? {
          x: 40,
          y: 60,
        };
        const absX = (currentPkgPos.x ?? 0) + draggedNode.position.x;
        const absY = (currentPkgPos.y ?? 0) + draggedNode.position.y;

        for (const otherPkg of project.packages) {
          if (otherPkg.id === draggedNode.parentId) continue;
          const otherFlowNode = rf.getNode(otherPkg.id);
          const ox = otherFlowNode?.position.x ?? project.canvas.positions[otherPkg.id]?.x ?? 0;
          const oy = otherFlowNode?.position.y ?? project.canvas.positions[otherPkg.id]?.y ?? 0;
          const ow = Number(otherFlowNode?.measured?.width ?? otherFlowNode?.style?.width ?? PACKAGE_MIN_WIDTH);
          const oh = Number(otherFlowNode?.measured?.height ?? otherFlowNode?.style?.height ?? PACKAGE_MIN_HEIGHT);

          if (absX >= ox && absX <= ox + ow && absY >= oy && absY <= oy + oh) {
            const confirmed = window.confirm(
              `Move node '${(draggedNode.data as { node?: { name: string } }).node?.name ?? ""}' from '${currentPkg?.name ?? ""}' to package '${otherPkg.name}'?`
            );
            if (confirmed) {
              moveNodeToPackage(draggedNode.id, draggedNode.parentId, otherPkg.id, {
                x: Math.max(16, Math.round(absX - ox)),
                y: Math.max(48, Math.round(absY - oy)),
              });
              return;
            }
          }
        }
      }

      setPositions({
        [draggedNode.id]: {
          x: Math.round(draggedNode.position.x),
          y: Math.round(draggedNode.position.y),
        },
      });
    },
    [project, rf, moveNodeToPackage, setPositions]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!project || !connection.source || !connection.target) return;
      const srcId = connection.source;
      const tgtId = connection.target;

      const srcCh = project.channels.find((c) => c.id === srcId);
      const tgtCh = project.channels.find((c) => c.id === tgtId);
      const isNode = (id: string) =>
        project.packages.some((p) => p.nodes.some((n) => n.id === id));

      // Node -> Channel
      if (isNode(srcId) && tgtCh) {
        if (tgtCh.kind === "topic") {
          connectNodeAndChannel(srcId, tgtCh.id, "pub");
        } else {
          setRolePrompt({
            nodeId: srcId,
            channelId: tgtCh.id,
            channelName: tgtCh.name,
            kind: tgtCh.kind,
          });
        }
        return;
      }

      // Channel -> Node
      if (srcCh && isNode(tgtId)) {
        if (srcCh.kind === "topic") {
          connectNodeAndChannel(tgtId, srcCh.id, "sub");
        } else {
          setRolePrompt({
            nodeId: tgtId,
            channelId: srcCh.id,
            channelName: srcCh.name,
            kind: srcCh.kind,
          });
        }
      }
    },
    [project, connectNodeAndChannel]
  );

  // F1.8: Dropping a connection from a node handle onto empty canvas creates a new topic there
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (!project || state.isValid || !state.fromNode) return;
      if (state.fromNode.type !== "rosNode") return;

      const clientX =
        "changedTouches" in event ? event.changedTouches[0].clientX : event.clientX;
      const clientY =
        "changedTouches" in event ? event.changedTouches[0].clientY : event.clientY;
      const flowPos = rf.screenToFlowPosition({ x: clientX, y: clientY });
      const chId = addChannel("topic", {
        x: Math.round(flowPos.x),
        y: Math.round(flowPos.y),
      });
      if (chId) {
        const portKind: PortKind = state.fromHandle?.type === "source" ? "pub" : "sub";
        connectNodeAndChannel(state.fromNode.id, chId, portKind);
      }
    },
    [project, rf, addChannel, connectNodeAndChannel]
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) {
        const parts = edge.id.split(":");
        if (parts[0] === "port" && parts.length === 4) {
          deletePort(parts[1], parts[2], parts[3]);
        }
      }
    },
    [deletePort]
  );

  const onSelectionChange = useCallback(
    ({ nodes: selNodes }: OnSelectionChangeParams) => {
      selectedIdsRef.current = selNodes.map((n) => n.id);
      if (selNodes.length !== 1 || !project) return;
      const first = selNodes[0];
      if (first.type === "packageGroup") {
        setSelected({ kind: "package", id: first.id });
      } else if (first.type === "rosNode" && first.parentId) {
        setSelected({ kind: "node", id: first.id, packageId: first.parentId });
      } else if (first.type === "channelPill") {
        setSelected({ kind: "channel", id: first.id });
      }
    },
    [project, setSelected]
  );

  // Drag-and-drop from Palette (F1.6)
  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (!project) return;
      const paletteKind = e.dataTransfer.getData("application/rosforge-item");
      if (!paletteKind) return;

      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const rounded = { x: Math.round(pos.x), y: Math.round(pos.y) };

      if (paletteKind === "package_python") {
        addPackage("python", rounded);
      } else if (paletteKind === "package_cpp") {
        addPackage("cpp", rounded);
      } else if (paletteKind === "node") {
        // Find package under cursor, or create one if none exists
        let targetPkgId: string | null = null;
        let relPos = { x: 24, y: 56 };
        for (const pkg of project.packages) {
          const fn = rf.getNode(pkg.id);
          const px = fn?.position.x ?? project.canvas.positions[pkg.id]?.x ?? 0;
          const py = fn?.position.y ?? project.canvas.positions[pkg.id]?.y ?? 0;
          const pw = Number(fn?.measured?.width ?? fn?.style?.width ?? PACKAGE_MIN_WIDTH);
          const ph = Number(fn?.measured?.height ?? fn?.style?.height ?? PACKAGE_MIN_HEIGHT);
          if (rounded.x >= px && rounded.x <= px + pw && rounded.y >= py && rounded.y <= py + ph) {
            targetPkgId = pkg.id;
            relPos = {
              x: Math.max(16, Math.round(rounded.x - px)),
              y: Math.max(48, Math.round(rounded.y - py)),
            };
            break;
          }
        }
        if (!targetPkgId) {
          targetPkgId =
            project.packages[0]?.id ?? addPackage("python", { x: rounded.x - 24, y: rounded.y - 56 });
        }
        if (targetPkgId) {
          addNode(targetPkgId, relPos);
        }
      } else if (
        paletteKind === "topic" ||
        paletteKind === "service" ||
        paletteKind === "action"
      ) {
        addChannel(paletteKind as ChannelKind, rounded);
      }
    },
    [project, rf, addPackage, addNode, addChannel]
  );

  // Double-click canvas quick-add popup (F1.6)
  const onPaneDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!project) return;
      const target = e.target as HTMLElement;
      if (!target.classList.contains("react-flow__pane")) return;
      const rect = wrapperRef.current?.getBoundingClientRect();
      const flowPos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setQuickAdd({
        screenX: e.clientX - (rect?.left ?? 0),
        screenY: e.clientY - (rect?.top ?? 0),
        flowX: Math.round(flowPos.x),
        flowY: Math.round(flowPos.y),
        query: "",
      });
    },
    [project, rf]
  );

  const searchMatches = useMemo(() => {
    if (!project || !searchOpen) return [];
    const q = searchQuery.trim().toLowerCase();
    const results: Array<{
      id: string;
      label: string;
      subtitle: string;
      sel: () => void;
    }> = [];
    for (const pkg of project.packages) {
      if (!q || pkg.name.toLowerCase().includes(q)) {
        results.push({
          id: pkg.id,
          label: pkg.name,
          subtitle: `Package (${pkg.lang})`,
          sel: () => setSelected({ kind: "package", id: pkg.id }),
        });
      }
      for (const n of pkg.nodes) {
        if (!q || n.name.toLowerCase().includes(q)) {
          results.push({
            id: n.id,
            label: n.name,
            subtitle: `Node in ${pkg.name}`,
            sel: () => setSelected({ kind: "node", id: n.id, packageId: pkg.id }),
          });
        }
      }
    }
    for (const ch of project.channels) {
      if (
        !q ||
        ch.name.toLowerCase().includes(q) ||
        ch.type.toLowerCase().includes(q)
      ) {
        results.push({
          id: ch.id,
          label: ch.name,
          subtitle: `${ch.kind} · ${ch.type}`,
          sel: () => setSelected({ kind: "channel", id: ch.id }),
        });
      }
    }
    return results.slice(0, 12);
  }, [project, searchOpen, searchQuery, setSelected]);

  // Empty state onboarding (SPEC §5)
  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:20px_20px] p-6 dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)]">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white/95 p-7 shadow-xl dark:border-slate-800 dark:bg-slate-900/95">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-600 dark:text-sky-300">
            ROS 2 Jazzy Node-Graph IDE
          </div>
          <h1 className="mt-3 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Open a ROS 2 Workspace to Start Designing
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Draw packages, nodes, topics, services, and actions on the canvas, then
            generate ready-to-build <code className="font-mono">ament_python</code> and{" "}
            <code className="font-mono">ament_cmake</code> packages with protected user
            code regions.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setWorkspaceModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              <FolderOpen className="h-4 w-4" />
              New / Open Workspace…
            </button>
            <button
              type="button"
              onClick={() => {
                const defaultPath =
                  useAppStore.getState().settings.defaultWorkspace ||
                  "/tmp/rosforge_demo_ws";
                void createExampleWorkspace(defaultPath);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
            >
              <Sparkles className="h-4 w-4" />
              Create Talker/Listener Example
            </button>
          </div>
        </div>
      </div>
    );
  }

  const quickAddItems = [
    {
      id: "package_python",
      label: "Python Package",
      icon: Box,
      run: () => addPackage("python", { x: quickAdd!.flowX, y: quickAdd!.flowY }),
    },
    {
      id: "package_cpp",
      label: "C++ Package",
      icon: Box,
      run: () => addPackage("cpp", { x: quickAdd!.flowX, y: quickAdd!.flowY }),
    },
    {
      id: "node",
      label: "ROS Node",
      icon: Cpu,
      run: () => {
        const pkgId =
          project.packages[0]?.id ??
          addPackage("python", { x: quickAdd!.flowX - 24, y: quickAdd!.flowY - 56 });
        if (pkgId) addNode(pkgId);
      },
    },
    {
      id: "topic",
      label: "Topic Channel",
      icon: Radio,
      run: () => addChannel("topic", { x: quickAdd!.flowX, y: quickAdd!.flowY }),
    },
    {
      id: "service",
      label: "Service Channel",
      icon: Wrench,
      run: () => addChannel("service", { x: quickAdd!.flowX, y: quickAdd!.flowY }),
    },
    {
      id: "action",
      label: "Action Channel",
      icon: Zap,
      run: () => addChannel("action", { x: quickAdd!.flowX, y: quickAdd!.flowY }),
    },
  ].filter(
    (item) =>
      !quickAdd?.query.trim() ||
      item.label.toLowerCase().includes(quickAdd.query.trim().toLowerCase())
  );

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full flex-1"
      onDoubleClick={onPaneDoubleClick}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={theme === "dark" ? "dark" : "light"}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onEdgesDelete={onEdgesDelete}
        onSelectionChange={onSelectionChange}
        onPaneClick={() => {
          setSelected(null);
          setQuickAdd(null);
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        selectionOnDrag
        panOnScroll
        deleteKeyCode={null}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={theme === "dark" ? "#334155" : "#cbd5e1"}
        />
        <MiniMap
          pannable
          zoomable
          className="!rounded-lg !border !border-slate-300 dark:!border-slate-700"
        />
        <Controls />
      </ReactFlow>

      {/* Ctrl+F Canvas Search Overlay (F1.11) */}
      {searchOpen && (
        <div className="absolute left-1/2 top-3 z-30 w-80 -translate-x-1/2 rounded-xl border border-slate-300 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-200 pb-1.5 dark:border-slate-800">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Jump to package, node, or channel…"
              className="flex-1 bg-transparent text-xs outline-none"
            />
            <button
              type="button"
              onClick={onCloseSearch}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1 max-h-56 overflow-y-auto">
            {searchMatches.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-slate-500">
                No matching items
              </div>
            ) : (
              searchMatches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    m.sel();
                    requestFocusTarget(m.id);
                    onCloseSearch();
                  }}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-sky-500/15"
                >
                  <span className="truncate font-mono font-medium">{m.label}</span>
                  <span className="ml-2 shrink-0 text-[10px] text-slate-500">
                    {m.subtitle}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Double-Click Quick-Add Popup (F1.6) */}
      {quickAdd && (
        <div
          style={{ left: quickAdd.screenX, top: quickAdd.screenY }}
          className="absolute z-30 w-56 rounded-xl border border-slate-300 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <input
            autoFocus
            type="text"
            value={quickAdd.query}
            onChange={(e) => setQuickAdd({ ...quickAdd, query: e.target.value })}
            placeholder="Quick add…"
            className="mb-1.5 w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
          />
          <div className="space-y-0.5">
            {quickAddItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    item.run();
                    setQuickAdd(null);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-sky-500/15"
                >
                  <Icon className="h-3.5 w-3.5 text-sky-400" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Service / Action Server vs Client Prompt (F1.8) */}
      {rolePrompt && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/50 backdrop-blur-[1px]">
          <div className="w-80 rounded-xl border border-slate-300 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-sm font-semibold">
              Wire {rolePrompt.kind === "service" ? "Service" : "Action"} Port
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Choose how this node connects to{" "}
              <code className="font-mono text-sky-400">{rolePrompt.channelName}</code>:
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  connectNodeAndChannel(
                    rolePrompt.nodeId,
                    rolePrompt.channelId,
                    rolePrompt.kind === "service" ? "srv_server" : "action_server"
                  );
                  setRolePrompt(null);
                }}
                className="flex-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
              >
                {rolePrompt.kind === "service" ? "Service Server" : "Action Server"}
              </button>
              <button
                type="button"
                onClick={() => {
                  connectNodeAndChannel(
                    rolePrompt.nodeId,
                    rolePrompt.channelId,
                    rolePrompt.kind === "service" ? "srv_client" : "action_client"
                  );
                  setRolePrompt(null);
                }}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {rolePrompt.kind === "service" ? "Service Client" : "Action Client"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setRolePrompt(null)}
              className="mt-2 w-full rounded-md py-1 text-xs text-slate-500 hover:text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function GraphCanvas(props: {
  searchOpen: boolean;
  onCloseSearch: () => void;
}) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
