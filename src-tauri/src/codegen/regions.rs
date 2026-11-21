use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommentStyle {
    Hash,
    Slash,
}

impl CommentStyle {
    pub fn prefix(self) -> &'static str {
        match self {
            Self::Hash => "#",
            Self::Slash => "//",
        }
    }
}

pub fn start_marker(style: CommentStyle, region_id: &str) -> String {
    format!("{} >>> rosforge:user {}", style.prefix(), region_id)
}

pub fn end_marker(style: CommentStyle, region_id: &str) -> String {
    format!("{} <<< rosforge:user {}", style.prefix(), region_id)
}

pub fn orphaned_header(style: CommentStyle) -> String {
    format!("{} rosforge:orphaned", style.prefix())
}

fn parse_start_marker<'a>(line: &'a str, style: CommentStyle) -> Option<&'a str> {
    let trimmed = line.trim();
    let expected = format!("{} >>> rosforge:user ", style.prefix());
    trimmed.strip_prefix(&expected).map(str::trim).filter(|s| !s.is_empty())
}

fn parse_end_marker<'a>(line: &'a str, style: CommentStyle) -> Option<&'a str> {
    let trimmed = line.trim();
    let expected = format!("{} <<< rosforge:user ", style.prefix());
    trimmed.strip_prefix(&expected).map(str::trim).filter(|s| !s.is_empty())
}

/// Normalize all line endings to LF (`\n`).
pub fn normalize_lf(input: &str) -> String {
    input.replace("\r\n", "\n")
}

/// Extracts all `rosforge:user <regionId>` block bodies from an existing source file.
/// Returns a deterministic map of `regionId -> body` (lines between start and end markers,
/// excluding the marker lines themselves).
pub fn extract_regions(content: &str, style: CommentStyle) -> BTreeMap<String, String> {
    let normalized = normalize_lf(content);
    let mut regions = BTreeMap::new();
    let mut current_id: Option<String> = None;
    let mut buf: Vec<&str> = Vec::new();

    for line in normalized.split('\n') {
        if let Some(ref active_id) = current_id {
            if let Some(end_id) = parse_end_marker(line, style) {
                if end_id == active_id {
                    regions.insert(active_id.clone(), buf.join("\n"));
                    current_id = None;
                    buf.clear();
                    continue;
                }
            }
            buf.push(line);
        } else if let Some(start_id) = parse_start_marker(line, style) {
            current_id = Some(start_id.to_string());
            buf.clear();
        }
    }

    regions
}

/// Heuristic: determines whether a region body is still an untouched default stub or empty,
/// so we don't emit noisy orphaned blocks for unedited deleted ports.
fn is_effectively_empty_or_todo(body: &str) -> bool {
    let meaningful: Vec<&str> = body
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    if meaningful.is_empty() {
        return true;
    }
    meaningful.iter().all(|l| {
        l.contains("TODO")
            || *l == "pass"
            || l.starts_with('#')
            || l.starts_with("//")
            || l.starts_with("(void)")
    })
}

/// Reinserts previously extracted user regions into freshly generated source code.
/// Any region from `existing` that does not exist in `generated` (e.g. a deleted port or timer)
/// and contains non-TODO user code is preserved in a `rosforge:orphaned` section at the end
/// of the file so user code is never silently lost (SPEC §6.1).
pub fn reinsert_regions(
    generated: &str,
    existing: &BTreeMap<String, String>,
    style: CommentStyle,
) -> String {
    let normalized = normalize_lf(generated);
    let lines: Vec<&str> = normalized.split('\n').collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut matched_ids: BTreeSet<String> = BTreeSet::new();

    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(region_id) = parse_start_marker(line, style) {
            out.push(line.to_string());
            let mut j = i + 1;
            let mut default_body: Vec<&str> = Vec::new();
            let mut found_end = false;
            while j < lines.len() {
                if let Some(end_id) = parse_end_marker(lines[j], style) {
                    if end_id == region_id {
                        found_end = true;
                        break;
                    }
                }
                default_body.push(lines[j]);
                j += 1;
            }

            if found_end {
                if let Some(saved_body) = existing.get(region_id) {
                    matched_ids.insert(region_id.to_string());
                    if !saved_body.is_empty() {
                        for saved_line in saved_body.split('\n') {
                            out.push(saved_line.to_string());
                        }
                    }
                } else {
                    for d in default_body {
                        out.push(d.to_string());
                    }
                }
                out.push(lines[j].to_string());
                i = j + 1;
                continue;
            }
        }

        out.push(line.to_string());
        i += 1;
    }

    let orphans: Vec<(&String, &String)> = existing
        .iter()
        .filter(|(id, body)| !matched_ids.contains(*id) && !is_effectively_empty_or_todo(body))
        .collect();

    if !orphans.is_empty() {
        // Trim extra trailing blank lines before appending orphaned section
        while out.last().is_some_and(|l| l.is_empty()) {
            out.pop();
        }
        out.push(String::new());
        out.push(orphaned_header(style));
        for (id, body) in orphans {
            out.push(start_marker(style, id));
            for line in body.split('\n') {
                out.push(line.to_string());
            }
            out.push(end_marker(style, id));
        }
        out.push(String::new());
    }

    let mut result = out.join("\n");
    if !result.ends_with('\n') {
        result.push('\n');
    }
    result
}

/// Computes a deterministic SHA-256 hex digest of everything *outside* protected user regions
/// (and outside any trailing `rosforge:orphaned` section). Used for F1.28 hand-edit detection.
pub fn hash_non_region_content(content: &str, style: CommentStyle) -> String {
    let normalized = normalize_lf(content);
    let mut stripped: Vec<&str> = Vec::new();
    let mut current_id: Option<String> = None;
    let orphan_hdr = orphaned_header(style);

    for line in normalized.split('\n') {
        if current_id.is_none() && line.trim() == orphan_hdr {
            break;
        }
        if let Some(ref active_id) = current_id {
            if let Some(end_id) = parse_end_marker(line, style) {
                if end_id == active_id {
                    stripped.push(line);
                    current_id = None;
                }
            }
        } else {
            stripped.push(line);
            if let Some(start_id) = parse_start_marker(line, style) {
                current_id = Some(start_id.to_string());
            }
        }
    }

    while stripped.last().is_some_and(|l| l.is_empty()) {
        stripped.pop();
    }

    let canonical = stripped.join("\n");
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Computes a plain SHA-256 hex digest for files without protected regions (e.g. `package.xml`).
pub fn hash_plain_content(content: &str) -> String {
    let normalized = normalize_lf(content);
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_and_reinserts_user_regions_across_node_rename() {
        let existing_file = r#"class OldTalker(Node):
    def on_timer(self):
        # >>> rosforge:user timer_1
        self.count += 1
        self.get_logger().info(f'custom {self.count}')
        # <<< rosforge:user timer_1
"#;
        let regenerated = r#"class RenamedTalker(Node):
    def on_timer_renamed(self):
        # >>> rosforge:user timer_1
        self.get_logger().info('TODO: implement timer_1')
        # <<< rosforge:user timer_1
"#;

        let extracted = extract_regions(existing_file, CommentStyle::Hash);
        assert_eq!(extracted.len(), 1);
        assert!(extracted["timer_1"].contains("self.count += 1"));

        let merged = reinsert_regions(regenerated, &extracted, CommentStyle::Hash);
        assert!(merged.contains("class RenamedTalker(Node):"));
        assert!(merged.contains("self.count += 1"));
        assert!(!merged.contains("TODO: implement timer_1"));
    }

    #[test]
    fn preserves_deleted_port_code_in_orphaned_block() {
        let existing_file = r#"// >>> rosforge:user port_deleted
RCLCPP_INFO(this->get_logger(), "important custom handler");
// <<< rosforge:user port_deleted
"#;
        let regenerated = r#"// >>> rosforge:user port_kept
RCLCPP_INFO(this->get_logger(), "TODO: implement");
// <<< rosforge:user port_kept
"#;

        let extracted = extract_regions(existing_file, CommentStyle::Slash);
        let merged = reinsert_regions(regenerated, &extracted, CommentStyle::Slash);

        assert!(merged.contains("// rosforge:orphaned"));
        assert!(merged.contains("// >>> rosforge:user port_deleted"));
        assert!(merged.contains("important custom handler"));
    }

    #[test]
    fn non_region_hash_ignores_edits_inside_regions_and_detects_edits_outside() {
        let base = "def a():\n    # >>> rosforge:user r1\n    pass\n    # <<< rosforge:user r1\n";
        let edited_inside =
            "def a():\n    # >>> rosforge:user r1\n    x = 42\n    return x\n    # <<< rosforge:user r1\n";
        let edited_outside =
            "def b():\n    # >>> rosforge:user r1\n    pass\n    # <<< rosforge:user r1\n";

        assert_eq!(
            hash_non_region_content(base, CommentStyle::Hash),
            hash_non_region_content(edited_inside, CommentStyle::Hash)
        );
        assert_ne!(
            hash_non_region_content(base, CommentStyle::Hash),
            hash_non_region_content(edited_outside, CommentStyle::Hash)
        );
    }
}
