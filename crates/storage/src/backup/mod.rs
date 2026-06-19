use std::fs;
use std::path::{Component, Path};
use walkdir::WalkDir;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupCopyResult {
    pub file_count: u64,
    pub total_size_bytes: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("walkdir error: {0}")]
    WalkDir(#[from] walkdir::Error),

    #[error("path is not under root: {path}")]
    StripPrefix { path: String },
}

pub fn copy_skill_directory(
    source: impl AsRef<Path>,
    target: impl AsRef<Path>,
) -> Result<BackupCopyResult, BackupError> {
    let source = source.as_ref();
    let target = target.as_ref();
    let mut result = BackupCopyResult {
        file_count: 0,
        total_size_bytes: 0,
    };

    fs::create_dir_all(target)?;

    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry?;
        let path = entry.path();

        if is_in_git_dir(path) || !entry.file_type().is_file() {
            continue;
        }

        let relative_path = path
            .strip_prefix(source)
            .map_err(|_| BackupError::StripPrefix {
                path: path.to_string_lossy().to_string(),
            })?;
        let destination = target.join(relative_path);

        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }

        let bytes = fs::copy(path, destination)?;
        result.file_count += 1;
        result.total_size_bytes += bytes;
    }

    Ok(result)
}

fn is_in_git_dir(path: &Path) -> bool {
    path.components()
        .any(|component| component == Component::Normal(".git".as_ref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("metis-storage-backup-{}-{}", name, suffix));
        fs::create_dir_all(&root).expect("temp directory should be created");
        root
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent directory should be created");
        }
        fs::write(path, contents).expect("test file should be writable");
    }

    #[test]
    fn copy_skill_directory_copies_regular_files_and_skips_git_directory() {
        let root = temp_dir("copy");
        let source = root.join("source");
        let target = root.join("target");
        write_file(&source.join("SKILL.md"), "# Example\n");
        write_file(&source.join("nested/tool.md"), "tool");
        write_file(&source.join(".git/config"), "git metadata");

        let result = copy_skill_directory(&source, &target).expect("backup copy should succeed");

        assert_eq!(result.file_count, 2);
        assert_eq!(
            result.total_size_bytes,
            "# Example\n".len() as u64 + "tool".len() as u64
        );
        assert_eq!(
            fs::read_to_string(target.join("SKILL.md")).expect("copied file should read"),
            "# Example\n"
        );
        assert_eq!(
            fs::read_to_string(target.join("nested/tool.md")).expect("nested file should read"),
            "tool"
        );
        assert!(!target.join(".git/config").exists());

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }
}
