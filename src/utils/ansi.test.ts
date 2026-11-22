import { describe, expect, it } from "vitest";
import type { Package, RosNode } from "../bindings";
import { resolveNodeSourcePath } from "../store/useRunnerStore";
import { parseAnsi } from "./ansi";

describe("parseAnsi", () => {
  it("returns plain text unchanged when no escape sequences exist", () => {
    expect(parseAnsi("Finished <<< py_pubsub [0.92s]")).toEqual([
      { text: "Finished <<< py_pubsub [0.92s]" },
    ]);
  });

  it("parses foreground colors, bold, and reset codes", () => {
    const segs = parseAnsi("\x1b[1;31merror:\x1b[0m undeclared identifier");
    expect(segs).toEqual([
      { text: "error:", className: "text-rose-400 font-semibold" },
      { text: " undeclared identifier", className: undefined },
    ]);
  });

  it("handles dim and bright foreground resets", () => {
    const segs = parseAnsi("\x1b[2;36m[INFO]\x1b[22;39m ok");
    expect(segs).toEqual([
      { text: "[INFO]", className: "text-cyan-400 opacity-70" },
      { text: " ok", className: undefined },
    ]);
  });
});

describe("resolveNodeSourcePath", () => {
  const baseNode: RosNode = {
    id: "n1",
    name: "talker",
    executable: "talker",
    className: "TalkerNode",
    namespace: "",
    ownership: "generated",
    sourceFile: null,
    ports: [],
    params: [],
    timers: [],
  };

  const basePkg: Package = {
    id: "p1",
    name: "py_pubsub",
    lang: "python",
    version: "0.1.0",
    description: "",
    maintainer: { name: "Dev", email: "dev@example.com" },
    license: "Apache-2.0",
    nodes: [baseNode],
    launchFiles: [],
    extraDeps: [],
  };

  it("infers Python and C++ generated paths when sourceFile is unset", () => {
    const cppPkg: Package = { ...basePkg, id: "p2", name: "cpp_pubsub", lang: "cpp" };

    expect(resolveNodeSourcePath("/tmp/ws/", basePkg, baseNode)).toBe(
      "/tmp/ws/src/py_pubsub/py_pubsub/talker.py"
    );
    expect(resolveNodeSourcePath("/tmp/ws", cppPkg, { ...baseNode, name: "listener" })).toBe(
      "/tmp/ws/src/cpp_pubsub/src/listener.cpp"
    );
  });

  it("honors explicit relative and absolute sourceFile overrides", () => {
    expect(
      resolveNodeSourcePath("/tmp/ws", basePkg, {
        ...baseNode,
        sourceFile: "src/custom/my_node.py",
      })
    ).toBe("/tmp/ws/src/custom/my_node.py");

    expect(
      resolveNodeSourcePath("/tmp/ws", basePkg, {
        ...baseNode,
        sourceFile: "/opt/custom/talker.py",
      })
    ).toBe("/opt/custom/talker.py");
  });
});
