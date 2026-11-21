---
title: Feature Walkthrough
description: Complete tour of every RosForge IDE panel, canvas interaction, live validation, code generation, protected user regions, and keyboard shortcuts.
---

This guide walks through every part of the RosForge IDE as currently implemented (**M0 + M1**).

---

## 1. IDE Layout

RosForge uses a four-pane desktop workspace layout:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Top Toolbar: Workspace · Save · Undo/Redo · Layout · Search · Generate  │
│              Build (M2) · Run (M2) · ROS Badge · Theme · Settings       │
├──────────────┬───────────────────────────────────────┬──────────────────┤
│   Palette    │                                       │                  │
│  ──────────  │             Graph Canvas              │    Inspector     │
│   Outline    │  (Packages, ROS Nodes, Channels,      │  (Properties for │
│  (Packages,  │   Edges, Minimap, Zoom Controls)      │   selected item) │
│   Nodes,     │                                       │                  │
│   Channels)  ├───────────────────────────────────────┤                  │
│              │  Bottom Panel: Problems | Output      │                  │
└──────────────┴───────────────────────────────────────┴──────────────────┘
```

---

## 2. Core ROS 2 Building Blocks

### Packages (`ament_python` & `ament_cmake`)
- Rendered as **sub-flow frame containers** on the canvas, color-tagged by language (`PY` or `C++`).
- Selecting a package opens the **Package Inspector** with two tabs:
  - **General:** `name`, `lang` (`python` or `cpp`, with a lock confirmation if nodes already exist), `version`, `license`, `description`, and `maintainer` (`name`, `email`).
  - **Launch:** Create and edit Python launch files (`launch/<name>.launch.py`), choose which nodes to launch, set parameter overrides, and define topic/service remappings.
- You can drag a node card out of one package frame and drop it into another (RosForge asks for confirmation before moving it).

### ROS Nodes
- Live inside a package frame and display:
  - Name, language badge (`PY` / `C++`), and validation status ring (red for errors, amber for warnings).
  - Grouped port rows (`PUB`, `SUB`, `SRV`, `CLI`, `ACT SRV`, `ACT CLI`) with channel names and interface types.
  - Parameter and timer counts in the footer.
- Selecting a node opens the **Node Inspector** where you can configure:
  - **Identity:** `name`, `executable`, `className`, `namespace`, and `ownership` (`generated` vs `handwritten`).
  - **Ports & QoS:** Inspect/remove connected ports and pick a QoS profile per topic port (`Default`, `Sensor Data`, `Services Default`, `System Default`, or `Custom` with explicit `reliability`, `durability`, `history`, and `depth`).
  - **Parameters:** Add typed parameters (`bool`, `int`, `double`, `string`, `string_array`, `int_array`, `double_array`) with live default-value validation.
  - **Timers:** Add periodic wall timers editable in either **milliseconds (`ms`)** or **frequency (`Hz`)**.

### Channels (Topics, Services, Actions)
- Rendered as **pill nodes** on the canvas, color-coded deterministically by their ROS 2 interface package (e.g. `std_msgs`, `geometry_msgs`, `sensor_msgs`).
- Three channel kinds:
  - **Topic** (`pub` / `sub`) — e.g. `/chatter` (`std_msgs/msg/String`)
  - **Service** (`srv_server` / `srv_client`) — e.g. `/add_two_ints` (`example_interfaces/srv/AddTwoInts`)
  - **Action** (`action_server` / `action_client`) — e.g. `/fibonacci` (`action_tutorials_interfaces/action/Fibonacci`)
- Selecting a channel opens the **Channel Inspector** with a **fuzzy Interface Type Picker** backed by the ROS 2 Interface Catalog (plus a **Refresh** button to re-query `ros2 interface list` and inspect field definitions via `ros2 interface show`).

---

## 3. Working on the Graph Canvas

### Adding Elements
There are four fast ways to add packages, nodes, and channels:
1. **Palette click:** Click any item in the left **Palette** to insert it immediately.
2. **Palette drag-and-drop:** Drag a package, node, topic, service, or action from the Palette directly onto the canvas (dropping a ROS Node inside a package frame attaches it to that package).
3. **Double-click Quick-Add:** Double-click any empty canvas area to open a searchable quick-add popover right at your cursor.
4. **Package `+` button / Hotkeys:** Click `+` on a package frame header to add a node inside it, or press `N` (new node) / `T` (new topic).

### Wiring Nodes and Channels
Every ROS node card and channel pill has an input handle (left) and output handle (right):
- **Node (`out`) → Topic (`in`):** Creates a **Publisher** (`pub`) port.
- **Topic (`out`) → Node (`in`):** Creates a **Subscriber** (`sub`) port.
- **Node ↔ Service / Action:** Opens a quick role chooser asking whether the node is the **Server** or **Client**.
- **Drop on empty canvas:** Dragging a wire out from a node's handle and releasing it on empty canvas automatically creates a **new Topic** at the drop point and wires it as a publisher or subscriber!
- **Deleting wires:** Select an edge and press `Delete` / `Backspace` to remove the port.

### Navigation, Layout & Editing
- **Auto-Layout (`Layout` button):** Runs `elkjs` hierarchical layout to neatly arrange packages, nodes, and channels.
- **Find (`Ctrl+F`):** Opens an in-canvas search bar to jump to and focus any package, node, or channel.
- **Outline panel:** Click any package, node, or channel in the left Outline to select and pan to it.
- **Multi-select & Duplicate:** Drag a selection box (or `Shift`-click), press `Ctrl+D` to duplicate selected nodes/channels, or `Delete`/`Backspace` to remove them (deleting a channel or package cascades cleanly to orphaned ports).
- **Undo / Redo & Autosave:** Full undo/redo history (`Ctrl+Z` / `Ctrl+Shift+Z`) powered by `zundo`, plus automatic 1-second debounced saving to `.rosforge.json` (or save immediately with `Ctrl+S`).

---

## 4. Live Validation & Problems Panel

As you edit the graph, RosForge runs the Rust validator continuously and updates both canvas badges and the bottom **Problems** tab:

- **Errors (block code generation):**
  - Invalid ROS 2 package names (must be lowercase alphanumeric + `_`), node names, channel names (must start with `/`), parameter names, timer names, or class/executable identifiers.
  - Duplicate package names, duplicate node/executable names within a package, duplicate channel names, or duplicate parameter/timer names on a node.
  - Missing or malformed interface types (`pkg/msg|srv|action/Type`).
  - Parameter default values that don't match their declared type.
- **Warnings (allow generation, highlight potential runtime bugs):**
  - Orphan topics (no publisher or no subscriber), orphan services/actions (no server or no client).
  - Multiple servers attached to the same service or action.
  - Generated nodes with no ports and no timers.
  - **QoS compatibility mismatches** between publishers and subscribers on the same topic (e.g., a `Best Effort` publisher feeding a `Reliable` subscriber, or a `Volatile` publisher feeding a `Transient Local` subscriber).

Click any diagnostic row in the **Problems** panel to immediately select and focus the offending element on the canvas.

---

## 5. Code Generation & Protected User Regions

Click **Generate** (or press `Ctrl+G`) once validation errors are at `0` to open the **Generate Packages Preview** modal.

### What Gets Generated
- **Python (`ament_python`):** `package.xml`, `setup.py`, `setup.cfg`, `resource/<pkg>`, `<pkg>/__init__.py`, `<pkg>/<node>.py`, and `launch/*.launch.py`.
- **C++ (`ament_cmake`):** `package.xml`, `CMakeLists.txt` (configured with C++17 and `-Wall -Wextra -Wpedantic`), `src/<node>.cpp`, and `launch/*.launch.py`.
- **Automatic dependency derivation:** Every message/service/action package referenced by a package's ports is automatically added to `package.xml` and `CMakeLists.txt` (`find_package` + `ament_target_dependencies`), sorted deterministically.
- **Exact ROS 2 C++ headers:** Interface types follow ROS 2's exact `rosidl_pycommon` naming rules (e.g. `geometry_msgs/msg/Pose2D` → `geometry_msgs/msg/pose2_d.hpp`, `std_msgs/msg/UInt32` → `std_msgs/msg/u_int32.hpp`).

### Protected User Regions
Generated node files include fenced **user regions** keyed by stable internal IDs:

- **Python (`#` comments):**
  ```python
  # >>> rosforge:user <region_id>
  # Your custom code here — preserved across regenerations!
  # <<< rosforge:user <region_id>
  ```
- **C++ (`//` comments):**
  ```cpp
  // >>> rosforge:user <region_id>
  // Your custom code here — preserved across regenerations!
  // <<< rosforge:user <region_id>
  ```

Regions exist for extra **imports/includes**, **constructor init**, **C++ private members**, **every subscription/service/action callback**, and **every timer callback**.

- **Rename-safe:** Because regions are keyed by UUID rather than channel or timer name, renaming `/chatter` to `/status` keeps your callback code intact.
- **Orphan-safe:** If you delete a port or timer that had custom code, RosForge preserves it at the bottom of the file under a `# rosforge:orphaned` / `// rosforge:orphaned` comment block instead of silently deleting your work.
- **Hand-edit protection:** RosForge hashes the non-region scaffold of every generated file in `.rosforge.json`. If you edit code *outside* the protected regions, the preview modal flags the file as **`Hand-edited!`** and lets you choose per file:
  - **Skip** (default for hand-edited files)
  - **Overwrite** (re-apply generated scaffold while still preserving protected regions)
  - **Convert to Handwritten** (switches the node's ownership to `handwritten` so RosForge stops regenerating its source file while still keeping it in `setup.py` / `CMakeLists.txt` and launch files)

---

## 6. Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+S` | Save project immediately (`.rosforge.json`) |
| `Ctrl+Z` | Undo last graph edit |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+G` | Open **Generate Packages Preview** (when 0 validation errors) |
| `Ctrl+F` | Open canvas search overlay |
| `Ctrl+D` | Duplicate selected node(s) or channel(s) |
| `N` | Quick-add a ROS Node to the selected (or first) package |
| `T` | Quick-add a Topic channel |
| `Delete` / `Backspace` | Delete selected nodes, channels, packages, or edges |
| Double-click canvas | Open Quick-Add popover at cursor |

---

## 7. Roadmap (Upcoming Milestones)

The toolbar already shows placeholders for upcoming milestones tracked in `tracker/items.json`:

- **M2 — Build & Run:** In-app streaming `colcon build`, clickable GCC/CMake/Python compiler errors, Run panel with per-node log tabs, and live running-node pulse indicators.
- **M3 — Live ROS 2 Introspection:** Overlay live `ros2 node/topic` graph, live topic echo, and runtime parameter viewer.
- **M4 — Import Existing Packages:** Scan and import existing `ament_python` / `ament_cmake` workspaces into the visual graph.
- **M5 — Launch & Parameters Polish:** Visual launch graph editor and YAML parameter files.
- **M6 — Packaging & Polish:** Release builds, templates, and export tools.
