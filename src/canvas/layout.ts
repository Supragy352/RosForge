import ELK from "elkjs/lib/elk.bundled.js";
import type { CanvasPosition, Port, Project } from "../bindings";

let elkInstance: InstanceType<typeof ELK> | null = null;
function getElk() {
  if (!elkInstance) {
    elkInstance = new ELK();
  }
  return elkInstance;
}

export const PKG_PAD_LEFT = 24;
export const PKG_PAD_RIGHT = 24;
export const PKG_PAD_TOP = 56;
export const PKG_PAD_BOTTOM = 32;

export const PACKAGE_MIN_WIDTH = 310;
export const PACKAGE_MIN_HEIGHT = 220;
export const ROS_NODE_WIDTH = 250;
export const ROS_NODE_BASE_HEIGHT = 128;
export const CHANNEL_NODE_WIDTH = 220;
export const CHANNEL_NODE_HEIGHT = 64;

export function estimateNodeHeight(portsOrCount: Port[] | number): number {
  if (typeof portsOrCount === "number") {
    return Math.max(ROS_NODE_BASE_HEIGHT, 104 + portsOrCount * 36);
  }
  if (portsOrCount.length === 0) {
    return ROS_NODE_BASE_HEIGHT;
  }
  const distinctGroups = new Set(portsOrCount.map((p) => p.kind)).size;
  // Header (~38) + body padding (16) + footer (~30) + group headers (~20 each) + port rows (~26 each) + safety buffer
  return Math.max(
    ROS_NODE_BASE_HEIGHT,
    92 + distinctGroups * 20 + portsOrCount.length * 26
  );
}

/**
 * Computes deterministic left-to-right hierarchical coordinates for packages, nodes,
 * and channels using elkjs (F1.10).
 */
export async function computeAutoLayout(
  project: Project
): Promise<Record<string, CanvasPosition>> {
  const pkgChildren = project.packages.map((pkg) => ({
    id: pkg.id,
    layoutOptions: {
      "elk.padding": `[top=${PKG_PAD_TOP},left=${PKG_PAD_LEFT},bottom=${PKG_PAD_BOTTOM},right=${PKG_PAD_RIGHT}]`,
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "28",
    },
    children: pkg.nodes.map((node) => ({
      id: node.id,
      width: ROS_NODE_WIDTH,
      height: estimateNodeHeight(node.ports),
    })),
    width: pkg.nodes.length === 0 ? PACKAGE_MIN_WIDTH : undefined,
    height: pkg.nodes.length === 0 ? PACKAGE_MIN_HEIGHT : undefined,
  }));

  const channelChildren = project.channels.map((ch) => ({
    id: ch.id,
    width: CHANNEL_NODE_WIDTH,
    height: CHANNEL_NODE_HEIGHT,
  }));

  const edges: Array<{ id: string; sources: string[]; targets: string[] }> = [];
  for (const pkg of project.packages) {
    for (const node of pkg.nodes) {
      for (const port of node.ports) {
        const isOutgoing =
          port.kind === "pub" ||
          port.kind === "srv_client" ||
          port.kind === "action_client";
        edges.push({
          id: `e-${port.id}`,
          sources: [isOutgoing ? node.id : port.channelId],
          targets: [isOutgoing ? port.channelId : node.id],
        });
      }
    }
  }

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "44",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
    },
    children: [...pkgChildren, ...channelChildren],
    edges,
  };

  const laidOut = await getElk().layout(graph);
  const positions: Record<string, CanvasPosition> = {};

  for (const child of laidOut.children ?? []) {
    positions[child.id] = {
      x: Math.round(child.x ?? 0),
      y: Math.round(child.y ?? 0),
    };
    for (const grandChild of child.children ?? []) {
      positions[grandChild.id] = {
        x: Math.round(grandChild.x ?? 20),
        y: Math.round(grandChild.y ?? 52),
      };
    }
  }

  return positions;
}
