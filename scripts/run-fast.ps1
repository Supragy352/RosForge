<#
.SYNOPSIS
  Fast launcher for RosForge under WSL2 (WSLg).

.DESCRIPTION
  Running `pnpm tauri dev` over WSL's /mnt/e DrvFs takes ~15-20s because Vite
  crawls node_modules across the Windows/WSL boundary on every start.

  This script builds a standalone debug binary with the production frontend
  embedded once (cached in ~/.cache/rosforge-fast/rosforge) and launches it
  directly in ~1-2 seconds on subsequent runs.

.EXAMPLE
  .\scripts\run-fast.ps1            # Instant launch (builds once if missing)
  .\scripts\run-fast.ps1 -Rebuild   # Rebuild frontend + Rust binary, then launch
#>
param(
    [string]$Distro = "RosForge-Ubuntu-24.04",
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$rebuildFlag = if ($Rebuild) { "1" } else { "0" }

$bashScript = @"
set -euo pipefail
REPO="/mnt/e/Dev/Robotics/RosForge"
TARGET_DIR="\$HOME/.cache/rosforge-target"
FAST_DIR="\$HOME/.cache/rosforge-fast"
FAST_BIN="\$FAST_DIR/rosforge"

if [ "$rebuildFlag" = "1" ] || [ ! -x "\$FAST_BIN" ]; then
  echo "[RosForge] Building standalone fast-launch binary (one-time or -Rebuild)..."
  cd "\$REPO"
  export CARGO_TARGET_DIR="\$TARGET_DIR"
  pnpm build
  cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
  mkdir -p "\$FAST_DIR"
  cp "\$TARGET_DIR/debug/rosforge" "\$FAST_BIN"
  chmod +x "\$FAST_BIN"
  echo "[RosForge] Cached at \$FAST_BIN"
fi

echo "[RosForge] Launching cached binary (pass -Rebuild after editing code)..."
exec "\$FAST_BIN"
"@

# Strip any Windows CR added by PowerShell's pipeline before executing in bash
$bashScript | wsl -d $Distro -- bash -c "tr -d '\r' | bash -s"
