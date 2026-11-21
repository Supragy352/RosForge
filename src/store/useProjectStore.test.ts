import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../bindings";
import { useProjectStore } from "./useProjectStore";

vi.mock("../bindings", () => ({
  commands: {
    validateProject: vi.fn().mockResolvedValue([]),
    saveProject: vi.fn().mockImplementation(async (p: Project) => p),
    getInterfaceCatalog: vi.fn().mockResolvedValue({
      rosDistro: "jazzy",
      source: "fallback",
      messages: ["std_msgs/msg/String"],
      services: ["std_srvs/srv/Trigger"],
      actions: ["action_tutorials_interfaces/action/Fibonacci"],
    }),
  },
}));

function blankProject(): Project {
  return {
    schemaVersion: 1,
    name: "test_ws",
    workspacePath: "/tmp/test_ws",
    rosDistro: "jazzy",
    packages: [],
    channels: [],
    canvas: {
      positions: {},
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    generatedFileHashes: {},
  };
}

describe("useProjectStore (M1 graph mutations & undo/redo)", () => {
  beforeEach(() => {
    useProjectStore.getState().loadProjectDirect(blankProject());
    useProjectStore.temporal.getState().clear();
  });

  it("wires nodes to topic/service/action channels and deduplicates ports", () => {
    const store = useProjectStore.getState();
    const pkgId = store.addPackage("python")!;
    const nodeId = useProjectStore.getState().addNode(pkgId)!;
    const topicId = useProjectStore
      .getState()
      .addChannel("topic", { x: 400, y: 100 }, "/chatter", "std_msgs/msg/String")!;

    const portId1 = useProjectStore
      .getState()
      .connectNodeAndChannel(nodeId, topicId, "pub");
    expect(portId1).toBeTruthy();

    // Duplicate (same node, channel, kind) is ignored
    const duplicatePort = useProjectStore
      .getState()
      .connectNodeAndChannel(nodeId, topicId, "pub");
    expect(duplicatePort).toBeNull();

    // Same node can also subscribe to same topic
    const subPortId = useProjectStore
      .getState()
      .connectNodeAndChannel(nodeId, topicId, "sub");
    expect(subPortId).toBeTruthy();

    const node = useProjectStore.getState().project!.packages[0].nodes[0];
    expect(node.ports).toHaveLength(2);
    expect(node.ports.map((p) => p.kind)).toEqual(["pub", "sub"]);
  });

  it("supports undo and redo across graph edits via zundo", () => {
    const pkgId = useProjectStore.getState().addPackage("cpp")!;
    const nodeId = useProjectStore.getState().addNode(pkgId)!;
    const chId = useProjectStore.getState().addChannel("topic")!;
    useProjectStore.getState().connectNodeAndChannel(nodeId, chId, "pub");

    expect(
      useProjectStore.getState().project!.packages[0].nodes[0].ports
    ).toHaveLength(1);

    // Undo wiring
    useProjectStore.temporal.getState().undo();
    expect(
      useProjectStore.getState().project!.packages[0].nodes[0].ports
    ).toHaveLength(0);

    // Redo wiring
    useProjectStore.temporal.getState().redo();
    expect(
      useProjectStore.getState().project!.packages[0].nodes[0].ports
    ).toHaveLength(1);
  });

  it("duplicates nodes with regenerated IDs and _copy suffix, and cleans up ports on channel delete", () => {
    const pkgId = useProjectStore.getState().addPackage("python")!;
    const nodeId = useProjectStore.getState().addNode(pkgId)!;
    const chId = useProjectStore.getState().addChannel("topic")!;
    useProjectStore.getState().connectNodeAndChannel(nodeId, chId, "pub");

    useProjectStore.getState().duplicateIds([nodeId]);
    const nodes = useProjectStore.getState().project!.packages[0].nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[1].id).not.toBe(nodes[0].id);
    expect(nodes[1].name).toBe(`${nodes[0].name}_copy`);
    expect(nodes[1].ports[0].id).not.toBe(nodes[0].ports[0].id);

    // Deleting channel removes attached ports from all nodes
    useProjectStore.getState().deleteChannel(chId);
    const updatedNodes = useProjectStore.getState().project!.packages[0].nodes;
    expect(updatedNodes[0].ports).toHaveLength(0);
    expect(updatedNodes[1].ports).toHaveLength(0);
  });
});
