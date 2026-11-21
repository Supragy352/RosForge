const KNOWN_PACKAGE_COLORS: Record<string, string> = {
  std_msgs: "#38bdf8",
  geometry_msgs: "#a78bfa",
  sensor_msgs: "#34d399",
  nav_msgs: "#fb923c",
  std_srvs: "#f472b6",
  example_interfaces: "#fbbf24",
  action_tutorials_interfaces: "#2dd4bf",
};

/**
 * Returns a stable hex/hsl accent color per ROS interface package (F1.9).
 * Edges and channel pills share this color so fan-in/fan-out is visually clear.
 */
export function channelColorForType(interfaceType: string): string {
  const pkg = interfaceType.split("/")[0]?.trim() || "";
  if (!pkg) return "#94a3b8";
  if (KNOWN_PACKAGE_COLORS[pkg]) {
    return KNOWN_PACKAGE_COLORS[pkg];
  }
  let hash = 0;
  for (let i = 0; i < pkg.length; i++) {
    hash = (hash * 31 + pkg.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 72%, 60%)`;
}

export function channelKindLabel(kind: "topic" | "service" | "action"): string {
  switch (kind) {
    case "topic":
      return "TOPIC";
    case "service":
      return "SRV";
    case "action":
      return "ACT";
  }
}
