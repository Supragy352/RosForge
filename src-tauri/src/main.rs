#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
fn configure_wsl_webkit_env() {
    let is_wsl = std::env::var_os("WSL_DISTRO_NAME").is_some()
        || std::fs::read_to_string("/proc/version")
            .map(|v| v.to_ascii_lowercase().contains("microsoft"))
            .unwrap_or(false);

    if is_wsl {
        // WebKitGTK 2.46–2.52 on WSLg Wayland/D3D12 renders a blank white viewport unless
        // DMA-BUF, accelerated compositing, and GPU Skia rendering are disabled.
        for (key, val) in [
            ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
            ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
            ("WEBKIT_SKIA_ENABLE_CPU_RENDERING", "1"),
            ("LIBGL_ALWAYS_SOFTWARE", "1"),
            ("GDK_BACKEND", "x11"),
        ] {
            if std::env::var_os(key).is_none() {
                std::env::set_var(key, val);
            }
        }
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    configure_wsl_webkit_env();

    rosforge_lib::run();
}
