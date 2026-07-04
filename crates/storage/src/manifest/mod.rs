use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path};
use std::time::SystemTime;
use walkdir::WalkDir;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestSnapshot {
    pub fingerprint: String,
    pub entries: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestEntry {
    pub relative_path: String,
    pub file_size: u64,
    pub modified_at: String,
    pub content_hash: String,
    pub is_executable: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("walkdir error: {0}")]
    WalkDir(#[from] walkdir::Error),

    #[error("path is not under root: {path}")]
    StripPrefix { path: String },
}

pub fn compute_manifest(root: impl AsRef<Path>) -> Result<ManifestSnapshot, ManifestError> {
    let root = root.as_ref();
    let mut entries = Vec::new();

    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry?;
        let path = entry.path();

        if is_in_git_dir(path) || !entry.file_type().is_file() {
            continue;
        }

        let metadata = entry.metadata()?;
        let relative_path = path
            .strip_prefix(root)
            .map_err(|_| ManifestError::StripPrefix {
                path: path.to_string_lossy().to_string(),
            })?
            .components()
            .map(component_to_string)
            .collect::<Vec<_>>()
            .join("/");
        let modified_at = metadata.modified().map(DateTime::<Utc>::from)?.to_rfc3339();
        let content = fs::read(path)?;
        let content_hash = sha256_hex_with_prefix(&content);

        entries.push(ManifestEntry {
            relative_path,
            file_size: metadata.len(),
            modified_at,
            content_hash,
            is_executable: is_executable(&metadata),
        });
    }

    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let fingerprint = compute_fingerprint(&entries);

    Ok(ManifestSnapshot {
        fingerprint,
        entries,
    })
}

pub fn compute_local_updated_at(root: impl AsRef<Path>) -> Result<Option<String>, ManifestError> {
    let root = root.as_ref();
    let mut latest: Option<SystemTime> = None;

    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry?;
        let path = entry.path();

        if is_in_git_dir(path) || !entry.file_type().is_file() {
            continue;
        }

        let modified_at = entry.metadata()?.modified()?;
        latest = Some(match latest {
            Some(current) => current.max(modified_at),
            None => modified_at,
        });
    }

    Ok(latest.map(|time| DateTime::<Utc>::from(time).to_rfc3339()))
}

fn compute_fingerprint(entries: &[ManifestEntry]) -> String {
    let mut hasher = Sha256::new();

    for entry in entries {
        hasher.update(entry.relative_path.as_bytes());
        hasher.update([0]);
        hasher.update(entry.content_hash.as_bytes());
        hasher.update([0]);
        hasher.update(entry.file_size.to_string().as_bytes());
        hasher.update([0]);
        hasher.update(if entry.is_executable { b"1" } else { b"0" });
        hasher.update([0]);
    }

    format!("sha256:{}", hex_digest(hasher.finalize().as_slice()))
}

fn sha256_hex_with_prefix(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{}", hex_digest(hasher.finalize().as_slice()))
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>()
}

fn component_to_string(component: Component<'_>) -> String {
    component.as_os_str().to_string_lossy().to_string()
}

fn is_in_git_dir(path: &Path) -> bool {
    path.components()
        .any(|component| component.as_os_str() == ".git")
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;

    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("metis-storage-{}-{}", name, suffix));
        fs::create_dir_all(&root).expect("temp directory should be created");
        root
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent directory should be created");
        }
        fs::write(path, contents).expect("test file should be writable");
    }

    fn set_modified(path: &Path, modified_time: SystemTime) {
        let file = fs::File::open(path).expect("test file should open");
        let times = fs::FileTimes::new()
            .set_modified(modified_time)
            .set_accessed(modified_time);
        file.set_times(times).expect("test file time should update");
    }

    #[test]
    fn compute_manifest_returns_sorted_entries_and_stable_fingerprint() {
        let root = temp_dir("manifest-stable");
        write_file(&root.join("b.txt"), "bravo");
        write_file(&root.join("nested/a.txt"), "alpha");

        let snapshot = compute_manifest(&root).expect("manifest should compute");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        let paths = snapshot
            .entries
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(paths, vec!["b.txt", "nested/a.txt"]);
        assert_eq!(snapshot.entries.len(), 2);
        assert!(snapshot.fingerprint.starts_with("sha256:"));
        assert_eq!(snapshot.fingerprint.len(), "sha256:".len() + 64);
    }

    #[test]
    fn compute_manifest_changes_fingerprint_when_file_content_changes() {
        let root = temp_dir("manifest-content-change");
        write_file(&root.join("skill.txt"), "before");

        let first = compute_manifest(&root).expect("first manifest should compute");
        write_file(&root.join("skill.txt"), "after");
        let second = compute_manifest(&root).expect("second manifest should compute");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_ne!(first.fingerprint, second.fingerprint);
        assert_ne!(
            first.entries[0].content_hash,
            second.entries[0].content_hash
        );
    }

    #[test]
    fn compute_manifest_ignores_git_directory() {
        let root = temp_dir("manifest-ignore-git");
        write_file(&root.join("SKILL.md"), "# Example\n");
        write_file(&root.join(".git/config"), "first");

        let first = compute_manifest(&root).expect("first manifest should compute");
        write_file(&root.join(".git/config"), "second");
        let second = compute_manifest(&root).expect("second manifest should compute");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(first.fingerprint, second.fingerprint);
        assert_eq!(first.entries.len(), 1);
        assert_eq!(first.entries[0].relative_path, "SKILL.md");
    }

    #[test]
    fn compute_local_updated_at_uses_deepest_regular_file_and_ignores_git() {
        let root = temp_dir("local-updated-at");
        let base_time = UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let skill = root.join("SKILL.md");
        let nested = root.join("references/deep/note.md");
        let git_config = root.join(".git/config");
        write_file(&skill, "# Example\n");
        write_file(&nested, "newest visible file");
        write_file(&git_config, "ignored newest file");
        set_modified(&skill, base_time + Duration::from_secs(10));
        set_modified(&nested, base_time + Duration::from_secs(20));
        set_modified(&git_config, base_time + Duration::from_secs(30));

        let updated_at = compute_local_updated_at(&root).expect("local updated at should compute");
        let nested_updated_at =
            DateTime::<Utc>::from(base_time + Duration::from_secs(20)).to_rfc3339();

        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(updated_at.as_deref(), Some(nested_updated_at.as_str()));
    }
}
