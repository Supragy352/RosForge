#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
TARGET_USER="supragy"

echo "=== [1/6] Configuring default WSL user (${TARGET_USER}) ==="
if ! id -u "${TARGET_USER}" >/dev/null 2>&1; then
  # Ubuntu 24.04 ships with uid 1000 'ubuntu' user; rename or create cleanly
  if id -u ubuntu >/dev/null 2>&1; then
    usermod -l "${TARGET_USER}" ubuntu
    groupmod -n "${TARGET_USER}" ubuntu || true
    usermod -d "/home/${TARGET_USER}" -m "${TARGET_USER}"
  else
    useradd -m -s /bin/bash -G sudo "${TARGET_USER}"
  fi
fi
usermod -aG sudo "${TARGET_USER}"
echo "${TARGET_USER} ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/${TARGET_USER}"
chmod 0440 "/etc/sudoers.d/${TARGET_USER}"

cat > /etc/wsl.conf <<EOF
[boot]
systemd=true

[user]
default=${TARGET_USER}
EOF

echo "=== [2/6] Installing base packages, locales, and Tauri 2 Linux deps ==="
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  wget \
  file \
  git \
  gnupg \
  lsb-release \
  locales \
  software-properties-common \
  build-essential \
  pkg-config \
  patchelf \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  dbus-x11 \
  x11-utils

locale-gen en_US en_US.UTF-8
update-locale LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8

echo "=== [3/6] Installing ROS 2 Jazzy + colcon ==="
add-apt-repository -y universe
curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key \
  -o /usr/share/keyrings/ros-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME}") main" \
  > /etc/apt/sources.list.d/ros2.list

apt-get update
apt-get install -y --no-install-recommends \
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

echo "=== [4/6] Installing Node.js 22 LTS + pnpm ==="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y --no-install-recommends nodejs
fi
npm install -g pnpm@10

echo "=== [5/6] Installing Rust toolchain for ${TARGET_USER} ==="
su - "${TARGET_USER}" -c '
  if [ ! -x "$HOME/.cargo/bin/rustc" ]; then
    curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile default
  fi
  grep -q "cargo/env" "$HOME/.bashrc" || echo "source \"\$HOME/.cargo/env\"" >> "$HOME/.bashrc"
  grep -q "CARGO_TARGET_DIR" "$HOME/.bashrc" || echo "export CARGO_TARGET_DIR=\"\$HOME/.cache/rosforge-target\"" >> "$HOME/.bashrc"
  grep -q "WEBKIT_DISABLE_DMABUF_RENDERER" "$HOME/.bashrc" || echo "export WEBKIT_DISABLE_DMABUF_RENDERER=1" >> "$HOME/.bashrc"
'

echo "=== [6/6] Verification ==="
su - "${TARGET_USER}" -c '
  source "$HOME/.cargo/env"
  source /opt/ros/jazzy/setup.bash
  echo "User: $(whoami)"
  echo "ROS_DISTRO: ${ROS_DISTRO}"
  ros2 --help | head -n 3
  rustc -V
  cargo -V
  node -v
  pnpm -v
  pkg-config --modversion webkit2gtk-4.1
'
echo "=== WSL Ubuntu 24.04 + ROS 2 Jazzy setup complete ==="
