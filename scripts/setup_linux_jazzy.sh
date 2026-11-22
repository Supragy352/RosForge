#!/usr/bin/env bash
# Native Ubuntu 24.04 setup script for RosForge (ROS 2 Jazzy + Tauri 2 + Node 22 + Rust).
# Usage: bash scripts/setup_linux_jazzy.sh
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "Please run this script as your normal user (it will invoke sudo when needed)." >&2
  exit 1
fi

echo "=== [1/5] Installing Tauri 2 + build system dependencies ==="
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  wget \
  file \
  git \
  gnupg \
  lsb-release \
  software-properties-common \
  build-essential \
  pkg-config \
  patchelf \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev

echo "=== [2/5] Installing ROS 2 Jazzy + colcon (if not already installed) ==="
if [ ! -f /opt/ros/jazzy/setup.bash ]; then
  sudo add-apt-repository -y universe
  sudo curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key \
    -o /usr/share/keyrings/ros-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME}") main" \
    | sudo tee /etc/apt/sources.list.d/ros2.list >/dev/null
  sudo apt-get update
fi

sudo apt-get install -y --no-install-recommends \
  ros-jazzy-ros-base \
  ros-jazzy-demo-nodes-py \
  ros-jazzy-demo-nodes-cpp \
  ros-jazzy-action-tutorials-interfaces \
  ros-jazzy-nav-msgs \
  ros-jazzy-sensor-msgs \
  ros-jazzy-geometry-msgs \
  ros-jazzy-std-srvs \
  ros-jazzy-example-interfaces \
  python3-colcon-common-extensions

echo "=== [3/5] Installing Node.js 22 + pnpm 10 ==="
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y --no-install-recommends nodejs
fi
if ! command -v pnpm >/dev/null 2>&1; then
  sudo npm install -g pnpm@10
fi

echo "=== [4/5] Installing Rust toolchain (if missing) ==="
if [ ! -x "$HOME/.cargo/bin/rustc" ] && ! command -v rustc >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile default
fi
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

echo "=== [5/5] Verifying toolchain ==="
# shellcheck disable=SC1091
source /opt/ros/jazzy/setup.bash
echo "ROS_DISTRO : ${ROS_DISTRO}"
echo "ros2       : $(command -v ros2)"
echo "colcon     : $(command -v colcon)"
echo "rustc      : $(rustc -V)"
echo "cargo      : $(cargo -V)"
echo "node       : $(node -v)"
echo "pnpm       : $(pnpm -v)"
echo "webkit2gtk : $(pkg-config --modversion webkit2gtk-4.1)"

echo ""
echo "=== Setup complete! Next steps: ==="
echo "  pnpm install"
echo "  pnpm tauri dev"
