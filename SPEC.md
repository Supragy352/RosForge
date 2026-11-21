# RosForge — Feature & Architecture Specification

## 0. Product summary
Working name **RosForge**. It is a desktop node-graph editor for ROS 2 Jazzy. Canvas nodes are ROS nodes and channels (topics, services, actions). Wiring them creates publishers, subscribers, clients and servers. The app generates colcon packages (`ament_python` or `ament_cmake`), builds and runs them, parses hand-edited code back into the graph, and overlays the live ROS graph.

**Non-goals for v1:** custom `.msg`/`.srv`/`.action` authoring, an embedded code editor, Blueprint-style visual logic, native Windows, ROS 1, rosbag tooling, and multi-machine setups.

## 1. Tech stack (fixed — don't re-litigate)
| Layer | Choice |
|---|---|
| Shell | Tauri 2 (Linux build first; run under WSLg during dev) |
| Frontend | React 18 + TypeScript + Vite, `@xyflow/react` v12, Zustand (+ `zundo` for undo/redo), Tailwind |
| Auto-layout | `elkjs` (used for import + live views) |
| Rust core | `serde`/`serde_json`, `minijinja` (codegen templates), `tree-sitter` + `tree-sitter-python` + `tree-sitter-cpp`, `notify` (file watching), `tokio::process` (build/run/CLI), `quick-xml` (package.xml), `similar` (diffs), `thiserror` |
| Type sharing | `specta` + `tauri-specta` → generated TS bindings for all commands/model types (no hand-written duplicate types) |
| Tests | Rust: `cargo test` + `insta` snapshots. Frontend: `vitest`. Integration: `ros:jazzy` Docker image runs `colcon build` on generated output |

The architecture rule: **Rust owns the model and all side effects.** The frontend is a view/editor on that model. Every mutation goes through a Tauri command that returns the new model, or a patch of it. The frontend never touches the filesystem or spawns processes.

## 2. Repo layout
```
ROS_UI/
  SPEC.md
  src-tauri/
    src/
      main.rs            # tauri setup, command registration
      model.rs           # project data model (serde + specta)
      project.rs         # load/save/migrate .rosforge.json
      validate.rs        # graph validation → Diagnostics
      catalog.rs         # ros2 interface list/show cache
      codegen/           # mod.rs, python.rs, cpp.rs, launch.rs, regions.rs, behaviors.rs
      codegen/templates/ # *.jinja
      parse/             # mod.rs, python.rs, cpp.rs, package_xml.rs, launch_py.rs, cmake.rs
      sync.rs            # file watcher → parse → merge into model
      ros_env.rs         # sourcing, env building, `bash -lc` wrapper
      runner.rs          # colcon build / ros2 run / ros2 launch process mgmt
      live.rs            # ros2 CLI polling → LiveGraph
    tests/fixtures/      # sample packages for parser + roundtrip tests
  src/                   # React app
    App.tsx, store/, canvas/ (custom node types), panels/, bindings.ts (generated)
```

## 3. Data model (`model.rs`)
The project file is `<workspace>/.rosforge.json`, pretty-printed JSON with a `schemaVersion: 1` field and a migration hook. All IDs are UUIDv7 strings.

```
Project { schemaVersion, name, workspacePath, rosDistro:"jazzy", packages: Package[], channels: Channel[], canvas: { positions: {id → {x,y}}, viewport } }
Package { id, name, lang: "python"|"cpp", version, description, maintainer{name,email}, license, nodes: Node[], launchFiles: LaunchFile[], extraDeps: string[] }
Node    { id, name, executable, className, namespace, ownership: "generated"|"handwritten",
          ports: Port[], params: Param[], timers: Timer[], sourceFile?: path }
Port    { id, kind: "pub"|"sub"|"srv_server"|"srv_client"|"action_server"|"action_client",
          channelId, qos: QosPreset, behavior?: Behavior, origin: "ui"|"code", codeLocation?: {file,line} }
Channel { id, kind: "topic"|"service"|"action", name: "/chatter", type: "std_msgs/msg/String" }
Param   { id, name, type: bool|int|double|string|*_array, default, description, origin }
Timer   { id, name, periodMs, behavior?: Behavior, origin }
QosPreset = "default"|"sensor_data"|"services_default"|"system_default"|{ depth, reliability, durability, history }
LaunchFile { id, name, entries: [{ nodeId, nameOverride?, namespace?, remaps:[[from,to]], paramOverrides:{name→value} }] }
Diagnostic { severity: error|warning|info, message, targetId?, file?, line? }
```
**Channels are first-class canvas nodes**, drawn as pill shapes like topics in rqt_graph. That makes fan-in and fan-out natural, and the message type lives in exactly one place. A port's type always equals its channel's type.

## 4. Feature list by milestone

### M0 — Scaffolding
- F0.1 Tauri 2 + Vite + React + TS app boots under WSLg. `pnpm tauri dev` works.
- F0.2 `specta` bindings are generated on `cargo build`. A sample `ping` command is called from the UI.
- F0.3 Settings store at `~/.config/rosforge/settings.json`: ROS setup path (default `/opt/ros/jazzy/setup.bash`), default workspace, default maintainer name/email, `ROS_DOMAIN_ID`, and the external editor command (default `code -g {file}:{line}`).
- F0.4 `ros_env.rs`: `run_in_ros(cmd, cwd) → Child` runs `bash -lc "source <ros> && [source <ws>/install/setup.bash if exists] && <cmd>"`. On startup, run `ros2 --help` as a health check. If ROS isn't found, show a banner.

### M1 — MVP: draw graph → generate package
**Workspace and project**
- F1.1 New, open and save a workspace. The user picks a folder, the app creates `src/` and `.rosforge.json` if missing, and keeps a recent-workspaces list.
- F1.2 Autosave (debounced 1s) and a dirty indicator. Ctrl+S saves.
- F1.3 Undo/redo (Ctrl+Z / Ctrl+Shift+Z) across all graph edits.

**Canvas**
- F1.4 Layout: left **Palette**, center **Canvas**, right **Inspector**, bottom tabbed **Panel** (Problems, Output; later Build, Run, Live), and a top **Toolbar** with Generate, Build and Run buttons.
- F1.5 Package grouping: each package is a React Flow group (sub-flow) frame. Nodes live inside a package frame. Dragging a node into another frame moves it to that package, after a confirmation.
- F1.6 Palette items: Package, Node, Topic, Service, Action. Drag one onto the canvas, or double-click the canvas for a quick-add search popup.
- F1.7 Custom node renderer: a header showing name and language badge, port rows grouped as Publishes, Subscribes, Serves, Calls, Action server and Action client, plus a params count and a timers count. Handles sit left for inputs (sub, srv_client response, etc.) and right for outputs.
- F1.8 Wiring: drag from a node's "+ publish" handle to a Topic channel to create a `pub` port, and from a Topic to a node to create a `sub` port. Service and action wiring works the same way (server or client is decided by direction or by a prompt). Dropping on empty canvas offers "create new topic here".
- F1.9 Channel type colors: each message package gets a stable hue (`std_msgs`, `geometry_msgs`, `sensor_msgs`…). Edges inherit the color.
- F1.10 Multi-select, box select, delete, copy/paste (IDs regenerated, names suffixed `_copy`), align, and an auto-layout button (`elk`).
- F1.11 Minimap, zoom-to-fit, and a canvas search (Ctrl+F) that jumps to a node or channel.

**Inspector (right panel)**
- F1.12 Package: name, lang (Python or C++, locked after the first generate unless the user confirms deleting the generated files), version, description, maintainer, license dropdown (`Apache-2.0` default), and extra deps.
- F1.13 Node: name, executable name (defaults to the node name), class name (PascalCase), namespace, ownership. Lists ports, params and timers with add/remove/edit.
- F1.14 Channel: name and type. The **type picker** is a fuzzy search over the interface catalog (F1.18), filtered by kind (msg/srv/action). Changing the type re-validates every connected port.
- F1.15 Port: QoS preset dropdown, with a custom option that exposes depth, reliability and durability.
- F1.16 Params: name, type, default (an input that validates against the type), description.
- F1.17 Timers: name and period in ms or Hz, toggleable.

**Interface catalog**
- F1.18 `catalog.rs` runs `ros2 interface list` and lazily runs `ros2 interface show <type>` for field trees. Results are cached in `~/.cache/rosforge/interfaces-jazzy.json`, with a refresh button. If ROS is unavailable, a bundled fallback list of common types is used (`std_msgs`, `geometry_msgs`, `sensor_msgs`, `nav_msgs`, `std_srvs`, `example_interfaces`, `action_tutorials_interfaces`).

**Validation (live, shown in the Problems panel; clicking an item selects its target)**
- F1.19 Errors: invalid ROS names (package names are `[a-z][a-z0-9_]*`; node and topic names follow the ROS 2 naming rules), duplicate package names, duplicate node names within a package, duplicate executable names, a channel without a type, a C++ class name that isn't a valid identifier, and a param default that doesn't match its type.
- F1.20 Warnings: a topic with subscribers but no publisher (or the reverse), a service or action with clients but no server, more than one server on a service, a timer with no behavior on a generated node, and QoS incompatibility between a pub and a sub (`best_effort` pub feeding a `reliable` sub).
- F1.21 Generate is blocked while errors exist.

**Code generation**
- F1.22 Generate writes `<ws>/src/<pkg>/` for each package. It shows a **preview dialog** with a file tree and a per-file diff (`similar`) against what's on disk. Generation is all-or-nothing.
- F1.23 **Python (`ament_python`)** output: `package.xml` (format 3), `setup.py` (entry_points `console_scripts` per node, `data_files` for `launch/` and `resource/`), `setup.cfg`, `resource/<pkg>`, `<pkg>/__init__.py`, `<pkg>/<node>.py`, and `launch/<pkg>.launch.py`. Each node is a class derived from `rclpy.node.Node`. It declares params with `declare_parameter`, creates pubs, subs, srvs, clients and timers in `__init__`, defines one method per callback, and has `main()` with `rclpy.init` / spin / `destroy_node` / `try_shutdown` and `KeyboardInterrupt` handling. Actions use `rclpy.action.ActionServer` / `ActionClient` with execute, goal and cancel callbacks.
- F1.24 **C++ (`ament_cmake`)** output: `package.xml`, `CMakeLists.txt` (`find_package` per dependency, `add_executable` and `ament_target_dependencies` per node, install targets and `launch/`), `src/<node>.cpp` (class derived from `rclcpp::Node`, `std::shared_ptr` members, `std::bind` or lambda callbacks, `main` with `rclcpp::spin`), and `launch/<pkg>.launch.py`. Actions use `rclcpp_action` (add the dependency). C++ type mapping: `std_msgs/msg/String` → `std_msgs::msg::String`, with include `std_msgs/msg/string.hpp` (CamelCase → snake_case header).
- F1.25 **Dependencies are auto-derived**: the set of message packages used by every channel on the package's ports, plus `rclpy`/`rclcpp`, plus `rclpy`/`rclcpp_action` when there are actions, plus `launch_ros`, plus `extraDeps`. They're written to `package.xml` as `<depend>` and to CMake `find_package`.
- F1.26 **Launch file**: one per package by default. It contains every node with its namespace, remaps and param overrides from the `LaunchFile` entries. The Inspector gets a "Launch" tab where entries are edited.
- F1.27 **Protected regions** (`regions.rs`): every callback body, the imports block, the class-members block and the end of `__init__` / the constructor get stable markers:
  `# >>> rosforge:user <regionId>` … `# <<< rosforge:user <regionId>` (`//` in C++). The `regionId` is derived from the stable port, timer or node ID, not from its name, so renaming in the UI doesn't lose code. On regeneration, the contents of existing regions are preserved and reinserted.
- F1.28 **Hand-edit detection**: the generator stores a hash of each generated file's *non-region* content in `.rosforge.json`. If the on-disk non-region content differs, the preview dialog flags the file as "modified outside regions" and offers three choices: Overwrite, Skip this file, or Convert node to handwritten (see M4).
- F1.29 The default region body is a `TODO` log line, so freshly generated packages build and run with no edits.
- F1.30 Generation is **deterministic**: the same model always produces byte-identical output. It uses sorted deps, stable ordering by ID or creation order, and `\n` line endings. Snapshot tests enforce this.

**Acceptance for M1:** build the classic talker/listener (one Python package, one C++ package, both sharing `/chatter`), plus a service and an action pair, entirely in the UI. Click Generate, and `colcon build` succeeds unmodified in the `ros:jazzy` container. `ros2 launch <pkg> <pkg>.launch.py` runs and the nodes log.

### M2 — Build & run from the UI
- F2.1 The Build button runs `colcon build --symlink-install --packages-select <pkgs in project>`, with optional "build all" and "clean" (delete `build`/`install`/`log` for the selected packages, after a confirmation).
- F2.2 Output streams line by line to the **Build** tab through Tauri events, with ANSI colors rendered. A cancel button sends SIGINT to the process group.
- F2.3 Error parsing: GCC/Clang `file:line:col: error:`, CMake errors, Python `File "...", line N` tracebacks, and setuptools errors become Diagnostics. Clicking one opens the external editor at that line.
- F2.4 The Run menu offers: launch a package's launch file, `ros2 run` a single node (also from a node's right-click menu), and **Run whole project** (a temporary aggregated launch file that includes every package's launch file).
- F2.5 Each run gets its own tab in the **Run** panel with interleaved stdout and stderr, filtered by node name prefix (`[talker-1]`) and log level. The panel has stop and restart controls. Running nodes get a green pulse on the canvas.
- F2.6 Building before running is optional (a setting, on by default). Runs are blocked while a build is in progress.

### M3 — Behavior templates (no-code prototyping)
- F3.1 Each sub port, timer, service server and action server on a *generated* node can carry an optional `Behavior`. The generator emits working code for it inside a **generated-behavior block**. The user region still follows, so the user can extend it.
- F3.2 Templates for v1:
  - **Log message** (sub): logs the whole message, or chosen fields, at a chosen level.
  - **Republish** (sub → pub on the same node): forward unchanged, optionally throttled to N Hz.
  - **Publish constant** (timer → pub): the user fills the message fields through a form generated from the catalog's field tree.
  - **Counter / sine / ramp** (timer → pub): writes a numeric field with a counter, `A*sin(2πft)` or a ramp.
  - **Field math** (sub → pub): `out.field = expr(in.fields)`. Expressions are restricted to `+ - * / abs min max clamp` and field refs, parsed and validated in Rust, then emitted as Python or C++.
  - **Threshold** (sub → pub Bool): `in.field <op> value`.
  - **Echo service** (srv server): fills the response from constants, or returns `success=true` for `std_srvs/Trigger` and `SetBool`.
  - **Fake action** (action server): sleeps N steps, publishes feedback with a progress field if one exists, and succeeds.
- F3.3 The Inspector shows a behavior picker on each port or timer, with a form schema per template. Field pickers come from the catalog field tree (`ros2 interface show`).
- F3.4 Each template has Python and C++ emitters. A snapshot test per template per language, plus a container build test.

### M4 — Code → graph (two-way sync)
- F4.1 `sync.rs` watches `<ws>/src/**` with `notify`, debounced at 300ms. When a node source file changes, it re-parses that file and merges the result into the model. Edits that rosforge itself writes are ignored, using a write-token or content-hash check.
- F4.2 **Python parser** (tree-sitter queries) recognizes, inside classes deriving from `Node`: `super().__init__('name')`, `create_publisher(T, 'topic', qos)`, `create_subscription(T, 'topic', cb, qos)`, `create_service(T, 'name', cb)`, `create_client(T, 'name')`, `ActionServer(self, T, 'name', ...)`, `ActionClient(self, T, 'name')`, `declare_parameter('name', default)`, and `create_timer(period, cb)`. It resolves `T` through the file's imports (`from std_msgs.msg import String` → `std_msgs/msg/String`).
- F4.3 **C++ parser** recognizes `Node("name")` in constructor initializers, `create_publisher<T>("topic", qos)`, `create_subscription<T>(...)`, `create_service<T>`, `create_client<T>`, `rclcpp_action::create_server<T>(this, "name", ...)`, `create_client<T>` for actions, `declare_parameter("name", default)` / `declare_parameter<T>(...)`, and `create_wall_timer(...)`. It maps `ns::msg::Type` → `ns/msg/Type`.
- F4.4 Names that aren't string literals (variables, f-strings, concatenation) are surfaced as ports with `name: "?"`, a warning diagnostic and a `codeLocation`, never dropped silently.
- F4.5 **Merge rules:**
  - For *generated* nodes, constructs found in user regions that don't match an existing model port become ports with `origin:"code"`. They appear on the canvas with a `</>` badge, and their structural fields are read-only in the Inspector, with a "Open in editor" button. Constructs that match a model port are ignored, because they're the generated ones.
  - For *handwritten* nodes, the parsed result **is** the node's ports, params and timers, with everything treated as `origin:"code"`. The app never writes the file. Canvas edits that would change structure are disabled, and a tooltip explains why.
  - Channels referenced by parsed ports are matched by name and kind, or created automatically and placed with `elk` near the node.
- F4.6 **Convert to handwritten**: the node's ownership flips. The app stops managing the file, removes the region markers (optional checkbox), and keeps `package.xml`, `setup.py` and CMake entries managed. **Convert to generated** is not supported in v1.
- F4.7 "Add handwritten node": picks an existing `.py` or `.cpp` file in a package, parses it, and registers its entry point or executable in `setup.py` or CMake (those files stay generator-owned).
- F4.8 Double-clicking any port with a `codeLocation` opens the external editor at that line.
- F4.9 **Roundtrip test**: for every fixture model, generate → parse → the structural model must be equal (ignoring positions and origin). This is CI-gating.

### M5 — Import existing packages
- F5.1 "Import package(s)…": scans a folder for `package.xml`. For each package, it reads the build type (`ament_python` or `ament_cmake`), finds executables (`setup.py` `console_scripts` or CMake `add_executable`), maps each executable to its source file, and parses the sources with the M4 parsers. Imported nodes default to `handwritten`.
- F5.2 Launch file import (`launch_py.rs`): parses `generate_launch_description()` for `Node(package=, executable=, name=, namespace=, remappings=[...], parameters=[{...}])` into a `LaunchFile`. Anything it doesn't recognize (`IncludeLaunchDescription`, conditions, substitutions) is kept as a warning and listed in the Launch tab as "unparsed (read-only)". XML and YAML launch files get a warning only in v1.
- F5.3 Remaps from the launch file are applied when the app resolves which channel a port connects to.
- F5.4 The imported graph gets an `elk` auto-layout. The import report lists everything that was found and everything skipped.

### M6 — Live introspection
- F6.1 The Live toggle on the toolbar polls every 2s (configurable): `ros2 node list`, `ros2 topic list -t`, `ros2 service list -t`, `ros2 action list -t`, and `ros2 node info <n>` for each node (run with bounded concurrency).
- F6.2 **Overlay mode** compares the designed graph to the live one. Designed and running items are solid green. Designed but not running items are dimmed with a red dot. Running but not designed items appear as ghost nodes and channels, dashed and auto-placed. Hidden internals (`/parameter_events`, `/rosout`, `_action/*` subtopics, and `~/` param services) are filtered by a toggle.
- F6.3 **Live-only mode** is a separate read-only tab that shows just the live graph with `elk` layout, like `rqt_graph`.
- F6.4 Right-clicking a ghost item gives "Add to project". It creates a handwritten-style node stub with ports, or a channel.
- F6.5 Channel actions: **Echo** (`ros2 topic echo <t> --once`, or streamed to a panel tab), **Hz** (`ros2 topic hz`), **Publish once** (YAML form built from the catalog field tree → `ros2 topic pub --once`), **Call service** (form → `ros2 service call`), and **Send goal** (form → `ros2 action send_goal --feedback`).
- F6.6 Node action: **Params**. `ros2 param dump <node>` shows live values next to the designed defaults, and `ros2 param set` edits them live.
- F6.7 The Live panel shows the last poll time and any CLI errors. If ROS isn't sourced, the Live toggle is disabled with an explanation.

### Later (documented, not built)
- Windows host with ROS in WSL: `ros_env.rs` gains a `wsl -d Ubuntu-24.04 -- bash -lc` backend and `\\wsl$` path translation. The trait boundary in `ros_env.rs` is the only abstraction prepared for it.
- Custom msg/srv/action authoring, generating a `<project>_interfaces` `ament_cmake` package.
- Embedded Monaco editor, YAML parameter files, lifecycle and component nodes, rosbag record/play, multiple launch files per package with composition.

## 5. UX details
- Keyboard: `N` new node, `T` new topic, `Del` delete, `Ctrl+D` duplicate, `Ctrl+G` generate, `Ctrl+B` build, `F5` run project, `Ctrl+F` find, `Space` (hold) to pan.
- Theme: dark by default, with a light toggle.
- Every long-running action (generate, build, run, poll) shows non-blocking status in a status bar.
- Empty-state onboarding: a "Create talker/listener example" button that builds the M1 acceptance graph.

## 6. Testing and verification (the building agent must keep these green)
1. `cargo test`: unit tests for name validation, type mapping (Python import paths, C++ headers and namespaces), dependency derivation, region extract/reinsert (including renamed nodes and deleted ports, whose orphaned region content is kept in a `# rosforge:orphaned` block at the end of the file, never deleted), and the expression parser for Field math.
2. `insta` snapshots of the full generated output for these fixtures: `talker_listener_py`, `talker_listener_cpp`, `service_pair` (both languages), `action_pair` (both languages), `params_timers`, and every behavior template.
3. Parser fixture tests against hand-written packages in `src-tauri/tests/fixtures/`, including ROS 2 tutorial-style code and code with non-literal names.
4. The roundtrip test (F4.9).
5. A container integration script, `scripts/ci_build.sh`: runs `docker run ros:jazzy`, generates every fixture into a temporary workspace, then runs `colcon build` and, for each package, `timeout 5 ros2 launch` to check that the nodes start without crashing.
6. `vitest` for store reducers (wiring creates ports correctly, undo/redo) and for frontend-side validation display.
7. Manual check per milestone: the acceptance flow in M1, then build/run it from the UI (M2), add a Counter behavior and see it publish in the Run log (M3), add a publisher in VS Code and watch it appear on the canvas (M4), import `demo_nodes_py` sources (M5), and run `ros2 run demo_nodes_cpp talker` externally and see it appear as a ghost in Live overlay (M6).

## 7. Order of work for the building agent
M0 → M1 → M2 → M3 → M4 → M5 → M6. Each milestone ends with its tests green and the manual check done before the next one starts. Don't implement "Later" items. Keep the model in `model.rs` as the single source of truth, and add fields with a `schemaVersion` bump and a migration.
