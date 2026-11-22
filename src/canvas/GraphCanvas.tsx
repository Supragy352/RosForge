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
  type EdgeChange,
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
import { ChannelEdge, type ChannelFlowEdge } from "./ChannelEdge";
import { channelColorForType } from "./channelColors";
import { ChannelPillNode, type ChannelFlowNode } from "./ChannelPillNode";
import {
  PACKAGE_MIN_HEIGHT,
  PACKAGE_MIN_WIDTH,
  PKG_PAD_BOTTOM,
  PKG_PAD_LEFT,
  PKG_PAD_RIGHT,
  PKG_PAD_TOP,
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

const edgeTypes = {
  channelEdge: ChannelEdge,
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

interface MeasuredSize {
  width: number;
  height: number;
}

function buildFlowElements(
  project: Project,
  diagnostics: Array<{ severity: string; targetId?: string | null }>,
  onQuickAddNode: (pkgId: string) => void,
  livePositions: Record<string, { x: number; y: number }>,
  measuredSizes: Record<string, MeasuredSize>,
  selectedNodeIds: Set<string>,
  selectedEdgeIds: Set<string>
): { nodes: AnyFlowNode[]; edges: ChannelFlowEdge[] } {
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
  const edges: ChannelFlowEdge[] = [];

  for (const pkg of project.packages) {
    // Compute package bounds dynamically in ALL 4 directions using live positions & real measured sizes
    let minChildX = PKG_PAD_LEFT;
    let minChildY = PKG_PAD_TOP;
    let maxRight = PACKAGE_MIN_WIDTH;
    let maxBottom = PACKAGE_MIN_HEIGHT;

    pkg.nodes.forEach((n, idx) => {
      const savedPos = project.canvas.positions[n.id] ?? {
        x: PKG_PAD_LEFT,
        y: PKG_PAD_TOP + idx * 170,
      };
      const effPos = livePositions[n.id] ?? {
        x: savedPos.x ?? PKG_PAD_LEFT,
        y: savedPos.y ?? PKG_PAD_TOP + idx * 170,
      };
      const measured = measuredSizes[n.id];
      const nodeW = Math.max(measured?.width ?? 0, ROS_NODE_WIDTH);
      const nodeH = Math.max(measured?.height ?? 0, estimateNodeHeight(n.ports));

      if (effPos.x < minChildX) minChildX = effPos.x;
      if (effPos.y < minChildY) minChildY = effPos.y;
      const rx = effPos.x + nodeW + PKG_PAD_RIGHT;
      const rb = effPos.y + nodeH + PKG_PAD_BOTTOM;
      if (rx > maxRight) maxRight = rx;
      if (rb > maxBottom) maxBottom = rb;
    });

    const expandLeft = Math.max(0, Math.round(PKG_PAD_LEFT - minChildX));
    const expandTop = Math.max(0, Math.round(PKG_PAD_TOP - minChildY));

    const savedPkgPos = project.canvas.positions[pkg.id] ?? { x: 40, y: 60 };
    const effPkgPos = livePositions[pkg.id] ?? {
      x: savedPkgPos.x ?? 40,
      y: savedPkgPos.y ?? 60,
    };

    nodes.push({
      id: pkg.id,
      type: "packageGroup",
      position: effPkgPos,
      selected: selectedNodeIds.has(pkg.id),
      style: { width: Math.round(maxRight), height: Math.round(maxBottom) },
      data: {
        packageId: pkg.id,
        name: pkg.name,
        lang: pkg.lang,
        nodeCount: pkg.nodes.length,
        hasError: errorTargets.has(pkg.id),
        expandLeft,
        expandTop,
        onQuickAddNode,
      },
    });

    pkg.nodes.forEach((rosNode, idx) => {
      const savedNodePos = project.canvas.positions[rosNode.id] ?? {
        x: PKG_PAD_LEFT,
        y: PKG_PAD_TOP + idx * 170,
      };
      const effNodePos = livePositions[rosNode.id] ?? {
        x: savedNodePos.x ?? PKG_PAD_LEFT,
        y: savedNodePos.y ?? PKG_PAD_TOP + idx * 170,
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
        position: effNodePos,
        selected: selectedNodeIds.has(rosNode.id),
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
        const edgeId = `port:${pkg.id}:${rosNode.id}:${pt.id}`;
        const isAction =
          pt.kind === "action_client" || pt.kind === "action_server";
        edges.push({
          id: edgeId,
          type: "channelEdge",
          source: isOutgoing ? rosNode.id : ch.id,
          sourceHandle: "out",
          target: isOutgoing ? ch.id : rosNode.id,
          targetHandle: "in",
          selected: selectedEdgeIds.has(edgeId),
          data: {
            label: labelMap[pt.kind],
            color,
            dashed: isAction,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: selectedEdgeIds.has(edgeId) ? "#38bdf8" : color,
            width: 16,
            height: 16,
          },
        });
      }
    });
  }

  project.channels.forEach((ch, idx) => {
    const savedPos = project.canvas.positions[ch.id] ?? {
      x: 420,
      y: 90 + idx * 100,
    };
    const effPos = livePositions[ch.id] ?? {
      x: savedPos.x ?? 420,
      y: savedPos.y ?? 90 + idx * 100,
    };
    nodes.push({
      id: ch.id,
      type: "channelPill",
      position: effPos,
      selected: selectedNodeIds.has(ch.id),
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
  const storeSelected = useProjectStore((s) => s.selected);
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

  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const [rolePrompt, setRolePrompt] = useState<PendingRolePrompt | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [livePositions, setLivePositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [measuredSizes, setMeasuredSizes] = useState<
    Record<string, MeasuredSize>
  >({});
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(
    () => new Set()
  );

  // Sync external selection (Outline click, Problems click, Ctrl+F jump, newly added item) onto canvas
  useEffect(() => {
    if (!storeSelected) {
      setSelectedNodeIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const targetId =
      storeSelected.kind === "port" ? storeSelected.nodeId : storeSelected.id;
    setSelectedNodeIds((prev) => {
      if (prev.size === 1 && prev.has(targetId)) return prev;
      return new Set([targetId]);
    });
  }, [storeSelected]);

  const handleQuickAddNode = useCallback(
    (pkgId: string) => {
      addNode(pkgId);
    },
    [addNode]
  );

  const { nodes, edges } = useMemo(() => {
    if (!project) return { nodes: [], edges: [] };
    return buildFlowElements(
      project,
      diagnostics,
      handleQuickAddNode,
      livePositions,
      measuredSizes,
      selectedNodeIds,
      selectedEdgeIds
    );
  }, [
    project,
    diagnostics,
    handleQuickAddNode,
    livePositions,
    measuredSizes,
    selectedNodeIds,
    selectedEdgeIds,
  ]);

  // Focus & zoom to target when requested (Problems panel click or Ctrl+F search)
  useEffect(() => {
    if (!focusTargetId || !project) return;
    const targetNode = rf.getNode(focusTargetId);
    if (targetNode) {
      void rf.fitView({ nodes: [targetNode], padding: 0.4, duration: 250 });
    }
    requestFocusTarget(null);
  }, [focusTargetId, project, rf, requestFocusTarget]);

  // Keyboard shortcuts inside canvas (Ctrl+D duplicate, Delete/Backspace for nodes & edges)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (!project) return;

      const activeNodeIds =
        selectedNodeIds.size > 0
          ? Array.from(selectedNodeIds)
          : storeSelected && storeSelected.kind !== "port"
            ? [storeSelected.id]
            : [];

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        if (activeNodeIds.length > 0) {
          e.preventDefault();
          duplicateIds(activeNodeIds);
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedEdgeIds.size > 0 || activeNodeIds.length > 0) {
          e.preventDefault();
          if (selectedEdgeIds.size > 0) {
            for (const edgeId of selectedEdgeIds) {
              const parts = edgeId.split(":");
              if (parts[0] === "port" && parts.length === 4) {
                deletePort(parts[1], parts[2], parts[3]);
              }
            }
            setSelectedEdgeIds(new Set());
          }
          if (activeNodeIds.length > 0) {
            deleteIds(activeNodeIds);
            setSelectedNodeIds(new Set());
          }
        }
      } else if (e.key === "Escape") {
        setQuickAdd(null);
        setRolePrompt(null);
        if (searchOpen) onCloseSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    project,
    selectedNodeIds,
    selectedEdgeIds,
    storeSelected,
    duplicateIds,
    deleteIds,
    deletePort,
    searchOpen,
    onCloseSearch,
  ]);

  const onNodesChange = useCallback((changes: NodeChange<AnyFlowNode>[]) => {
    const dragUpdates: Record<string, { x: number; y: number }> = {};
    let hasDrag = false;
    const dimUpdates: Record<string, MeasuredSize> = {};
    let hasDim = false;
    let selectChanges: Array<{ id: string; selected: boolean }> | null = null;

    for (const ch of changes) {
      if (ch.type === "position" && ch.position && ch.dragging) {
        dragUpdates[ch.id] = ch.position;
        hasDrag = true;
      } else if (ch.type === "select") {
        if (!selectChanges) selectChanges = [];
        selectChanges.push({ id: ch.id, selected: ch.selected });
      } else if (ch.type === "dimensions" && ch.dimensions) {
        const w = Math.round(ch.dimensions.width);
        const h = Math.round(ch.dimensions.height);
        if (w > 0 && h > 0) {
          dimUpdates[ch.id] = { width: w, height: h };
          hasDim = true;
        }
      }
    }

    if (hasDrag) {
      setLivePositions((prev) => ({ ...prev, ...dragUpdates }));
    }
    if (hasDim) {
      setMeasuredSizes((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, sz] of Object.entries(dimUpdates)) {
          const cur = prev[id];
          if (!cur || cur.width !== sz.width || cur.height !== sz.height) {
            next[id] = sz;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
    if (selectChanges) {
      setSelectedNodeIds((prev) => {
        const next = new Set(prev);
        for (const sc of selectChanges) {
          if (sc.selected) next.add(sc.id);
          else next.delete(sc.id);
        }
        return next;
      });
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<ChannelFlowEdge>[]) => {
    let selectChanges: Array<{ id: string; selected: boolean }> | null = null;
    for (const ch of changes) {
      if (ch.type === "select") {
        if (!selectChanges) selectChanges = [];
        selectChanges.push({ id: ch.id, selected: ch.selected });
      }
    }
    if (selectChanges) {
      setSelectedEdgeIds((prev) => {
        const next = new Set(prev);
        for (const sc of selectChanges) {
          if (sc.selected) next.add(sc.id);
          else next.delete(sc.id);
        }
        return next;
      });
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
                x: Math.max(PKG_PAD_LEFT, Math.round(absX - ox)),
                y: Math.max(PKG_PAD_TOP, Math.round(absY - oy)),
              });
              return;
            }
          }
        }

        // Normalize package frame if child was dragged past the left or top padding
        if (currentPkg) {
          const updatedChildX = Math.round(draggedNode.position.x);
          const updatedChildY = Math.round(draggedNode.position.y);

          let minX = updatedChildX;
          let minY = updatedChildY;
          currentPkg.nodes.forEach((n, idx) => {
            if (n.id === draggedNode.id) return;
            const p = project.canvas.positions[n.id] ?? {
              x: PKG_PAD_LEFT,
              y: PKG_PAD_TOP + idx * 170,
            };
            if ((p.x ?? PKG_PAD_LEFT) < minX) minX = p.x ?? PKG_PAD_LEFT;
            if ((p.y ?? PKG_PAD_TOP) < minY) minY = p.y ?? PKG_PAD_TOP;
          });

          const shiftX = minX < PKG_PAD_LEFT ? PKG_PAD_LEFT - minX : 0;
          const shiftY = minY < PKG_PAD_TOP ? PKG_PAD_TOP - minY : 0;

          if (shiftX > 0 || shiftY > 0) {
            const batch: Record<string, { x: number; y: number }> = {
              [currentPkg.id]: {
                x: Math.round((currentPkgPos.x ?? 40) - shiftX),
                y: Math.round((currentPkgPos.y ?? 60) - shiftY),
              },
            };
            currentPkg.nodes.forEach((n, idx) => {
              const baseX =
                n.id === draggedNode.id
                  ? updatedChildX
                  : (project.canvas.positions[n.id]?.x ?? PKG_PAD_LEFT);
              const baseY =
                n.id === draggedNode.id
                  ? updatedChildY
                  : (project.canvas.positions[n.id]?.y ?? PKG_PAD_TOP + idx * 170);
              batch[n.id] = {
                x: Math.round(baseX + shiftX),
                y: Math.round(baseY + shiftY),
              };
            });
            setPositions(batch);
            return;
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
      if (!project) return;
      if (selNodes.length === 0) {
        setSelected(null);
        return;
      }
      if (selNodes.length !== 1) return;
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
        let relPos = { x: PKG_PAD_LEFT, y: PKG_PAD_TOP };
        for (const pkg of project.packages) {
          const fn = rf.getNode(pkg.id);
          const px = fn?.position.x ?? project.canvas.positions[pkg.id]?.x ?? 0;
          const py = fn?.position.y ?? project.canvas.positions[pkg.id]?.y ?? 0;
          const pw = Number(fn?.measured?.width ?? fn?.style?.width ?? PACKAGE_MIN_WIDTH);
          const ph = Number(fn?.measured?.height ?? fn?.style?.height ?? PACKAGE_MIN_HEIGHT);
          if (rounded.x >= px && rounded.x <= px + pw && rounded.y >= py && rounded.y <= py + ph) {
            targetPkgId = pkg.id;
            relPos = {
              x: Math.max(PKG_PAD_LEFT, Math.round(rounded.x - px)),
              y: Math.max(PKG_PAD_TOP, Math.round(rounded.y - py)),
            };
            break;
          }
        }
        if (!targetPkgId) {
          targetPkgId =
            project.packages[0]?.id ??
            addPackage("python", {
              x: rounded.x - PKG_PAD_LEFT,
              y: rounded.y - PKG_PAD_TOP,
            });
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
        edgeTypes={edgeTypes}
        colorMode={theme === "dark" ? "dark" : "light"}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onEdgesDelete={onEdgesDelete}
        onSelectionChange={onSelectionChange}
        onPaneClick={() => {
          setSelected(null);
          setSelectedNodeIds(new Set());
          setSelectedEdgeIds(new Set());
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
