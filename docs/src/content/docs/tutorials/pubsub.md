---
title: "Tutorial: Simple Python ↔ C++ Pub-Sub Example"
description: Build a Python talker and C++ listener communicating over /chatter (std_msgs/msg/String), write callbacks in protected regions, compile with colcon, and run live in ROS 2 Jazzy.
---

In this tutorial, you will design a classic ROS 2 **Publisher / Subscriber** system in RosForge—a Python `talker` node publishing strings to `/chatter` every 500 ms and a C++ `listener` node subscribing to `/chatter`—then write the callback logic inside RosForge's protected user regions, build the workspace with `colcon`, and run both nodes live in ROS 2 Jazzy.

<figure class="rf-diagram">
  <svg viewBox="0 0 780 210" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Pub-Sub Graph: Python talker node publishes to /chatter topic (std_msgs/msg/String), which C++ listener node subscribes to.">
    <defs>
      <marker id="rf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="var(--sl-color-accent)" />
      </marker>
    </defs>

    <!-- Python Package Frame -->
    <rect x="14" y="16" width="234" height="178" rx="12" fill="var(--sl-color-gray-6)" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="6 4" />
    <text x="28" y="40" fill="var(--sl-color-text)" font-size="13" font-weight="700">py_talker</text>
    <rect x="104" y="25" width="96" height="20" rx="10" fill="var(--sl-color-accent-low)" stroke="#3b82f6" stroke-width="1" />
    <text x="152" y="39" text-anchor="middle" fill="var(--sl-color-accent-high)" font-size="11" font-weight="600">ament_python</text>

    <!-- talker Node Card -->
    <rect x="28" y="58" width="206" height="122" rx="10" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-4)" stroke-width="1.5" />
    <rect x="28" y="58" width="206" height="32" rx="10" fill="var(--sl-color-gray-5)" />
    <rect x="28" y="80" width="206" height="10" fill="var(--sl-color-gray-5)" />
    <text x="42" y="79" fill="var(--sl-color-text)" font-size="13" font-weight="700">talker</text>
    <rect x="192" y="64" width="30" height="20" rx="5" fill="#2563eb" />
    <text x="207" y="78" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="700">PY</text>
    <text x="42" y="112" fill="var(--sl-color-gray-2)" font-size="12">• param: greeting</text>
    <text x="42" y="134" fill="var(--sl-color-gray-2)" font-size="12">• timer: tick (500 ms)</text>
    <text x="42" y="160" fill="var(--sl-color-accent-high)" font-size="11" font-weight="600">PUB  /chatter</text>
    <circle cx="234" cy="118" r="5" fill="var(--sl-color-accent)" />

    <!-- Edge: talker -> /chatter -->
    <line x1="239" y1="118" x2="301" y2="118" stroke="var(--sl-color-accent)" stroke-width="2" marker-end="url(#rf-arrow)" />
    <rect x="255" y="95" width="34" height="18" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)" stroke-width="1" />
    <text x="272" y="108" text-anchor="middle" fill="var(--sl-color-text)" font-size="11" font-weight="600">pub</text>

    <!-- Topic Pill: /chatter -->
    <rect x="307" y="83" width="176" height="70" rx="35" fill="var(--sl-color-bg)" stroke="#10b981" stroke-width="2" />
    <circle cx="307" cy="118" r="5" fill="#10b981" />
    <circle cx="483" cy="118" r="5" fill="#10b981" />
    <text x="395" y="112" text-anchor="middle" fill="var(--sl-color-text)" font-size="14" font-weight="700">/chatter</text>
    <text x="395" y="133" text-anchor="middle" fill="var(--sl-color-gray-2)" font-size="11.5">std_msgs/msg/String</text>

    <!-- Edge: /chatter -> listener -->
    <line x1="488" y1="118" x2="554" y2="118" stroke="var(--sl-color-accent)" stroke-width="2" marker-end="url(#rf-arrow)" />
    <rect x="504" y="95" width="34" height="18" rx="6" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-5)" stroke-width="1" />
    <text x="521" y="108" text-anchor="middle" fill="var(--sl-color-text)" font-size="11" font-weight="600">sub</text>

    <!-- C++ Package Frame -->
    <rect x="546" y="16" width="220" height="178" rx="12" fill="var(--sl-color-gray-6)" stroke="#a855f7" stroke-width="1.5" stroke-dasharray="6 4" />
    <text x="560" y="40" fill="var(--sl-color-text)" font-size="13" font-weight="700">cpp_listener</text>
    <rect x="656" y="25" width="96" height="20" rx="10" fill="var(--sl-color-gray-5)" stroke="#a855f7" stroke-width="1" />
    <text x="704" y="39" text-anchor="middle" fill="var(--sl-color-text)" font-size="11" font-weight="600">ament_cmake</text>

    <!-- listener Node Card -->
    <rect x="560" y="58" width="192" height="122" rx="10" fill="var(--sl-color-bg)" stroke="var(--sl-color-gray-4)" stroke-width="1.5" />
    <rect x="560" y="58" width="192" height="32" rx="10" fill="var(--sl-color-gray-5)" />
    <rect x="560" y="80" width="192" height="10" fill="var(--sl-color-gray-5)" />
    <text x="574" y="79" fill="var(--sl-color-text)" font-size="13" font-weight="700">listener</text>
    <rect x="706" y="64" width="34" height="20" rx="5" fill="#9333ea" />
    <text x="723" y="78" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="700">C++</text>
    <text x="574" y="118" fill="var(--sl-color-accent-high)" font-size="11" font-weight="600">SUB  /chatter</text>
    <text x="574" y="142" fill="var(--sl-color-gray-2)" font-size="12">Logs incoming messages</text>
    <circle cx="560" cy="118" r="5" fill="var(--sl-color-accent)" />
  </svg>
  <figcaption>Target RosForge graph: Python <code>talker</code> publishing to <code>/chatter</code> and C++ <code>listener</code> subscribing to it.</figcaption>
</figure>

:::tip[Shortcut]
If you just want to explore a pre-built workspace right away, open the Workspace modal and click **Create Talker/Listener Example**. It scaffolds a richer version of this graph (including a service and an action). Follow the steps below to build the pure pub-sub graph from scratch.
:::

---

## Step 1: Create a New Workspace

1. Launch RosForge (see [Getting Started](/RosForge/guides/getting-started/)).
2. Click **Open Workspace…** in the top-left toolbar.
3. Enter a Linux workspace path, for example:
   ```text
   /home/<your-user>/rosforge_pubsub_ws
   ```
4. Enter Project Name: `pubsub_demo`.
5. Click **Open / Create**.

RosForge initializes `/home/<your-user>/rosforge_pubsub_ws/src/` and `.rosforge.json` and opens an empty canvas.

---

## Step 2: Create the Python and C++ Packages

1. In the left **Palette**, click **Python Package** (`ament_python`).
2. Click the newly created package frame on the canvas and set these fields in the right **Inspector**:
   - **Name:** `py_talker`
   - **Description:** `Python publisher tutorial package`
3. In the left **Palette**, click **C++ Package** (`ament_cmake`).
4. Select the new C++ package frame and set:
   - **Name:** `cpp_listener`
   - **Description:** `C++ subscriber tutorial package`

---

## Step 3: Add the `talker` and `listener` Nodes

### Configure `talker` (Python)
1. Click the **`+`** button on the `py_talker` package frame header (or drag **ROS Node** from the Palette into `py_talker`).
2. Select the new node and edit its properties in the **Inspector**:
   - **Name:** `talker`
   - **Executable:** `talker`
   - **Class Name:** `TalkerNode`
3. Under **Parameters**, click **Add Parameter** and set:
   - **Name:** `greeting`
   - **Type:** `string`
   - **Default:** `Hello from RosForge`
4. Under **Timers**, click **Add Timer** and set:
   - **Name:** `tick`
   - **Period:** `500` ms (`2 Hz`)

### Configure `listener` (C++)
1. Click the **`+`** button on the `cpp_listener` package frame header.
2. Select the new node and set:
   - **Name:** `listener`
   - **Executable:** `listener`
   - **Class Name:** `ListenerNode`

---

## Step 4: Create `/chatter` and Wire the Graph

1. Press `T` (or click **Topic** in the Palette) to add a Topic pill to the canvas.
2. Select the topic pill and in the **Inspector**:
   - **Name:** `/chatter`
   - **Interface Type:** search for and select `std_msgs/msg/String`
3. **Wire the publisher:** Drag from the **right handle** (`out`) of `talker` to the **left handle** (`in`) of `/chatter`.
   - A `pub` edge appears and `talker` gains a `PUB /chatter` port row.
4. **Wire the subscriber:** Drag from the **right handle** (`out`) of `/chatter` to the **left handle** (`in`) of `listener`.
   - A `sub` edge appears and `listener` gains a `SUB /chatter` port row.
5. Click **Layout** in the top toolbar to arrange the graph cleanly with ELK auto-layout.
6. Check the bottom **Problems** tab—you should see **0 errors, 0 warnings**!

:::tip[Pro tip]
Next time, you can also drag straight out of `talker`'s right handle and drop onto empty canvas—RosForge will create and wire a new Topic in one gesture.
:::

---

## Step 5: Preview and Generate the ROS 2 Packages

1. Press `Ctrl+G` (or click **Generate** in the top toolbar).
2. In the **Generate Packages Preview** modal, inspect the file list on the left. RosForge generates both complete ROS 2 packages:
   ```text
   src/py_talker/package.xml
   src/py_talker/setup.py
   src/py_talker/setup.cfg
   src/py_talker/resource/py_talker
   src/py_talker/py_talker/__init__.py
   src/py_talker/py_talker/talker.py
   src/cpp_listener/package.xml
   src/cpp_listener/CMakeLists.txt
   src/cpp_listener/src/listener.cpp
   ```
   Notice that `std_msgs` is automatically added to `<depend>` in both `package.xml` files and to `find_package` / `ament_target_dependencies` in `CMakeLists.txt`.
3. Click **Apply & Write Files**.

---

## Step 6: Add Your Pub-Sub Logic Inside Protected Regions

Open the two generated node source files in your editor. Notice the `# >>> rosforge:user <id>` and `// >>> rosforge:user <id>` markers—write your custom logic **between those markers** so RosForge preserves it whenever you regenerate.

### 1. Python Talker (`src/py_talker/py_talker/talker.py`)

RosForge already generated `self.declare_parameter('greeting', 'Hello from RosForge')`, `self.pub_chatter = self.create_publisher(String, '/chatter', 10)`, and `self.timer_tick = self.create_timer(0.5, self.on_timer_tick)`.

Update the two user regions (`<node_id>:init` and `<timer_id>`) like this:

```python
        # >>> rosforge:user <node_id>:init
        self._count = 0
        self.get_logger().info('Talker ready!')
        # <<< rosforge:user <node_id>:init

    def on_timer_tick(self):
        # >>> rosforge:user <timer_id>
        greeting = self.get_parameter('greeting').get_parameter_value().string_value
        msg = String()
        msg.data = f'{greeting} #{self._count}'
        self.pub_chatter.publish(msg)
        self.get_logger().info(f'Publishing: "{msg.data}"')
        self._count += 1
        # <<< rosforge:user <timer_id>
```

:::note
Keep the exact UUIDs that RosForge generated in your file—only replace the lines *inside* the `>>>` / `<<<` fences.
:::

### 2. C++ Listener (`src/cpp_listener/src/listener.cpp`)

RosForge already generated `#include "std_msgs/msg/string.hpp"`, `sub_chatter_`, and `void on_sub_chatter(const std_msgs::msg::String::SharedPtr msg)`.

Update the subscription callback user region:

```cpp
  void on_sub_chatter(const std_msgs::msg::String::SharedPtr msg) {
    (void)msg;
    // >>> rosforge:user <port_id>
    RCLCPP_INFO(this->get_logger(), "I heard: '%s'", msg->data.c_str());
    // <<< rosforge:user <port_id>
  }
```

---

## Step 7: Verify Safe Regeneration (Optional, Recommended!)

Try evolving your architecture in RosForge to see protected regions in action:

1. Select the `/chatter` topic pill in RosForge and rename it to `/greetings`.
2. Press `Ctrl+G` to open **Generate Packages Preview**.
3. Click `src/py_talker/py_talker/talker.py` and `src/cpp_listener/src/listener.cpp` in the diff viewer:
   - The publisher/subscriber channel strings update from `'/chatter'` to `'/greetings'`.
   - Your custom Python and C++ lines inside the `rosforge:user` blocks remain **completely intact**!
4. (You can press `Ctrl+Z` afterward if you want to keep `/chatter`.)

---

## Step 8: Build and Run with ROS 2 Jazzy

Open a terminal inside Ubuntu 24.04 (or `wsl -d RosForge-Ubuntu-24.04`) and build the workspace:

```bash
cd ~/rosforge_pubsub_ws
source /opt/ros/jazzy/setup.bash
colcon build --symlink-install
source install/setup.bash
```

Now run both nodes in separate terminals (remember to `source /opt/ros/jazzy/setup.bash` and `source ~/rosforge_pubsub_ws/install/setup.bash` in each terminal):

**Terminal 1 — Python Talker:**
```bash
ros2 run py_talker talker
```

**Terminal 2 — C++ Listener:**
```bash
ros2 run cpp_listener listener
```

You should see output like:
```text
[INFO] [talker]: Publishing: "Hello from RosForge #0"
[INFO] [listener]: I heard: 'Hello from RosForge #0'
[INFO] [talker]: Publishing: "Hello from RosForge #1"
[INFO] [listener]: I heard: 'Hello from RosForge #1'
```

**Terminal 3 — Optional live inspection & parameter override:**
```bash
# Inspect messages directly from ROS 2 CLI
ros2 topic echo /chatter

# Or run the talker with a custom greeting parameter
ros2 run py_talker talker --ros-args -p greeting:="Hola ROS 2"
```

---

## Bonus: Add a Launch File

Want to start `talker` with a custom greeting in one command?

1. Select the `py_talker` package in RosForge and switch to the **Launch** tab in the Inspector.
2. Add a launch file named `demo`, add the `talker` node entry, and optionally add a parameter override (`greeting` → `Launched via RosForge`).
3. Press `Ctrl+G` → **Apply & Write Files**, re-run `colcon build --symlink-install`, and launch it:
   ```bash
   ros2 launch py_talker demo.launch.py
   ```
