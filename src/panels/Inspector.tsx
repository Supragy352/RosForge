import { useMemo, useState } from "react";
import {
  Clock,
  Plus,
  RefreshCw,
  Search,
  Sliders,
  Trash2,
} from "lucide-react";
import type {
  CustomQos,
  LaunchFile,
  Package,
  PackageLang,
  Param,
  ParamType,
  ParamValue,
  Port,
  QosDurability,
  QosHistory,
  QosPreset,
  QosReliability,
  RosChannel,
  RosNode,
} from "../bindings";
import {
  defaultParamValueForType,
  generateClientId,
  toPascalCase,
  useProjectStore,
} from "../store/useProjectStore";

const LICENSES = [
  "Apache-2.0",
  "MIT",
  "BSD-3-Clause",
  "GPL-3.0-only",
  "LGPL-3.0-only",
  "Proprietary",
];

const PARAM_TYPES: ParamType[] = [
  "string",
  "int",
  "double",
  "bool",
  "string_array",
  "int_array",
  "double_array",
  "bool_array",
];

function formatParamValue(val: ParamValue): string {
  switch (val.kind) {
    case "bool":
      return val.value ? "true" : "false";
    case "int":
      return String(val.value);
    case "double":
      return String(val.value ?? 0);
    case "string":
      return val.value;
    case "bool_array":
      return val.value.map((b) => (b ? "true" : "false")).join(", ");
    case "int_array":
      return val.value.join(", ");
    case "double_array":
      return val.value.map((d) => String(d ?? 0)).join(", ");
    case "string_array":
      return val.value.join(", ");
  }
}

function parseParamValue(
  paramType: ParamType,
  raw: string
): { ok: true; value: ParamValue } | { ok: false; error: string } {
  const trimmed = raw.trim();
  switch (paramType) {
    case "string":
      return { ok: true, value: { kind: "string", value: raw } };
    case "bool":
      if (trimmed === "true" || trimmed === "false") {
        return { ok: true, value: { kind: "bool", value: trimmed === "true" } };
      }
      return { ok: false, error: "Expected true or false" };
    case "int": {
      if (!/^-?\d+$/.test(trimmed)) return { ok: false, error: "Expected integer" };
      return { ok: true, value: { kind: "int", value: Number.parseInt(trimmed, 10) } };
    }
    case "double": {
      const n = Number(trimmed);
      if (trimmed === "" || Number.isNaN(n)) return { ok: false, error: "Expected number" };
      return { ok: true, value: { kind: "double", value: n } };
    }
    case "bool_array": {
      if (!trimmed) return { ok: true, value: { kind: "bool_array", value: [] } };
      const parts = trimmed.split(",").map((s) => s.trim());
      if (parts.some((p) => p !== "true" && p !== "false")) {
        return { ok: false, error: "Comma-separated true/false" };
      }
      return {
        ok: true,
        value: { kind: "bool_array", value: parts.map((p) => p === "true") },
      };
    }
    case "int_array": {
      if (!trimmed) return { ok: true, value: { kind: "int_array", value: [] } };
      const parts = trimmed.split(",").map((s) => s.trim());
      if (parts.some((p) => !/^-?\d+$/.test(p))) {
        return { ok: false, error: "Comma-separated integers" };
      }
      return {
        ok: true,
        value: { kind: "int_array", value: parts.map((p) => Number.parseInt(p, 10)) },
      };
    }
    case "double_array": {
      if (!trimmed) return { ok: true, value: { kind: "double_array", value: [] } };
      const parts = trimmed.split(",").map((s) => s.trim());
      const nums = parts.map((p) => Number(p));
      if (nums.some((n) => Number.isNaN(n))) {
        return { ok: false, error: "Comma-separated numbers" };
      }
      return { ok: true, value: { kind: "double_array", value: nums } };
    }
    case "string_array": {
      if (!trimmed) return { ok: true, value: { kind: "string_array", value: [] } };
      return {
        ok: true,
        value: {
          kind: "string_array",
          value: trimmed.split(",").map((s) => s.trim()),
        },
      };
    }
  }
}

function PackageInspector({ pkg }: { pkg: Package }) {
  const project = useProjectStore((s) => s.project);
  const updatePackage = useProjectStore((s) => s.updatePackage);
  const deletePackage = useProjectStore((s) => s.deletePackage);
  const updateLaunchFile = useProjectStore((s) => s.updateLaunchFile);
  const [tab, setTab] = useState<"props" | "launch">("props");

  const hasGeneratedFiles = useMemo(() => {
    const hashes = project?.generatedFileHashes ?? {};
    return Object.keys(hashes).some((p) => p.startsWith(`src/${pkg.name}/`));
  }, [project?.generatedFileHashes, pkg.name]);

  const activeLaunch: LaunchFile = pkg.launchFiles[0] ?? {
    id: generateClientId(),
    name: `${pkg.name}.launch.py`,
    entries: pkg.nodes.map((n) => ({
      nodeId: n.id,
      nameOverride: null,
      namespace: null,
      remaps: [],
      paramOverrides: {},
    })),
  };

  const handleLangChange = (nextLang: PackageLang) => {
    if (nextLang === pkg.lang) return;
    if (hasGeneratedFiles) {
      const ok = window.confirm(
        `Package '${pkg.name}' has already been generated. Switch language to '${nextLang}' anyway? Existing generated files on disk may need cleanup.`
      );
      if (!ok) return;
    }
    updatePackage(pkg.id, { lang: nextLang });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-[11px] dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTab("props")}
            className={`rounded px-2.5 py-1 font-medium ${
              tab === "props"
                ? "bg-sky-500 text-slate-950"
                : "text-slate-500 hover:text-slate-200"
            }`}
          >
            Package
          </button>
          <button
            type="button"
            onClick={() => setTab("launch")}
            className={`rounded px-2.5 py-1 font-medium ${
              tab === "launch"
                ? "bg-sky-500 text-slate-950"
                : "text-slate-500 hover:text-slate-200"
            }`}
          >
            Launch
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Delete package '${pkg.name}' and its nodes?`)) {
              deletePackage(pkg.id);
            }
          }}
          title="Delete package"
          className="rounded p-1 text-rose-400 hover:bg-rose-500/15"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {tab === "props" ? (
        <div className="space-y-3">
          <Field label="Package Name">
            <input
              type="text"
              value={pkg.name}
              onChange={(e) => updatePackage(pkg.id, { name: e.target.value })}
              className="inspector-input font-mono"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Build Type">
              <select
                value={pkg.lang}
                onChange={(e) => handleLangChange(e.target.value as PackageLang)}
                className="inspector-input"
              >
                <option value="python">Python (ament_python)</option>
                <option value="cpp">C++ (ament_cmake)</option>
              </select>
            </Field>
            <Field label="Version">
              <input
                type="text"
                value={pkg.version}
                onChange={(e) => updatePackage(pkg.id, { version: e.target.value })}
                className="inspector-input font-mono"
              />
            </Field>
          </div>

          <Field label="Description">
            <textarea
              rows={2}
              value={pkg.description}
              onChange={(e) => updatePackage(pkg.id, { description: e.target.value })}
              className="inspector-input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Maintainer Name">
              <input
                type="text"
                value={pkg.maintainer.name}
                onChange={(e) =>
                  updatePackage(pkg.id, {
                    maintainer: { ...pkg.maintainer, name: e.target.value },
                  })
                }
                className="inspector-input"
              />
            </Field>
            <Field label="Maintainer Email">
              <input
                type="email"
                value={pkg.maintainer.email}
                onChange={(e) =>
                  updatePackage(pkg.id, {
                    maintainer: { ...pkg.maintainer, email: e.target.value },
                  })
                }
                className="inspector-input"
              />
            </Field>
          </div>

          <Field label="License">
            <select
              value={pkg.license}
              onChange={(e) => updatePackage(pkg.id, { license: e.target.value })}
              className="inspector-input"
            >
              {LICENSES.map((lic) => (
                <option key={lic} value={lic}>
                  {lic}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Extra Dependencies (comma-separated)">
            <input
              type="text"
              value={pkg.extraDeps.join(", ")}
              onChange={(e) =>
                updatePackage(pkg.id, {
                  extraDeps: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="tf2_ros, cv_bridge"
              className="inspector-input font-mono"
            />
          </Field>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Launch File Name">
            <input
              type="text"
              value={activeLaunch.name}
              onChange={(e) =>
                updateLaunchFile(pkg.id, { ...activeLaunch, name: e.target.value })
              }
              className="inspector-input font-mono"
            />
          </Field>

          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Launch Entries ({pkg.nodes.length} nodes)
            </div>
            {pkg.nodes.map((node) => {
              const entry = activeLaunch.entries.find((e) => e.nodeId === node.id) ?? {
                nodeId: node.id,
                nameOverride: null,
                namespace: null,
                remaps: [],
                paramOverrides: {},
              };

              const saveEntry = (nextEntry: typeof entry) => {
                const exists = activeLaunch.entries.some((e) => e.nodeId === node.id);
                const entries = exists
                  ? activeLaunch.entries.map((e) =>
                      e.nodeId === node.id ? nextEntry : e
                    )
                  : [...activeLaunch.entries, nextEntry];
                updateLaunchFile(pkg.id, { ...activeLaunch, entries });
              };

              const remaps = entry.remaps ?? [];

              return (
                <div
                  key={node.id}
                  className="space-y-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800"
                >
                  <div className="font-mono text-xs font-bold text-sky-400">
                    {node.name}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Name Override">
                      <input
                        type="text"
                        value={entry.nameOverride ?? ""}
                        onChange={(e) =>
                          saveEntry({
                            ...entry,
                            nameOverride: e.target.value.trim() || null,
                          })
                        }
                        placeholder={node.name}
                        className="inspector-input font-mono"
                      />
                    </Field>
                    <Field label="Namespace">
                      <input
                        type="text"
                        value={entry.namespace ?? ""}
                        onChange={(e) =>
                          saveEntry({
                            ...entry,
                            namespace: e.target.value.trim() || null,
                          })
                        }
                        placeholder="/"
                        className="inspector-input font-mono"
                      />
                    </Field>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase text-slate-500">
                        Remappings
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          saveEntry({
                            ...entry,
                            remaps: [...remaps, ["/from", "/to"]],
                          })
                        }
                        className="inline-flex items-center gap-0.5 text-[10px] text-sky-400 hover:underline"
                      >
                        <Plus className="h-3 w-3" /> Add
                      </button>
                    </div>
                    {remaps.map(([from, to], rIdx) => (
                      <div key={rIdx} className="mb-1 flex items-center gap-1">
                        <input
                          type="text"
                          value={from}
                          onChange={(e) => {
                            const next = remaps.map((r, i) =>
                              i === rIdx ? ([e.target.value, r[1]] as [string, string]) : r
                            );
                            saveEntry({ ...entry, remaps: next });
                          }}
                          className="inspector-input w-1/2 font-mono text-[11px]"
                        />
                        <span className="text-slate-500">→</span>
                        <input
                          type="text"
                          value={to}
                          onChange={(e) => {
                            const next = remaps.map((r, i) =>
                              i === rIdx ? ([r[0], e.target.value] as [string, string]) : r
                            );
                            saveEntry({ ...entry, remaps: next });
                          }}
                          className="inspector-input w-1/2 font-mono text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            saveEntry({
                              ...entry,
                              remaps: remaps.filter((_, i) => i !== rIdx),
                            })
                          }
                          className="text-rose-400 hover:text-rose-300"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function PortRowEditor({
  pkgId,
  nodeId,
  port,
  channelName,
}: {
  pkgId: string;
  nodeId: string;
  port: Port;
  channelName: string;
}) {
  const updatePort = useProjectStore((s) => s.updatePort);
  const deletePort = useProjectStore((s) => s.deletePort);
  const [expanded, setExpanded] = useState(false);

  const presetValue = port.qos.preset;
  const customQos: CustomQos =
    port.qos.preset === "custom"
      ? port.qos
      : {
          depth: 10,
          reliability: "reliable",
          durability: "volatile",
          history: "keep_last",
        };

  const setPreset = (next: string) => {
    let qos: QosPreset;
    if (next === "custom") {
      qos = { preset: "custom", ...customQos };
    } else {
      qos = { preset: next as "default" | "sensor_data" | "services_default" | "system_default" };
    }
    updatePort(pkgId, nodeId, port.id, { qos });
  };

  return (
    <div className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-800">
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[9px] uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            {port.kind}
          </span>
          <span className="truncate font-mono text-[11px]">{channelName}</span>
        </button>
        <button
          type="button"
          onClick={() => deletePort(pkgId, nodeId, port.id)}
          className="rounded p-0.5 text-rose-400 hover:bg-rose-500/15"
          title="Delete port"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 dark:border-slate-800">
          <Field label="QoS Preset">
            <select
              value={presetValue}
              onChange={(e) => setPreset(e.target.value)}
              className="inspector-input text-[11px]"
            >
              <option value="default">default (Reliable, depth 10)</option>
              <option value="sensor_data">sensor_data (Best Effort)</option>
              <option value="services_default">services_default</option>
              <option value="system_default">system_default</option>
              <option value="custom">custom…</option>
            </select>
          </Field>

          {port.qos.preset === "custom" && (
            <div className="grid grid-cols-2 gap-1.5">
              <Field label="Depth">
                <input
                  type="number"
                  min={1}
                  value={customQos.depth}
                  onChange={(e) =>
                    updatePort(pkgId, nodeId, port.id, {
                      qos: {
                        preset: "custom",
                        ...customQos,
                        depth: Math.max(1, Number.parseInt(e.target.value || "1", 10)),
                      },
                    })
                  }
                  className="inspector-input font-mono text-[11px]"
                />
              </Field>
              <Field label="Reliability">
                <select
                  value={customQos.reliability}
                  onChange={(e) =>
                    updatePort(pkgId, nodeId, port.id, {
                      qos: {
                        preset: "custom",
                        ...customQos,
                        reliability: e.target.value as QosReliability,
                      },
                    })
                  }
                  className="inspector-input text-[11px]"
                >
                  <option value="reliable">reliable</option>
                  <option value="best_effort">best_effort</option>
                  <option value="system_default">system_default</option>
                </select>
              </Field>
              <Field label="Durability">
                <select
                  value={customQos.durability}
                  onChange={(e) =>
                    updatePort(pkgId, nodeId, port.id, {
                      qos: {
                        preset: "custom",
                        ...customQos,
                        durability: e.target.value as QosDurability,
                      },
                    })
                  }
                  className="inspector-input text-[11px]"
                >
                  <option value="volatile">volatile</option>
                  <option value="transient_local">transient_local</option>
                  <option value="system_default">system_default</option>
                </select>
              </Field>
              <Field label="History">
                <select
                  value={customQos.history}
                  onChange={(e) =>
                    updatePort(pkgId, nodeId, port.id, {
                      qos: {
                        preset: "custom",
                        ...customQos,
                        history: e.target.value as QosHistory,
                      },
                    })
                  }
                  className="inspector-input text-[11px]"
                >
                  <option value="keep_last">keep_last</option>
                  <option value="keep_all">keep_all</option>
                  <option value="system_default">system_default</option>
                </select>
              </Field>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ParamRowEditor({
  pkgId,
  nodeId,
  param,
}: {
  pkgId: string;
  nodeId: string;
  param: Param;
}) {
  const updateParam = useProjectStore((s) => s.updateParam);
  const deleteParam = useProjectStore((s) => s.deleteParam);
  const [draft, setDraft] = useState(() => formatParamValue(param.default));
  const [parseErr, setParseErr] = useState<string | null>(null);

  return (
    <div className="space-y-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={param.name}
          onChange={(e) =>
            updateParam(pkgId, nodeId, param.id, { name: e.target.value })
          }
          placeholder="param_name"
          className="inspector-input flex-1 font-mono text-[11px]"
        />
        <select
          value={param.type}
          onChange={(e) => {
            const nextType = e.target.value as ParamType;
            const nextVal = defaultParamValueForType(nextType);
            setDraft(formatParamValue(nextVal));
            setParseErr(null);
            updateParam(pkgId, nodeId, param.id, {
              type: nextType,
              default: nextVal,
            });
          }}
          className="inspector-input w-28 text-[11px]"
        >
          {PARAM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => deleteParam(pkgId, nodeId, param.id)}
          className="rounded p-1 text-rose-400 hover:bg-rose-500/15"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {param.type === "bool" ? (
        <label className="flex items-center gap-2 text-[11px]">
          <input
            type="checkbox"
            checked={param.default.kind === "bool" && param.default.value}
            onChange={(e) => {
              setDraft(e.target.checked ? "true" : "false");
              updateParam(pkgId, nodeId, param.id, {
                default: { kind: "bool", value: e.target.checked },
              });
            }}
          />
          Default: {param.default.kind === "bool" && param.default.value ? "true" : "false"}
        </label>
      ) : (
        <div>
          <input
            type="text"
            value={draft}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              const parsed = parseParamValue(param.type, raw);
              if (parsed.ok) {
                setParseErr(null);
                updateParam(pkgId, nodeId, param.id, { default: parsed.value });
              } else {
                setParseErr(parsed.error);
              }
            }}
            placeholder="Default value"
            className={`inspector-input font-mono text-[11px] ${
              parseErr ? "!border-rose-500" : ""
            }`}
          />
          {parseErr && <div className="mt-0.5 text-[10px] text-rose-400">{parseErr}</div>}
        </div>
      )}

      <input
        type="text"
        value={param.description}
        onChange={(e) =>
          updateParam(pkgId, nodeId, param.id, { description: e.target.value })
        }
        placeholder="Description (optional)"
        className="inspector-input text-[11px]"
      />
    </div>
  );
}

function NodeInspector({ pkgId, node }: { pkgId: string; node: RosNode }) {
  const project = useProjectStore((s) => s.project);
  const updateNode = useProjectStore((s) => s.updateNode);
  const deleteNode = useProjectStore((s) => s.deleteNode);
  const addParam = useProjectStore((s) => s.addParam);
  const addTimer = useProjectStore((s) => s.addTimer);
  const updateTimer = useProjectStore((s) => s.updateTimer);
  const deleteTimer = useProjectStore((s) => s.deleteTimer);
  const [timerUnit, setTimerUnit] = useState<"ms" | "hz">("ms");

  const channelsById = useMemo(
    () => new Map((project?.channels ?? []).map((c) => [c.id, c])),
    [project?.channels]
  );

  const handleNameChange = (nextName: string) => {
    const patch: Partial<RosNode> = { name: nextName };
    if (node.executable === node.name) {
      patch.executable = nextName;
    }
    if (node.className === toPascalCase(node.name)) {
      patch.className = toPascalCase(nextName);
    }
    updateNode(pkgId, node.id, patch);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
          ROS Node
        </span>
        <button
          type="button"
          onClick={() => deleteNode(pkgId, node.id)}
          className="rounded p-1 text-rose-400 hover:bg-rose-500/15"
          title="Delete node"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2.5">
        <Field label="Node Name">
          <input
            type="text"
            value={node.name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="inspector-input font-mono"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Executable">
            <input
              type="text"
              value={node.executable}
              onChange={(e) =>
                updateNode(pkgId, node.id, { executable: e.target.value })
              }
              className="inspector-input font-mono"
            />
          </Field>
          <Field label="Class Name">
            <input
              type="text"
              value={node.className}
              onChange={(e) =>
                updateNode(pkgId, node.id, { className: e.target.value })
              }
              className="inspector-input font-mono"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Namespace">
            <input
              type="text"
              value={node.namespace}
              onChange={(e) =>
                updateNode(pkgId, node.id, { namespace: e.target.value })
              }
              placeholder="/"
              className="inspector-input font-mono"
            />
          </Field>
          <Field label="Ownership">
            <div className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1.5 font-mono text-xs capitalize dark:border-slate-800 dark:bg-slate-950">
              {node.ownership}
            </div>
          </Field>
        </div>
      </div>

      {/* Ports (F1.15) */}
      <div className="space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Ports ({node.ports.length}) — click to edit QoS
        </div>
        {node.ports.length === 0 ? (
          <div className="text-[11px] text-slate-500">
            Drag handles on canvas to wire ports.
          </div>
        ) : (
          node.ports.map((pt) => (
            <PortRowEditor
              key={pt.id}
              pkgId={pkgId}
              nodeId={node.id}
              port={pt}
              channelName={channelsById.get(pt.channelId)?.name ?? "(missing)"}
            />
          ))
        )}
      </div>

      {/* Parameters (F1.16) */}
      <div className="space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <Sliders className="h-3 w-3" />
            Parameters ({node.params.length})
          </span>
          <button
            type="button"
            onClick={() => addParam(pkgId, node.id)}
            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-sky-400 hover:underline"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        {node.params.map((pr) => (
          <ParamRowEditor key={pr.id} pkgId={pkgId} nodeId={node.id} param={pr} />
        ))}
      </div>

      {/* Timers (F1.17) */}
      <div className="space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <Clock className="h-3 w-3" />
            Timers ({node.timers.length})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTimerUnit(timerUnit === "ms" ? "hz" : "ms")}
              className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[10px] dark:border-slate-700"
              title="Toggle ms / Hz"
            >
              {timerUnit}
            </button>
            <button
              type="button"
              onClick={() => addTimer(pkgId, node.id)}
              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-sky-400 hover:underline"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>
        </div>
        {node.timers.map((timer) => {
          const displayVal =
            timerUnit === "ms"
              ? timer.periodMs
              : Number((1000 / Math.max(1, timer.periodMs)).toFixed(2));
          return (
            <div
              key={timer.id}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-800"
            >
              <input
                type="text"
                value={timer.name}
                onChange={(e) =>
                  updateTimer(pkgId, node.id, timer.id, { name: e.target.value })
                }
                className="inspector-input flex-1 font-mono text-[11px]"
              />
              <input
                type="number"
                min={timerUnit === "ms" ? 1 : 0.01}
                step={timerUnit === "ms" ? 10 : 0.5}
                value={displayVal}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n) || n <= 0) return;
                  const periodMs =
                    timerUnit === "ms"
                      ? Math.max(1, Math.round(n))
                      : Math.max(1, Math.round(1000 / n));
                  updateTimer(pkgId, node.id, timer.id, { periodMs });
                }}
                className="inspector-input w-20 font-mono text-[11px]"
              />
              <span className="font-mono text-[10px] text-slate-500">{timerUnit}</span>
              <button
                type="button"
                onClick={() => deleteTimer(pkgId, node.id, timer.id)}
                className="rounded p-1 text-rose-400 hover:bg-rose-500/15"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChannelInspector({ channel }: { channel: RosChannel }) {
  const catalog = useProjectStore((s) => s.catalog);
  const loadingCatalog = useProjectStore((s) => s.loadingCatalog);
  const loadCatalog = useProjectStore((s) => s.loadCatalog);
  const updateChannel = useProjectStore((s) => s.updateChannel);
  const deleteChannel = useProjectStore((s) => s.deleteChannel);
  const [typeSearch, setTypeSearch] = useState("");

  const candidates = useMemo(() => {
    if (!catalog) return [];
    const list =
      channel.kind === "topic"
        ? catalog.messages
        : channel.kind === "service"
          ? catalog.services
          : catalog.actions;
    const q = typeSearch.trim().toLowerCase();
    if (!q) return list.slice(0, 60);
    const terms = q.split(/\s+/);
    return list
      .filter((t) => {
        const low = t.toLowerCase();
        return terms.every((term) => low.includes(term));
      })
      .slice(0, 60);
  }, [catalog, channel.kind, typeSearch]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
          {channel.kind} Channel
        </span>
        <button
          type="button"
          onClick={() => deleteChannel(channel.id)}
          className="rounded p-1 text-rose-400 hover:bg-rose-500/15"
          title="Delete channel"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <Field label="Channel Name">
        <input
          type="text"
          value={channel.name}
          onChange={(e) => updateChannel(channel.id, { name: e.target.value })}
          placeholder="/chatter"
          className="inspector-input font-mono"
        />
      </Field>

      <Field label="Interface Type">
        <input
          type="text"
          value={channel.type}
          onChange={(e) => updateChannel(channel.id, { type: e.target.value })}
          placeholder="std_msgs/msg/String"
          className="inspector-input font-mono"
        />
      </Field>

      {/* Fuzzy Interface Type Picker (F1.14, F1.18) */}
      <div className="space-y-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase text-slate-500">
            Interface Catalog {catalog ? `(${catalog.source})` : ""}
          </span>
          <button
            type="button"
            disabled={loadingCatalog}
            onClick={() => void loadCatalog(true)}
            className="inline-flex items-center gap-1 text-[10px] text-sky-400 hover:underline disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loadingCatalog ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        <div className="flex items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-950">
          <Search className="h-3 w-3 text-slate-400" />
          <input
            type="text"
            value={typeSearch}
            onChange={(e) => setTypeSearch(e.target.value)}
            placeholder={`Search ${channel.kind} types…`}
            className="flex-1 bg-transparent text-xs outline-none"
          />
        </div>

        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {candidates.length === 0 ? (
            <div className="py-2 text-center text-[11px] text-slate-500">
              {catalog ? "No matching types" : "Loading catalog…"}
            </div>
          ) : (
            candidates.map((iface) => (
              <button
                key={iface}
                type="button"
                onClick={() => updateChannel(channel.id, { type: iface })}
                className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-[11px] ${
                  channel.type === iface
                    ? "bg-sky-500/20 font-semibold text-sky-400"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {iface}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

export function Inspector() {
  const project = useProjectStore((s) => s.project);
  const selected = useProjectStore((s) => s.selected);

  const selectedPkg =
    selected?.kind === "package"
      ? project?.packages.find((p) => p.id === selected.id)
      : undefined;

  const selectedNodeInfo =
    selected?.kind === "node"
      ? (() => {
          const pkg = project?.packages.find((p) => p.id === selected.packageId);
          const node = pkg?.nodes.find((n) => n.id === selected.id);
          return pkg && node ? { pkgId: pkg.id, node } : undefined;
        })()
      : undefined;

  const selectedChannel =
    selected?.kind === "channel"
      ? project?.channels.find((c) => c.id === selected.id)
      : undefined;

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Inspector
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {selectedPkg ? (
          <PackageInspector pkg={selectedPkg} />
        ) : selectedNodeInfo ? (
          <NodeInspector
            pkgId={selectedNodeInfo.pkgId}
            node={selectedNodeInfo.node}
          />
        ) : selectedChannel ? (
          <ChannelInspector channel={selectedChannel} />
        ) : (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
            Select a package, node, or channel on the canvas to inspect and edit its
            properties.
          </div>
        )}
      </div>
    </aside>
  );
}
