import ELK from "elkjs/lib/elk.bundled.js";
import type { CanvasPosition, Project } from "../bindings";

const elk = new ELK();

export const PACKAGE_MIN_WIDTH = 310;
export const PACKAGE_MIN_HEIGHT = 220;
export const ROS_NODE_WIDTH = 250;
export const ROS_NODE_BASE_HEIGHT = 120;
export const CHANNEL_NODE_WIDTH = 220;
export const CHANNEL_NODE_HEIGHT = 64;

export function estimateNodeHeight(portCount: number): number {
  return Math.max(ROS_NODE_BASE_HEIGHT, 96 + portCount * 24);
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
      "elk.padding": "[top=48,left=20,bottom=24,right=20]",
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "28",
    },
    children: pkg.nodes.map((node) => ({
      id: node.id,
      width: ROS_NODE_WIDTH,
      height: estimateNodeHeight(node.ports.length),
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

  const laidOut = await elk.layout(graph);
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
