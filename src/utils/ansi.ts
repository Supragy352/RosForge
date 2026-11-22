export interface AnsiSegment {
  text: string;
  className?: string;
}

const FG_COLOR_MAP: Record<number, string> = {
  30: "text-slate-500",
  31: "text-rose-400",
  32: "text-emerald-400",
  33: "text-amber-400",
  34: "text-sky-400",
  35: "text-fuchsia-400",
  36: "text-cyan-400",
  37: "text-slate-200",
  90: "text-slate-400",
  91: "text-rose-300",
  92: "text-emerald-300",
  93: "text-amber-300",
  94: "text-sky-300",
  95: "text-fuchsia-300",
  96: "text-cyan-300",
  97: "text-white",
};

/**
 * Parse ANSI SGR escape codes into styled text segments for safe React rendering.
 */
export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let colorClass = "";
  let bold = false;
  let dim = false;

  const buildClass = () => {
    const parts: string[] = [];
    if (colorClass) parts.push(colorClass);
    if (bold) parts.push("font-semibold");
    if (dim) parts.push("opacity-70");
    return parts.length > 0 ? parts.join(" ") : undefined;
  };

  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: input.slice(lastIndex, match.index),
        className: buildClass(),
      });
    }
    const rawCodes = match[1];
    const codes = rawCodes === "" ? [0] : rawCodes.split(";").map((c) => Number.parseInt(c, 10));
    for (const code of codes) {
      if (Number.isNaN(code) || code === 0) {
        colorClass = "";
        bold = false;
        dim = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 2) {
        dim = true;
      } else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 39) {
        colorClass = "";
      } else if (FG_COLOR_MAP[code]) {
        colorClass = FG_COLOR_MAP[code];
      }
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < input.length) {
    segments.push({
      text: input.slice(lastIndex),
      className: buildClass(),
    });
  }

  return segments.length > 0 ? segments : [{ text: input }];
}
