use std::path::Path;

fn main() {
    let bindings_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("bindings.ts");
    rosforge_lib::export_typescript_bindings(&bindings_path)
        .expect("Failed to export TypeScript bindings");
    println!("Exported TypeScript bindings to {}", bindings_path.display());
}
