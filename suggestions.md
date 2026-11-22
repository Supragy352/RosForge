# RosForge — Architecture Re-Evaluation & Next-Step Suggestions

> **Handoff brief for the next agent.** Read [SPEC.md](./SPEC.md) first, then use this document to align priorities, avoid known WSL/Tauri pitfalls, and execute one milestone slice cleanly at a time.

---

## 1. Current Baseline (Verified on `main` @ `9d33f58`)

- **Done (`M0` + `M1`, 34/64 spec features + 7 bug fixes):**
  - Tauri 2 + React 18 + TypeScript + `@xyflow/react` v12 + Zustand (`zundo` undo/redo) + `tauri-specta` (`src/bindings.ts`) + Rust core (`src-tauri/src/`).
  - Workspace load/save/autosave (`.rosforge.json`), live validation (`validate.rs`), ROS 2 Jazzy interface catalog with offline fallback (`catalog.rs`), deterministic Python (`ament_python`) & C++ (`ament_cmake`) codegen (`codegen/`), protected user regions (`regions.rs`), non-region SHA-256 hand-edit detection, and unified diff preview (`GeneratePreviewModal.tsx`).
  - WSLg WebKitGTK 2.52 rendering fixes (`src-tauri/src/main.rs`), canvas selection/delete/4-way package frame bounds/non-flickering HTML edge labels (`ChannelEdge.tsx`), in-app Web Inspector (`F12` / `Ctrl+Shift+I` + Copy Debug Snapshot in `App.tsx`), and fast prebuilt WSL launcher (`scripts/run-fast.ps1`).
  - Starlight documentation site deployed via GitHub Actions (`.github/workflows/docs.yml`) and CI passing (`.github/workflows/ci.yml`).
  - All 29 Rust tests (including real `colcon build` on ROS 2 Jazzy) and 4 Vitest store/tracker tests pass.

- **Task Tracking (Vikunja MCP):**
  - The full roadmap (78 tasks: 41 done, 37 open) is synced to **Vikunja** under parent project **`RosForge` (`projectId: 3`)**, using the configured `vikunja` MCP server:
    - `#4` — `0. M0 & M1 — Foundation & MVP (Done)` *(41/41 done)*
    - `#5` — `1. M2 — Build & Run (+ M1 Polish)` *(10 open)*
    - `#6` — `2. M6 — Live Introspection & Overlay` *(7 open)*
    - `#7` — `3. Platform — Windows Host + WSL Backend` *(3 open)*
    - `#8` — `4. M4 & M5 — Import & Two-Way Sync` *(13 open)*
    - `#9` — `5. M3 — Behavior Templates` *(4 open)*
  - **Vikunja is the single source of truth for task tracking** (the old local `tracker/items.json` and `scripts/tracker.mjs` have been removed). Keep Vikunja tasks updated as work completes.
  - When finishing a task: mark done, comment the commit SHA, and use `blocking`/`blocked` relations (`vikunja_tasks relate`) so the next unblocked task is obvious.
  - Each milestone project has a Kanban view (done bucket auto-completes tasks). A cross-milestone **"RosForge Board"** saved filter (`done = false && project in 5, 6, 7, 8, 9`) lives in the Vikunja web UI.
  - **MCP gotcha:** `vikunja_filters create` stores filters *locally in the MCP server* (UUID ids), not in Vikunja — don't use it for real saved filters. For queries, pass a `filter` string to `vikunja_tasks list` instead.

- **Architecture note before Slice A:** design `runner.rs` for both hosts. On a Windows host, killing `wsl.exe` does not stop the Linux process tree — record the child's pgid at spawn and cancel via `wsl.exe ... kill -INT -<pgid>`. Put spawn/signal behind the existing `RosEnvRunner` trait so Slice B doesn't force a rewrite.

---

## 2. Re-Evaluation of `SPEC.md` (Recommended Revisions)

Before writing major new subsystems, confirm with the user (or apply if already approved) these 4 spec updates:

1. **Formalize the actual state ownership model (`SPEC.md §1`):**
   - `SPEC.md` says *"Rust owns the model; every mutation goes through a Tauri command."*
   - In practice, `src/store/useProjectStore.ts` owns interactive canvas/inspector edits (needed for 60fps dragging and `zundo` undo/redo) and sends snapshots to Rust on save/validate/generate.
   - **Suggestion:** Formalize this hybrid model in `SPEC.md`: **Zustand owns interactive edits; Rust owns persistence, validation, codegen, process lifecycle, and emits explicit merge patches** when filesystem changes arrive in M4/M5.

2. **Reorder milestones for maximum user payoff:**
   - Original spec order: `M2 → M3 → M4 → M5 → M6` (Windows host in *Later*).
   - **Recommended order:** **`M2 (Build & Run + M1 Polish)` → `M6 (Live Introspection)` → `Platform (Windows Host + WSL Backend)` → `M5 + M4 (One-shot Import first, then live sync)` → `Slim M3 (Behavior Templates)`**.
   - **Why:**
     - **M2** unblocks the disabled `Build` and `Run` toolbar buttons so users never have to leave the app to compile/run.
     - **M6** delivers immediate daily-driver value (replaces `rqt_graph` + multiple `ros2 topic/param/service` terminals) with low parsing risk.
     - **Platform (Windows + WSL)** eliminates WSLg/WebKitGTK CPU rendering lag and `/mnt/e` DrvFs slowness once and for all.
     - **M5 before M4** lets you build & test deterministic `tree-sitter` parsers on real packages (`demo_nodes_py`, `demo_nodes_cpp`) *before* introducing a background `notify` watcher that could race with Zustand.

3. **Trim `M3` (Behavior Templates) for v1:**
   - The full `F3.2` list includes a custom **Field math expression parser/compiler** targeting both Python and C++, which creeps close to the *"Blueprint-style visual logic"* non-goal in `SPEC.md §0`.
   - **Suggestion:** Ship 4 practical smoke-test templates first (**Log message**, **Constant / Counter**, **Republish**, **Echo service**). Defer Field Math / Threshold / Fake Action until users actually ask for them.

4. **Close small M1 gaps alongside M2:**
   - Pull **"Open in External Editor" (VS Code)** forward from `F4.8` onto generated nodes now (we already know every generated file path).
   - Add `insta` snapshot tests (`SPEC.md §6.2`) and `scripts/ci_build.sh` (`SPEC.md §6.5`) so M1 codegen never regresses.
   - Add native folder browsing via `tauri-plugin-dialog` in `WorkspaceModal.tsx`.

---

## 3. Concrete Next-Step Work Packages

Execute **one slice at a time**, keeping `cargo test`, `pnpm build`, and `vitest` green at the end of each slice.

### Slice A (Recommended First): `M2 — Build & Run (+ M1 Polish)` (Vikunja `#5`)
- **Backend (`src-tauri/src/runner.rs`, `commands.rs`, `lib.rs`):**
  - Implement process manager in `AppState` tracking active build job (at most 1) and map of active run sessions (`run_id -> Child + metadata`).
  - `build_workspace(mode: "project" | "all" | "clean", packages: Vec<String>)`: runs `colcon build --symlink-install --packages-select ...` via `ros_env.rs`, spawns in its own process group (`setsid` / `setpgid` on Linux) so cancel sends clean `SIGINT` to the whole tree.
  - Stream stdout/stderr line-by-line via Tauri events (`build-output`, `build-finished`, `run-output`, `run-exited`).
  - Parse build output into `Diagnostic[]`: GCC/Clang `file:line:col: error:`, CMake errors, Python tracebacks `File "...", line N`, and `setuptools` errors.
  - `run_launch(package, launch_file)`, `run_node(package, executable)`, `run_project()` (writes a temporary aggregated launch file under `<ws>/.rosforge/tmp_all.launch.py` including every package's launch file), plus `stop_run(run_id)` and `restart_run(run_id)`.
  - Enforce `buildBeforeRun` setting and block runs while a build is active (`F2.6`).
  - Add `open_in_editor(file: String, line: Option<u32>)` command using `settings.external_editor_command` (`code -g {file}:{line}`).
- **Frontend (`src/App.tsx`, `src/panels/BottomPanel.tsx`, `src/canvas/RosNodeCard.tsx`):**
  - Enable top-toolbar **Build** (with dropdown: Build Project / Build All / Clean) and **Run** (with dropdown: Run Whole Project / Launch Package / Run Node), plus `Ctrl+B` and `F5` shortcuts.
  - Add **Build** tab (ANSI color renderer, auto-scroll toggle, Cancel button) and per-run **Run** tabs (filter by `[node-1]` prefix and log level, Stop / Restart buttons) in `BottomPanel.tsx`.
  - Clicking a build diagnostic opens the file/line via `open_in_editor`.
  - Show green pulse badge on running nodes in `RosNodeCard.tsx`, plus right-click context menu ("Run node", "Open source in editor").
- **M1 Verification Tightening:**
  - Add `insta` snapshots in `src-tauri/src/codegen/` covering `talker_listener_py`, `talker_listener_cpp`, `service_pair`, `action_pair`, `params_timers`.
  - Add `scripts/ci_build.sh` running `colcon build` + `timeout 5 ros2 launch` inside `ros:jazzy`.

### Slice B (High-Impact Alternative First): `Platform — Windows Host + WSL Backend` (Vikunja `#7`)
- **Why consider doing this before or right after M2:** Running the Tauri GUI natively on Windows (Edge WebView2 GPU rendering, instant `<1s` startup, native Windows file dialogs) while executing all `ros2` / `colcon` commands inside `RosForge-Ubuntu-24.04` eliminates every WSLg/WebKitGTK pain point.
- **Implementation:**
  - Implement `WslBashRosEnv` behind the existing `RosEnvRunner` trait in `src-tauri/src/ros_env.rs` (`wsl.exe -d <distro> -- bash -lc ...`).
  - Add `wslDistro: Option<String>` to `Settings` (`settings.rs` + `SettingsModal.tsx`).
  - Add clean path translation helpers (`E:\Dev\...` ↔ `/mnt/e/Dev/...` and `\\wsl.localhost\<distro>\...` ↔ `/...`) used by `project.rs`, `codegen/`, `catalog.rs`, and `runner.rs`.
  - Add `tauri-plugin-dialog` for native folder picker in `WorkspaceModal.tsx`.

### Slice C: `M6 — Live Introspection & Overlay` (Vikunja `#6`)
- **Backend (`src-tauri/src/live.rs`):**
  - Bounded-concurrency poller (configurable interval, default 2s) running `ros2 node list`, `ros2 topic list -t`, `ros2 service list -t`, `ros2 action list -t`, and `ros2 node info <n>`.
  - Channel action commands: `topic_echo` (streaming or `--once`), `topic_hz`, `topic_pub_once`, `service_call`, `action_send_goal`.
  - Live params commands: `param_dump(node)` and `param_set(node, name, value)`.
- **Frontend:**
  - Toolbar **Live** toggle (disabled with explanation when ROS is unavailable) + Overlay diff rendering (green = running, dimmed + red dot = missing, dashed ghost = live-only) + internal topics filter (`/rosout`, `/parameter_events`, `_action/*`).
  - Read-only **Live Graph** tab (`elkjs` auto-layout) + right-click ghost → "Add to project".

### Slice D (Canvas UX Polish — Quick Wins Anytime)
- **Per-port handles on `RosNodeCard.tsx`:** Replace the single left/right handle with individual handles aligned to each port row so multi-topic nodes don't stack overlapping wires.
- **Missing `F1.10` / §5 shortcuts:** `Ctrl+C` / `Ctrl+V` clipboard copy/paste (currently `Ctrl+D` duplicate only), align selected nodes (left/top/horizontal/vertical), and `Space`-hold to pan.
- **Graph engine constraint:** Keep `@xyflow/react` v12 unless the user explicitly approves a native Rust (`egui` + `egui-snarl`) rewrite — **never swap graph libraries without asking first.**

---

## 4. Critical Engineering Guardrails & Gotchas

1. **WSL Cargo Target Directory:** Always set `export CARGO_TARGET_DIR="$HOME/.cache/rosforge-target"` when running `cargo` inside `wsl -d RosForge-Ubuntu-24.04` (building `target/` on `/mnt/e` DrvFs is extremely slow and causes file-lock issues).
2. **Never Hand-Edit `src/bindings.ts`:** Always regenerate via:
   ```bash
   cargo test --manifest-path src-tauri/Cargo.toml export_ts_bindings_succeeds
   ```
3. **Vite `cacheDir`:** Do **not** move Vite's `cacheDir` to `/tmp` — Vite's `@fs` resolver breaks pre-bundled dependency loading under WSL. Keep the default in `vite.config.ts`.
4. **WSLg WebKitGTK Guard:** Keep the WSL env-var setup in `src-tauri/src/main.rs` (`WEBKIT_DISABLE_DMABUF_RENDERER=1`, `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`, `LIBGL_ALWAYS_SOFTWARE=1`, `GDK_BACKEND=x11`) so Linux/WSLg builds never regress to a blank white window.
5. **Fast Desktop Testing:** After building/editing, test quickly via `.\scripts\run-fast.ps1 -Rebuild` (subsequent launches via `.\scripts\run-fast.ps1` take ~1–2s vs ~20s for `pnpm tauri dev`).
6. **Vitest Environment:** Run store unit tests with `pnpm vitest run --environment=node src/store/useProjectStore.test.ts` (avoid jsdom hangs if no DOM is needed).
7. **Secrets:** Never commit Vikunja tokens or machine-specific credentials into the repo.
