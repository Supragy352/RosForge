#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "tracker", "items.json");
const HTML_PATH = path.join(ROOT, "tracker", "index.html");

const VALID_KINDS = new Set(["feature", "bug", "issue"]);
const VALID_STATUSES = new Set(["backlog", "todo", "doing", "done"]);
const VALID_PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const VALID_MILESTONES = new Set(["M0", "M1", "M2", "M3", "M4", "M5", "M6", "—"]);
const PRIO_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

function readStore() {
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  return JSON.parse(raw);
}

function writeStore(store) {
  const tmp = `${DATA_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, DATA_PATH);
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq === -1) {
        flags[arg.slice(2)] = true;
      } else {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const pr = (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9);
    if (pr !== 0) return pr;
    const ord = (a.order ?? 9999) - (b.order ?? 9999);
    if (ord !== 0) return ord;
    return String(a.title).localeCompare(String(b.title));
  });
}

function bar(done, total, width = 20) {
  const filled = total ? Math.round((done / total) * width) : 0;
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function cmdSummary() {
  const store = readStore();
  const items = store.items;
  const specFeatures = items.filter((i) => i.kind === "feature" && i.spec);
  const doneCount = specFeatures.filter((i) => i.status === "done").length;
  const doing = sortItems(items.filter((i) => i.status === "doing"));
  const todo = sortItems(items.filter((i) => i.status === "todo"));
  const openBugs = items.filter((i) => i.kind === "bug" && i.status !== "done");
  const openIssues = items.filter((i) => i.kind === "issue" && i.status !== "done");

  const pct = specFeatures.length ? Math.round((doneCount / specFeatures.length) * 100) : 0;
  console.log(`\nRosForge Tracker — ${doneCount}/${specFeatures.length} spec features done (${pct}%)`);
  console.log(
    `In progress: ${doing.length} (WIP limit ${store.wipLimit ?? 5}) | Open bugs: ${openBugs.length} | Open issues: ${openIssues.length}\n`
  );

  let markedCurrent = false;
  for (const ms of ["M0", "M1", "M2", "M3", "M4", "M5", "M6", "—"]) {
    const msItems = items.filter((i) => i.milestone === ms);
    if (ms === "—" && msItems.length === 0) continue;
    const msDone = msItems.filter((i) => i.status === "done").length;
    const msPct = msItems.length ? Math.round((msDone / msItems.length) * 100) : 0;
    const isCurrent = !markedCurrent && ms !== "—" && msDone < msItems.length;
    if (isCurrent) markedCurrent = true;
    const tag = isCurrent ? "  <-- current" : "";
    console.log(
      `  ${ms.padEnd(2)} ${bar(msDone, msItems.length)} ${String(msDone).padStart(2)}/${String(msItems.length).padEnd(2)} (${String(msPct).padStart(3)}%)${tag}`
    );
  }

  if (doing.length > 0) {
    console.log("\nIn progress:");
    for (const item of doing) {
      console.log(`  [${item.priority}] ${(item.spec || item.id).padEnd(6)} ${item.title}`);
    }
  }

  console.log("\nUp next (top 6 To do):");
  for (const item of todo.slice(0, 6)) {
    console.log(`  [${item.priority}] ${(item.spec || item.id).padEnd(6)} (${item.milestone}) ${item.title}`);
  }
  console.log("");
}

function cmdList(flags) {
  const store = readStore();
  let items = store.items;
  if (flags.status) items = items.filter((i) => i.status === flags.status);
  if (flags.milestone) items = items.filter((i) => i.milestone === flags.milestone);
  if (flags.kind) items = items.filter((i) => i.kind === flags.kind);
  if (flags.priority) items = items.filter((i) => i.priority === flags.priority);

  items = sortItems(items);
  for (const item of items) {
    const id = (item.spec || item.id).padEnd(6);
    console.log(
      `${id} [${item.status.padEnd(7)}] [${item.priority}] [${item.milestone.padEnd(2)}] (${item.kind.padEnd(7)}) ${item.title}`
    );
  }
  console.log(`\nTotal: ${items.length}`);
}

function cmdSet(positional, flags) {
  const targetId = positional[0];
  if (!targetId) {
    console.error("Usage: tracker set <id> [--status=...] [--priority=...] [--milestone=...] [--note=...] [--title=...]");
    process.exit(1);
  }
  const store = readStore();
  const item = store.items.find((i) => i.id === targetId || i.spec === targetId);
  if (!item) {
    console.error(`Item not found: ${targetId}`);
    process.exit(1);
  }

  if (flags.status !== undefined) {
    if (!VALID_STATUSES.has(flags.status)) throw new Error(`Invalid status: ${flags.status}`);
    item.status = flags.status;
  }
  if (flags.priority !== undefined) {
    if (!VALID_PRIORITIES.has(flags.priority)) throw new Error(`Invalid priority: ${flags.priority}`);
    item.priority = flags.priority;
  }
  if (flags.milestone !== undefined) {
    if (!VALID_MILESTONES.has(flags.milestone)) throw new Error(`Invalid milestone: ${flags.milestone}`);
    item.milestone = flags.milestone;
  }
  if (flags.kind !== undefined) {
    if (!VALID_KINDS.has(flags.kind)) throw new Error(`Invalid kind: ${flags.kind}`);
    item.kind = flags.kind;
  }
  if (flags.title !== undefined) item.title = String(flags.title).slice(0, 200);
  if (flags.note !== undefined) item.note = String(flags.note).slice(0, 2000);
  item.updatedAt = Date.now();

  writeStore(store);
  console.log(`Updated ${item.id}: status=${item.status}, priority=${item.priority}, milestone=${item.milestone}`);
}

function cmdAdd(flags) {
  if (!flags.title) {
    console.error('Usage: tracker add --title="..." [--kind=bug|issue|feature] [--milestone=M1] [--priority=P1] [--status=todo] [--spec=...] [--note=...]');
    process.exit(1);
  }
  const kind = flags.kind || "issue";
  const milestone = flags.milestone || "M1";
  const priority = flags.priority || "P1";
  const status = flags.status || "todo";

  if (!VALID_KINDS.has(kind)) throw new Error(`Invalid kind: ${kind}`);
  if (!VALID_MILESTONES.has(milestone)) throw new Error(`Invalid milestone: ${milestone}`);
  if (!VALID_PRIORITIES.has(priority)) throw new Error(`Invalid priority: ${priority}`);
  if (!VALID_STATUSES.has(status)) throw new Error(`Invalid status: ${status}`);

  const store = readStore();
  const now = Date.now();
  const spec = String(flags.spec || "").slice(0, 20);
  const id = spec && !store.items.some((i) => i.id === spec) ? spec : `item-${now.toString(36)}`;

  const entry = {
    id,
    title: String(flags.title).slice(0, 200),
    kind,
    milestone,
    spec,
    status,
    priority,
    order: flags.order ? Number.parseInt(flags.order, 10) : store.items.length + 1,
    note: String(flags.note || "").slice(0, 2000),
    createdAt: now,
    updatedAt: now,
  };

  store.items.push(entry);
  writeStore(store);
  console.log(`Added ${entry.id}: ${entry.title}`);
}

function cmdDelete(positional) {
  const targetId = positional[0];
  if (!targetId) {
    console.error("Usage: tracker delete <id>");
    process.exit(1);
  }
  const store = readStore();
  const before = store.items.length;
  store.items = store.items.filter((i) => i.id !== targetId);
  if (store.items.length === before) {
    console.error(`Item not found: ${targetId}`);
    process.exit(1);
  }
  writeStore(store);
  console.log(`Deleted ${targetId}`);
}

function cmdServe(flags) {
  const port = Number.parseInt(flags.port || "4175", 10);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(HTML_PATH));
      return;
    }

    if (url.pathname === "/items.json" || (url.pathname === "/api/items" && req.method === "GET")) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(fs.readFileSync(DATA_PATH));
      return;
    }

    if (url.pathname === "/api/items" && req.method === "PUT") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 5 * 1024 * 1024) req.destroy();
      });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (!Array.isArray(parsed.items)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing items array" }));
            return;
          }
          writeStore(parsed);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, count: parsed.items.length }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err.message || err) }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`RosForge Tracker running at http://127.0.0.1:${port}`);
    console.log(`Persisting directly to ${DATA_PATH}`);
  });
}

const [, , cmd = "summary", ...rest] = process.argv;
const { flags, positional } = parseFlags(rest);

switch (cmd) {
  case "summary":
    cmdSummary();
    break;
  case "list":
    cmdList(flags);
    break;
  case "set":
    cmdSet(positional, flags);
    break;
  case "add":
    cmdAdd(flags);
    break;
  case "delete":
    cmdDelete(positional);
    break;
  case "serve":
    cmdServe(flags);
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    console.error("Commands: summary | list | set | add | delete | serve");
    process.exit(1);
}
