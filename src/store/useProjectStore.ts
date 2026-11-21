import { create } from "zustand";
import { temporal } from "zundo";
import {
  commands,
  type ApplyGenerateResult,
  type CanvasPosition,
  type ChannelKind,
  type Diagnostic,
  type FileResolution,
  type GeneratePreview,
  type InterfaceCatalog,
  type LaunchFile,
  type Package,
  type PackageLang,
  type Param,
  type ParamType,
  type ParamValue,
  type Port,
  type PortKind,
  type Project,
  type RosChannel,
  type RosNode,
  type Timer,
  type Viewport,
} from "../bindings";
import { useAppStore } from "./useAppStore";

export type SelectedEntity =
  | { kind: "package"; id: string }
  | { kind: "node"; id: string; packageId: string }
  | { kind: "channel"; id: string }
  | { kind: "port"; id: string; nodeId: string; packageId: string };

export interface OutputLogEntry {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  text: string;
}

export function generateClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function toPascalCase(input: string): string {
  const parts = input
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "RosNode";
  const joined = parts
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  return /^[0-9]/.test(joined) ? `Node${joined}` : joined;
}

export function defaultParamValueForType(paramType: ParamType): ParamValue {
  switch (paramType) {
    case "bool":
      return { kind: "bool", value: false };
    case "int":
      return { kind: "int", value: 0 };
    case "double":
      return { kind: "double", value: 0.0 };
    case "string":
      return { kind: "string", value: "" };
    case "bool_array":
      return { kind: "bool_array", value: [] };
    case "int_array":
      return { kind: "int_array", value: [] };
    case "double_array":
      return { kind: "double_array", value: [] };
    case "string_array":
      return { kind: "string_array", value: [] };
  }
}

export function defaultInterfaceTypeForKind(kind: ChannelKind): string {
  switch (kind) {
    case "topic":
      return "std_msgs/msg/String";
    case "service":
      return "std_srvs/srv/Trigger";
    case "action":
      return "action_tutorials_interfaces/action/Fibonacci";
  }
}

function nowTimeLabel(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatErr(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let validateTimer: ReturnType<typeof setTimeout> | null = null;

interface ProjectStoreState {
  project: Project | null;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  diagnostics: Diagnostic[];
  catalog: InterfaceCatalog | null;
  loadingCatalog: boolean;
  selected: SelectedEntity | null;
  bottomTab: "problems" | "output";
  bottomPanelOpen: boolean;
  outputLog: OutputLogEntry[];
  workspaceModalOpen: boolean;
  generateModalOpen: boolean;
  generatePreview: GeneratePreview | null;
  generating: boolean;
  focusTargetId: string | null;

  appendLog: (level: OutputLogEntry["level"], text: string) => void;
  setSelected: (sel: SelectedEntity | null) => void;
  setBottomTab: (tab: "problems" | "output") => void;
  setBottomPanelOpen: (open: boolean) => void;
  setWorkspaceModalOpen: (open: boolean) => void;
  setGenerateModalOpen: (open: boolean) => void;
  requestFocusTarget: (id: string | null) => void;

  loadProjectDirect: (project: Project) => void;
  openWorkspace: (workspacePath: string, projectName?: string) => Promise<boolean>;
  createExampleWorkspace: (workspacePath: string) => Promise<boolean>;
  saveNow: () => Promise<boolean>;
  runValidation: () => Promise<void>;
  loadCatalog: (refresh?: boolean) => Promise<void>;

  mutateProject: (mutator: (prev: Project) => Project, skipAutosave?: boolean) => void;

  addPackage: (lang: PackageLang, pos?: CanvasPosition) => string | null;
  updatePackage: (pkgId: string, patch: Partial<Package>) => void;
  deletePackage: (pkgId: string) => void;
  updateLaunchFile: (pkgId: string, launchFile: LaunchFile) => void;

  addNode: (pkgId: string, pos?: CanvasPosition) => string | null;
  updateNode: (pkgId: string, nodeId: string, patch: Partial<RosNode>) => void;
  moveNodeToPackage: (
    nodeId: string,
    fromPkgId: string,
    toPkgId: string,
    pos?: CanvasPosition
  ) => void;
  deleteNode: (pkgId: string, nodeId: string) => void;

  addChannel: (
    kind: ChannelKind,
    pos?: CanvasPosition,
    name?: string,
    interfaceType?: string
  ) => string | null;
  updateChannel: (channelId: string, patch: Partial<RosChannel>) => void;
  deleteChannel: (channelId: string) => void;

  connectNodeAndChannel: (
    nodeId: string,
    channelId: string,
    kind: PortKind
  ) => string | null;
  updatePort: (
    pkgId: string,
    nodeId: string,
    portId: string,
    patch: Partial<Port>
  ) => void;
  deletePort: (pkgId: string, nodeId: string, portId: string) => void;

  addParam: (pkgId: string, nodeId: string) => void;
  updateParam: (
    pkgId: string,
    nodeId: string,
    paramId: string,
    patch: Partial<Param>
  ) => void;
  deleteParam: (pkgId: string, nodeId: string, paramId: string) => void;

  addTimer: (pkgId: string, nodeId: string) => void;
  updateTimer: (
    pkgId: string,
    nodeId: string,
    timerId: string,
    patch: Partial<Timer>
  ) => void;
  deleteTimer: (pkgId: string, nodeId: string, timerId: string) => void;

  setPositions: (updates: Record<string, CanvasPosition>) => void;
  setViewport: (viewport: Viewport) => void;
  duplicateIds: (ids: string[]) => void;
  deleteIds: (ids: string[]) => void;

  openGeneratePreview: () => Promise<void>;
  applyGenerate: (
    resolutions: Record<string, FileResolution>
  ) => Promise<ApplyGenerateResult | null>;
}

export const useProjectStore = create<ProjectStoreState>()(
  temporal(
    (set, get) => {
      const scheduleEffects = () => {
        if (validateTimer) clearTimeout(validateTimer);
        validateTimer = setTimeout(() => {
          void get().runValidation();
        }, 180);

        if (autosaveTimer) clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
          const st = get();
          if (st.project && st.dirty && !st.saving) {
            void st.saveNow();
          }
        }, 1000);
      };

      return {
        project: null,
        dirty: false,
        saving: false,
        lastSavedAt: null,
        diagnostics: [],
        catalog: null,
        loadingCatalog: false,
        selected: null,
        bottomTab: "problems",
        bottomPanelOpen: true,
        outputLog: [],
        workspaceModalOpen: false,
        generateModalOpen: false,
        generatePreview: null,
        generating: false,
        focusTargetId: null,

        appendLog: (level, text) =>
          set((s) => ({
            outputLog: [
              ...s.outputLog.slice(-199),
              { id: generateClientId(), ts: nowTimeLabel(), level, text },
            ],
          })),

        setSelected: (selected) => set({ selected }),
        setBottomTab: (bottomTab) => set({ bottomTab, bottomPanelOpen: true }),
        setBottomPanelOpen: (bottomPanelOpen) => set({ bottomPanelOpen }),
        setWorkspaceModalOpen: (workspaceModalOpen) => set({ workspaceModalOpen }),
        setGenerateModalOpen: (generateModalOpen) => set({ generateModalOpen }),
        requestFocusTarget: (focusTargetId) => set({ focusTargetId }),

        loadProjectDirect: (project) => {
          set({
            project,
            dirty: false,
            selected: null,
            diagnostics: [],
          });
          useProjectStore.temporal.getState().clear();
          void get().runValidation();
        },

        openWorkspace: async (workspacePath, projectName) => {
          const trimmed = workspacePath.trim();
          if (!trimmed) return false;
          try {
            const project = await commands.openWorkspace(
              trimmed,
              projectName?.trim() || null
            );
            set({
              project,
              dirty: false,
              lastSavedAt: Date.now(),
              selected: null,
              workspaceModalOpen: false,
            });
            useProjectStore.temporal.getState().clear();
            get().appendLog("info", `Opened workspace: ${project.workspacePath}`);
            await Promise.all([get().runValidation(), get().loadCatalog(false)]);
            // Refresh settings so recentWorkspaces updates
            try {
              const raw = await commands.getSettings();
              useAppStore.setState((s) => ({
                settings: {
                  ...s.settings,
                  recentWorkspaces: raw.recentWorkspaces ?? s.settings.recentWorkspaces,
                },
              }));
            } catch {
              // ignore in non-tauri test env
            }
            return true;
          } catch (err) {
            get().appendLog("error", `Failed to open workspace: ${formatErr(err)}`);
            return false;
          }
        },

        createExampleWorkspace: async (workspacePath) => {
          const trimmed = workspacePath.trim();
          if (!trimmed) return false;
          try {
            const project = await commands.createExampleProject(trimmed);
            set({
              project,
              dirty: false,
              lastSavedAt: Date.now(),
              selected: null,
              workspaceModalOpen: false,
            });
            useProjectStore.temporal.getState().clear();
            get().appendLog(
              "info",
              `Created talker/listener example workspace at ${project.workspacePath}`
            );
            await Promise.all([get().runValidation(), get().loadCatalog(false)]);
            return true;
          } catch (err) {
            get().appendLog("error", `Failed to create example: ${formatErr(err)}`);
            return false;
          }
        },

        saveNow: async () => {
          const { project } = get();
          if (!project) return false;
          if (autosaveTimer) {
            clearTimeout(autosaveTimer);
            autosaveTimer = null;
          }
          set({ saving: true });
          try {
            const saved = await commands.saveProject(project);
            set({ project: saved, dirty: false, saving: false, lastSavedAt: Date.now() });
            return true;
          } catch (err) {
            set({ saving: false });
            get().appendLog("error", `Save failed: ${formatErr(err)}`);
            return false;
          }
        },

        runValidation: async () => {
          const { project } = get();
          if (!project) {
            set({ diagnostics: [] });
            return;
          }
          try {
            const diagnostics = await commands.validateProject(project);
            set({ diagnostics });
          } catch {
            // In non-Tauri browser preview, ignore IPC error gracefully
          }
        },

        loadCatalog: async (refresh = false) => {
          set({ loadingCatalog: true });
          try {
            const catalog = await commands.getInterfaceCatalog(refresh);
            set({ catalog, loadingCatalog: false });
            if (refresh) {
              get().appendLog(
                "info",
                `Refreshed ROS 2 interface catalog (${catalog.messages.length} msgs, ${catalog.services.length} srvs, ${catalog.actions.length} actions; source=${catalog.source})`
              );
            }
          } catch (err) {
            set({ loadingCatalog: false });
            get().appendLog("warn", `Interface catalog load failed: ${formatErr(err)}`);
          }
        },

        mutateProject: (mutator, skipAutosave = false) => {
          const current = get().project;
          if (!current) return;
          const next = mutator(current);
          if (next === current) return;
          set({ project: next, dirty: true });
          if (!skipAutosave) {
            scheduleEffects();
          }
        },

        addPackage: (lang, pos) => {
          const current = get().project;
          if (!current) return null;
          const settings = useAppStore.getState().settings;
          const baseName = lang === "python" ? "py_pkg" : "cpp_pkg";
          let idx = current.packages.length + 1;
          let pkgName = `${baseName}_${idx}`;
          while (current.packages.some((p) => p.name === pkgName)) {
            idx += 1;
            pkgName = `${baseName}_${idx}`;
          }
          const id = generateClientId();
          const newPkg: Package = {
            id,
            name: pkgName,
            lang,
            version: "0.1.0",
            description: "",
            maintainer: {
              name: settings.defaultMaintainerName || "RosForge User",
              email: settings.defaultMaintainerEmail || "user@example.com",
            },
            license: "Apache-2.0",
            nodes: [],
            launchFiles: [
              {
                id: generateClientId(),
                name: `${pkgName}.launch.py`,
                entries: [],
              },
            ],
            extraDeps: [],
          };

          const position = pos ?? {
            x: 60 + current.packages.length * 360,
            y: 80,
          };

          get().mutateProject((prev) => ({
            ...prev,
            packages: [...prev.packages, newPkg],
            canvas: {
              ...prev.canvas,
              positions: { ...prev.canvas.positions, [id]: position },
            },
          }));
          set({ selected: { kind: "package", id } });
          return id;
        },

        updatePackage: (pkgId, patch) => {
          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) =>
              p.id === pkgId ? { ...p, ...patch } : p
            ),
          }));
        },

        deletePackage: (pkgId) => {
          get().mutateProject((prev) => {
            const target = prev.packages.find((p) => p.id === pkgId);
            const removedIds = new Set<string>([
              pkgId,
              ...(target?.nodes.map((n) => n.id) ?? []),
            ]);
            const nextPositions = { ...prev.canvas.positions };
            removedIds.forEach((rid) => delete nextPositions[rid]);
            return {
              ...prev,
              packages: prev.packages.filter((p) => p.id !== pkgId),
              canvas: { ...prev.canvas, positions: nextPositions },
            };
          });
          set((s) =>
            s.selected?.id === pkgId ||
            (s.selected &&
              "packageId" in s.selected &&
              s.selected.packageId === pkgId)
              ? { selected: null }
              : s
          );
        },

        updateLaunchFile: (pkgId, launchFile) => {
          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) => {
              if (p.id !== pkgId) return p;
              const exists = p.launchFiles.some((lf) => lf.id === launchFile.id);
              return {
                ...p,
                launchFiles: exists
                  ? p.launchFiles.map((lf) =>
                      lf.id === launchFile.id ? launchFile : lf
                    )
                  : [...p.launchFiles, launchFile],
              };
            }),
          }));
        },

        addNode: (pkgId, pos) => {
          const current = get().project;
          if (!current) return null;
          const pkg = current.packages.find((p) => p.id === pkgId);
          if (!pkg) return null;

          let idx = pkg.nodes.length + 1;
          let nodeName = `node_${idx}`;
          while (pkg.nodes.some((n) => n.name === nodeName)) {
            idx += 1;
            nodeName = `node_${idx}`;
          }

          const id = generateClientId();
          const newNode: RosNode = {
            id,
            name: nodeName,
            executable: nodeName,
            className: toPascalCase(nodeName),
            namespace: "",
            ownership: "generated",
            ports: [],
            params: [],
            timers: [],
            sourceFile: null,
          };

          const position = pos ?? {
            x: 24,
            y: 56 + pkg.nodes.length * 150,
          };

          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) => {
              if (p.id !== pkgId) return p;
              const updatedLaunchFiles =
                p.launchFiles.length > 0
                  ? p.launchFiles.map((lf, i) =>
                      i === 0
                        ? {
                            ...lf,
                            entries: [
                              ...lf.entries,
                              {
                                nodeId: id,
                                nameOverride: null,
                                namespace: null,
                                remaps: [],
                                paramOverrides: {},
                              },
                            ],
                          }
                        : lf
                    )
                  : [
                      {
                        id: generateClientId(),
                        name: `${p.name}.launch.py`,
                        entries: [
                          {
                            nodeId: id,
                            nameOverride: null,
                            namespace: null,
                            remaps: [],
                            paramOverrides: {},
                          },
                        ],
                      },
                    ];
              return {
                ...p,
                nodes: [...p.nodes, newNode],
                launchFiles: updatedLaunchFiles,
              };
            }),
            canvas: {
              ...prev.canvas,
              positions: { ...prev.canvas.positions, [id]: position },
            },
          }));
          set({ selected: { kind: "node", id, packageId: pkgId } });
          return id;
        },

        updateNode: (pkgId, nodeId, patch) => {
          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) =>
              p.id === pkgId
                ? {
                    ...p,
                    nodes: p.nodes.map((n) =>
                      n.id === nodeId ? { ...n, ...patch } : n
                    ),
                  }
                : p
            ),
          }));
        },

        moveNodeToPackage: (nodeId, fromPkgId, toPkgId, pos) => {
          if (fromPkgId === toPkgId) return;
          get().mutateProject((prev) => {
            const fromPkg = prev.packages.find((p) => p.id === fromPkgId);
            const node = fromPkg?.nodes.find((n) => n.id === nodeId);
            if (!node) return prev;

            return {
              ...prev,
              packages: prev.packages.map((p) => {
                if (p.id === fromPkgId) {
                  return {
                    ...p,
                    nodes: p.nodes.filter((n) => n.id !== nodeId),
                    launchFiles: p.launchFiles.map((lf) => ({
                      ...lf,
                      entries: lf.entries.filter((e) => e.nodeId !== nodeId),
                    })),
                  };
                }
                if (p.id === toPkgId) {
                  return {
                    ...p,
                    nodes: [...p.nodes, node],
                    launchFiles: p.launchFiles.map((lf, idx) =>
                      idx === 0
                        ? {
                            ...lf,
                            entries: [
                              ...lf.entries,
                              {
                                nodeId,
                                nameOverride: null,
                                namespace: null,
                                remaps: [],
                                paramOverrides: {},
                              },
                            ],
                          }
                        : lf
                    ),
                  };
                }
                return p;
              }),
              canvas: pos
                ? {
                    ...prev.canvas,
                    positions: { ...prev.canvas.positions, [nodeId]: pos },
                  }
                : prev.canvas,
            };
          });
          set({ selected: { kind: "node", id: nodeId, packageId: toPkgId } });
        },

        deleteNode: (pkgId, nodeId) => {
          get().mutateProject((prev) => {
            const nextPositions = { ...prev.canvas.positions };
            delete nextPositions[nodeId];
            return {
              ...prev,
              packages: prev.packages.map((p) =>
                p.id === pkgId
                  ? {
                      ...p,
                      nodes: p.nodes.filter((n) => n.id !== nodeId),
                      launchFiles: p.launchFiles.map((lf) => ({
                        ...lf,
                        entries: lf.entries.filter((e) => e.nodeId !== nodeId),
                      })),
                    }
                  : p
              ),
              canvas: { ...prev.canvas, positions: nextPositions },
            };
          });
          set((s) => (s.selected?.id === nodeId ? { selected: null } : s));
        },

        addChannel: (kind, pos, name, interfaceType) => {
          const current = get().project;
          if (!current) return null;
          const prefix =
            kind === "topic" ? "/topic" : kind === "service" ? "/service" : "/action";
          let idx = current.channels.filter((c) => c.kind === kind).length + 1;
          let chName = name ?? `${prefix}_${idx}`;
          while (!name && current.channels.some((c) => c.kind === kind && c.name === chName)) {
            idx += 1;
            chName = `${prefix}_${idx}`;
          }

          const id = generateClientId();
          const newCh: RosChannel = {
            id,
            kind,
            name: chName,
            type: interfaceType ?? defaultInterfaceTypeForKind(kind),
          };
          const position = pos ?? {
            x: 420,
            y: 90 + current.channels.length * 100,
          };

          get().mutateProject((prev) => ({
            ...prev,
            channels: [...prev.channels, newCh],
            canvas: {
              ...prev.canvas,
              positions: { ...prev.canvas.positions, [id]: position },
            },
          }));
          set({ selected: { kind: "channel", id } });
          return id;
        },

        updateChannel: (channelId, patch) => {
          get().mutateProject((prev) => ({
            ...prev,
            channels: prev.channels.map((c) =>
              c.id === channelId ? { ...c, ...patch } : c
            ),
          }));
        },

        deleteChannel: (channelId) => {
          get().mutateProject((prev) => {
            const nextPositions = { ...prev.canvas.positions };
            delete nextPositions[channelId];
            return {
              ...prev,
              channels: prev.channels.filter((c) => c.id !== channelId),
              packages: prev.packages.map((p) => ({
                ...p,
                nodes: p.nodes.map((n) => ({
                  ...n,
                  ports: n.ports.filter((pt) => pt.channelId !== channelId),
                })),
              })),
              canvas: { ...prev.canvas, positions: nextPositions },
            };
          });
          set((s) => (s.selected?.id === channelId ? { selected: null } : s));
        },

        connectNodeAndChannel: (nodeId, channelId, kind) => {
          const current = get().project;
          if (!current) return null;

          let targetPkgId: string | null = null;
          for (const pkg of current.packages) {
            const node = pkg.nodes.find((n) => n.id === nodeId);
            if (node) {
              if (
                node.ports.some(
                  (pt) => pt.channelId === channelId && pt.kind === kind
                )
              ) {
                return null;
              }
              targetPkgId = pkg.id;
              break;
            }
          }
          if (!targetPkgId) return null;

          const portId = generateClientId();
          const qos =
            kind === "srv_server" || kind === "srv_client"
              ? ({ preset: "services_default" } as const)
              : ({ preset: "default" } as const);

          const newPort: Port = {
            id: portId,
            kind,
            channelId,
            qos,
            behavior: null,
            origin: "ui",
            codeLocation: null,
          };

          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) =>
              p.id === targetPkgId
                ? {
                    ...p,
                    nodes: p.nodes.map((n) =>
                      n.id === nodeId
                        ? { ...n, ports: [...n.ports, newPort] }
                        : n
                    ),
                  }
                : p
            ),
          }));
          return portId;
        },

        updatePort: (pkgId, nodeId, portId, patch) => {
          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) =>
              p.id === pkgId
                ? {
                    ...p,
                    nodes: p.nodes.map((n) =>
                      n.id === nodeId
                        ? {
                            ...n,
                            ports: n.ports.map((pt) =>
                              pt.id === portId ? { ...pt, ...patch } : pt
                            ),
                          }
                        : n
                    ),
                  }
                : p
            ),
          }));
        },

        deletePort: (pkgId, nodeId, portId) => {
          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) =>
              p.id === pkgId
                ? {
                    ...p,
                    nodes: p.nodes.map((n) =>
                      n.id === nodeId
                        ? { ...n, ports: n.ports.filter((pt) => pt.id !== portId) }
                        : n
                    ),
                  }
                : p
            ),
          }));
        },

        addParam: (pkgId, nodeId) => {
          const current = get().project;
          if (!current) return;
          const pkg = current.packages.find((p) => p.id === pkgId);
          const node = pkg?.nodes.find((n) => n.id === nodeId);
          if (!node) return;
          let idx = node.params.length + 1;
          let name = `param_${idx}`;
          while (node.params.some((pr) => pr.name === name)) {
            idx += 1;
            name = `param_${idx}`;
          }
          const newParam: Param = {
            id: generateClientId(),
            name,
            type: "string",
            default: { kind: "string", value: "" },
            description: "",
            origin: "ui",
          };
          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) =>
              p.id === pkgId
                ? {
                    ...p,
                    nodes: p.nodes.map((n) =>
                      n.id === nodeId
                        ? { ...n, params: [...n.params, newParam] }
                        : n
                    ),
                  }
                : p
            ),
          }));
        },

        updateParam: (pkgId, nodeId, paramId, patch) => {
          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) =>
              p.id === pkgId
                ? {
                    ...p,
                    nodes: p.nodes.map((n) =>
                      n.id === nodeId
                        ? {
                            ...n,
                            params: n.params.map((pr) =>
                              pr.id === paramId ? { ...pr, ...patch } : pr
                            ),
                          }
                        : n
                    ),
                  }
                : p
            ),
          }));
        },

        deleteParam: (pkgId, nodeId, paramId) => {
          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) =>
              p.id === pkgId
                ? {
                    ...p,
                    nodes: p.nodes.map((n) =>
                      n.id === nodeId
                        ? {
                            ...n,
                            params: n.params.filter((pr) => pr.id !== paramId),
                          }
                        : n
                    ),
                  }
                : p
            ),
          }));
        },

        addTimer: (pkgId, nodeId) => {
          const current = get().project;
          if (!current) return;
          const pkg = current.packages.find((p) => p.id === pkgId);
          const node = pkg?.nodes.find((n) => n.id === nodeId);
          if (!node) return;
          let idx = node.timers.length + 1;
          let name = `timer_${idx}`;
          while (node.timers.some((t) => t.name === name)) {
            idx += 1;
            name = `timer_${idx}`;
          }
          const newTimer: Timer = {
            id: generateClientId(),
            name,
            periodMs: 1000,
            behavior: null,
            origin: "ui",
          };
          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) =>
              p.id === pkgId
                ? {
                    ...p,
                    nodes: p.nodes.map((n) =>
                      n.id === nodeId
                        ? { ...n, timers: [...n.timers, newTimer] }
                        : n
                    ),
                  }
                : p
            ),
          }));
        },

        updateTimer: (pkgId, nodeId, timerId, patch) => {
          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) =>
              p.id === pkgId
                ? {
                    ...p,
                    nodes: p.nodes.map((n) =>
                      n.id === nodeId
                        ? {
                            ...n,
                            timers: n.timers.map((t) =>
                              t.id === timerId ? { ...t, ...patch } : t
                            ),
                          }
                        : n
                    ),
                  }
                : p
            ),
          }));
        },

        deleteTimer: (pkgId, nodeId, timerId) => {
          get().mutateProject((prev) => ({
            ...prev,
            packages: prev.packages.map((p) =>
              p.id === pkgId
                ? {
                    ...p,
                    nodes: p.nodes.map((n) =>
                      n.id === nodeId
                        ? {
                            ...n,
                            timers: n.timers.filter((t) => t.id !== timerId),
                          }
                        : n
                    ),
                  }
                : p
            ),
          }));
        },

        setPositions: (updates) => {
          get().mutateProject((prev) => ({
            ...prev,
            canvas: {
              ...prev.canvas,
              positions: { ...prev.canvas.positions, ...updates },
            },
          }));
        },

        setViewport: (viewport) => {
          const current = get().project;
          if (!current) return;
          set({
            project: {
              ...current,
              canvas: { ...current.canvas, viewport },
            },
          });
        },

        duplicateIds: (ids) => {
          const idSet = new Set(ids);
          if (idSet.size === 0) return;
          get().mutateProject((prev) => {
            const nextPositions = { ...prev.canvas.positions };
            const addedChannels: RosChannel[] = [];
            for (const ch of prev.channels) {
              if (!idSet.has(ch.id)) continue;
              const newId = generateClientId();
              addedChannels.push({
                ...ch,
                id: newId,
                name: `${ch.name}_copy`,
              });
              const oldPos = prev.canvas.positions[ch.id] ?? { x: 400, y: 120 };
              nextPositions[newId] = {
                x: (oldPos.x ?? 0) + 32,
                y: (oldPos.y ?? 0) + 32,
              };
            }

            const nextPackages = prev.packages.map((pkg) => {
              const addedNodes: RosNode[] = [];
              for (const node of pkg.nodes) {
                if (!idSet.has(node.id)) continue;
                const newId = generateClientId();
                const copyName = `${node.name}_copy`;
                addedNodes.push({
                  ...node,
                  id: newId,
                  name: copyName,
                  executable: `${node.executable}_copy`,
                  className: `${node.className}Copy`,
                  ports: node.ports.map((pt) => ({
                    ...pt,
                    id: generateClientId(),
                  })),
                  params: node.params.map((pr) => ({
                    ...pr,
                    id: generateClientId(),
                  })),
                  timers: node.timers.map((t) => ({
                    ...t,
                    id: generateClientId(),
                  })),
                });
                const oldPos = prev.canvas.positions[node.id] ?? { x: 24, y: 60 };
                nextPositions[newId] = {
                  x: (oldPos.x ?? 0) + 32,
                  y: (oldPos.y ?? 0) + 32,
                };
              }
              return addedNodes.length > 0
                ? { ...pkg, nodes: [...pkg.nodes, ...addedNodes] }
                : pkg;
            });

            return {
              ...prev,
              packages: nextPackages,
              channels: [...prev.channels, ...addedChannels],
              canvas: { ...prev.canvas, positions: nextPositions },
            };
          });
        },

        deleteIds: (ids) => {
          const idSet = new Set(ids);
          if (idSet.size === 0) return;
          get().mutateProject((prev) => {
            const nextPositions = { ...prev.canvas.positions };
            const deletedChannels = new Set(
              prev.channels.filter((c) => idSet.has(c.id)).map((c) => c.id)
            );
            idSet.forEach((id) => delete nextPositions[id]);

            const nextPackages = prev.packages
              .filter((p) => {
                if (idSet.has(p.id)) {
                  p.nodes.forEach((n) => delete nextPositions[n.id]);
                  return false;
                }
                return true;
              })
              .map((p) => ({
                ...p,
                nodes: p.nodes
                  .filter((n) => !idSet.has(n.id))
                  .map((n) => ({
                    ...n,
                    ports: n.ports.filter(
                      (pt) => !deletedChannels.has(pt.channelId) && !idSet.has(pt.id)
                    ),
                  })),
                launchFiles: p.launchFiles.map((lf) => ({
                  ...lf,
                  entries: lf.entries.filter((e) => !idSet.has(e.nodeId)),
                })),
              }));

            return {
              ...prev,
              packages: nextPackages,
              channels: prev.channels.filter((c) => !idSet.has(c.id)),
              canvas: { ...prev.canvas, positions: nextPositions },
            };
          });
          set({ selected: null });
        },

        openGeneratePreview: async () => {
          const { project } = get();
          if (!project) return;
          try {
            const preview = await commands.previewGenerate(project);
            set({
              generatePreview: preview,
              diagnostics: preview.diagnostics,
              generateModalOpen: true,
            });
          } catch (err) {
            get().appendLog("error", `Generate preview failed: ${formatErr(err)}`);
          }
        },

        applyGenerate: async (resolutions) => {
          const { project } = get();
          if (!project) return null;
          set({ generating: true });
          try {
            const result = await commands.applyGenerate(project, resolutions);
            set({
              project: result.project,
              dirty: false,
              lastSavedAt: Date.now(),
              generating: false,
              generateModalOpen: false,
              generatePreview: null,
            });
            get().appendLog(
              "info",
              `Generated ${result.writtenFiles.length} file(s)` +
                (result.skippedFiles.length > 0
                  ? `, skipped ${result.skippedFiles.length}`
                  : "") +
                (result.convertedNodeIds.length > 0
                  ? `, converted ${result.convertedNodeIds.length} node(s) to handwritten`
                  : "")
            );
            await get().runValidation();
            return result;
          } catch (err) {
            set({ generating: false });
            get().appendLog("error", `Code generation failed: ${formatErr(err)}`);
            return null;
          }
        },
      };
    },
    {
      partialize: (state) => ({ project: state.project }),
      limit: 60,
      equality: (a, b) => a.project === b.project,
    }
  )
);
