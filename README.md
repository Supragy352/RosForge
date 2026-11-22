# RosForge

**RosForge** is a local-first desktop node-graph IDE for **ROS 2 Jazzy** (Tauri 2 + React 18 + TypeScript + Rust). Design packages, nodes, topics, services, actions, parameters, timers, QoS profiles, and launch files visually—then generate clean, idiomatic `ament_python` and `ament_cmake` (C++) packages while preserving your hand-written callback logic across regenerations.

> **Current Status:** Milestones **M0 (Scaffolding)** and **M1 (Draw Graph → Generate)** are complete (34/64 spec features). Next up: **M2 (Build & Run)**.

---

## Key Capabilities (Implemented)

- **Visual ROS 2 Graph Canvas** — Sub-flow package frames, ROS node cards (`PY` / `C++`), color-coded topic/service/action pills, drag-to-wire connections, drop-on-empty-canvas topic creation, double-click quick-add, ELK auto-layout, Minimap, and `Ctrl+F` search.
- **Full Inspector & Interface Catalog** — Edit package metadata, launch files, node parameters (typed + validated), timers (`ms` / `Hz`), QoS presets/custom profiles, and browse live `ros2 interface` types with offline caching.
- **Live Validation** — Instant ROS 2 naming checks, duplicate detection, interface & parameter type checks (errors block generation), plus orphan channel, multi-server, and QoS mismatch warnings.
- **Deterministic Code Generation & Protected Regions** — Generates buildable `ament_python` and `-Wall -Wextra -Wpedantic`-clean `ament_cmake` C++ packages with unified diff preview and `# >>> rosforge:user <id>` / `// >>> rosforge:user <id>` blocks that preserve your code across renames and regenerations.

---

## Documentation

Browse the live documentation site at **[https://Supragy352.github.io/RosForge/](https://Supragy352.github.io/RosForge/)** or run it locally with `pnpm docs:dev`.

| Guide | Live Site | Local Source | What You'll Learn |
| --- | --- | --- | --- |
| **Docs Home** | [Home](https://Supragy352.github.io/RosForge/) | [`docs/src/content/docs/index.mdx`](docs/src/content/docs/index.mdx) | Documentation overview and workspace layout |
| **Getting Started** | [Getting Started](https://Supragy352.github.io/RosForge/guides/getting-started/) | [`docs/src/content/docs/guides/getting-started.md`](docs/src/content/docs/guides/getting-started.md) | Prerequisites, Ubuntu 24.04 / WSL2 + WSLg setup, launching RosForge, and ROS 2 health checks |
| **Feature Walkthrough** | [Feature Walkthrough](https://Supragy352.github.io/RosForge/guides/features/) | [`docs/src/content/docs/guides/features.md`](docs/src/content/docs/guides/features.md) | Complete tour of the IDE panels, canvas interactions, validation, codegen, protected regions, and shortcuts |
| **Tutorial: Simple Pub-Sub Example** | [Pub-Sub Tutorial](https://Supragy352.github.io/RosForge/tutorials/pubsub/) | [`docs/src/content/docs/tutorials/pubsub.md`](docs/src/content/docs/tutorials/pubsub.md) | Hands-on guide to building, generating, implementing, building with `colcon`, and running a Python → C++ `/chatter` pub-sub graph |
| **Specification (`SPEC.md`)** | [SPEC.md](https://github.com/Supragy352/RosForge/blob/main/SPEC.md) | [`SPEC.md`](SPEC.md) | Full product & technical architecture specification (M0–M6) |

---

## Quick Start

### 1. Run RosForge (Ubuntu 24.04 or WSL2 with WSLg)

```bash
# Inside Ubuntu 24.04 (or WSL2 distro with ROS 2 Jazzy)
source /opt/ros/jazzy/setup.bash
pnpm install
pnpm tauri dev
```

On Windows with the project's WSL2 distro (`RosForge-Ubuntu-24.04`):

```powershell
# Fast prebuilt launch (~1-2s; pass -Rebuild after code changes)
.\scripts\run-fast.ps1

# Or live HMR dev server
wsl -d RosForge-Ubuntu-24.04 -- bash -lc 'cd /mnt/e/Dev/Robotics/RosForge && export CARGO_TARGET_DIR="$HOME/.cache/rosforge-target" && pnpm tauri dev'
```

### 2. Run Tests

```bash
# Rust backend tests (includes live `colcon build` verification under ROS 2 Jazzy)
export CARGO_TARGET_DIR="$HOME/.cache/rosforge-target"
cargo test --manifest-path src-tauri/Cargo.toml

# Frontend TypeScript check & production bundle
pnpm build

# Frontend store unit tests
pnpm vitest run --environment=node src/store/useProjectStore.test.ts
```

---

## Architecture at a Glance

- **Rust Backend (`src-tauri/src/`)** owns the canonical project model (`.rosforge.json`), validation, ROS 2 environment/interface discovery, and deterministic `minijinja` code generation.
- **TypeScript IPC (`src/bindings.ts`)** is auto-generated from Rust types via `tauri-specta`—never hand-edited.
- **React Frontend (`src/`)** renders the `@xyflow/react` v12 canvas, Zustand + `zundo` undo/redo store, inspector panels, and codegen diff modal.
