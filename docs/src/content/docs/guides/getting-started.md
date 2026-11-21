---
title: Getting Started
description: Install prerequisites, launch RosForge on Ubuntu 24.04 or Windows WSL2 (WSLg), and verify that your ROS 2 Jazzy environment is connected.
---

This guide covers installing prerequisites, launching RosForge on Ubuntu 24.04 or Windows WSL2 (WSLg), and verifying that your ROS 2 Jazzy environment is connected.

---

## Prerequisites

RosForge targets **Ubuntu 24.04 LTS** with **ROS 2 Jazzy Jalisco** (natively on Linux or inside WSL2 with WSLg on Windows 11).

| Dependency | Version / Notes |
| --- | --- |
| **ROS 2 Jazzy** | Installed at `/opt/ros/jazzy` with `colcon` (`python3-colcon-common-extensions`) |
| **Rust toolchain** | `rustc` / `cargo` (stable, edition 2021) |
| **Node.js & pnpm** | Node 20+ (tested on Node 22) and `pnpm` 9/10 |
| **Tauri 2 Linux deps** | `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` |

---

## Launching RosForge

### Native Ubuntu 24.04

```bash
cd /path/to/RosForge
source /opt/ros/jazzy/setup.bash
pnpm install
pnpm tauri dev
```

### Windows 11 via WSL2 + WSLg

If you are using the project's preconfigured WSL2 distro (`RosForge-Ubuntu-24.04`), keep Cargo's build directory on the Linux ext4 filesystem (`$HOME/.cache/rosforge-target`) so compilation stays fast instead of crossing the Windows `/mnt/e` DrvFs boundary:

```powershell
wsl -d RosForge-Ubuntu-24.04 -- bash -lc 'cd /mnt/e/Dev/Robotics/RosForge && export CARGO_TARGET_DIR="$HOME/.cache/rosforge-target" && pnpm tauri dev'
```

The Tauri desktop window opens directly on your Windows desktop via WSLg.

:::tip
When creating or opening a ROS 2 workspace inside RosForge on WSL2, use a **Linux filesystem path** such as `/home/<user>/rosforge_ws` (or `/tmp/rosforge_ws` for quick experiments). Avoid `/mnt/c` or `/mnt/e` for `colcon build` workspaces—symlinks and CMake builds are dramatically faster on ext4.
:::

---

## First-Run Check: ROS 2 Health & Settings

When RosForge launches:

1. Look at the **ROS health badge** on the right side of the top toolbar.
   - **Green (`ROS 2 jazzy`)**: RosForge sourced your setup script and verified `ros2` and `colcon` are available.
   - **Warning banner**: RosForge could not detect ROS 2 at the configured setup path.
2. Click the **Settings** (gear) icon in the top-right corner to configure:
   - **ROS 2 Setup Script Path** (defaults to `/opt/ros/jazzy/setup.bash`)
   - **Default Workspace Path**
   - **Default Maintainer Name & Email** (auto-populated into generated `package.xml` and `setup.py` files)
   - **Theme** (Dark / Light)
3. Even without a live ROS 2 installation, RosForge still lets you draw graphs, validate them, browse the bundled offline Jazzy interface catalog, and generate packages.

---

## Opening or Creating Your First Workspace

Click **Open Workspace…** in the top toolbar (or the onboarding buttons on the empty canvas):

- **Open / Create Blank Workspace:** Enter a Linux folder path (e.g. `/home/<user>/ros2_ws`), optionally enter a project name, and click **Open / Create**. RosForge creates `src/` and `.rosforge.json` automatically if they don't exist.
- **Create Talker/Listener Example:** Want to see a complete graph immediately? Enter a folder path and click **Create Talker/Listener Example** to scaffold a working Python + C++ workspace with topics, services, actions, parameters, timers, and launch files.

---

## Next Steps

- Ready to build your first graph step by step? Jump into the [**Simple Pub-Sub Tutorial**](/RosForge/tutorials/pubsub/).
- Want a reference of every panel, interaction, and shortcut? Read the [**Feature Walkthrough**](/RosForge/guides/features/).
