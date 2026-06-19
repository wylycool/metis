use metis_storage::db::{FileManifestRecord, SkillIndexStore, StorageError};
use metis_storage::manifest::{compute_manifest, ManifestEntry, ManifestError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalStateResult {
    pub skill_id: String,
    pub fingerprint: String,
    pub local_modified: bool,
    pub file_count: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum LocalStateError {
    #[error("skill not found: {skill_id}")]
    SkillNotFound { skill_id: String },

    #[error("manifest error: {0}")]
    Manifest(String),

    #[error("storage error: {0}")]
    Storage(String),
}

pub fn capture_local_baseline(
    skill_id: &str,
    store: &mut SkillIndexStore,
) -> Result<LocalStateResult, LocalStateError> {
    let skill = store
        .get_skill(skill_id)
        .map_err(LocalStateError::from)?
        .ok_or_else(|| LocalStateError::SkillNotFound {
            skill_id: skill_id.to_string(),
        })?;
    let snapshot = compute_manifest(&skill.install_path).map_err(LocalStateError::from)?;
    let records = manifest_records(
        skill_id,
        "baseline",
        &snapshot.fingerprint,
        &snapshot.entries,
    );

    store
        .replace_file_manifest(skill_id, "baseline", &snapshot.fingerprint, &records)
        .map_err(LocalStateError::from)?;
    store
        .update_skill_local_fingerprint(skill_id, &snapshot.fingerprint, false)
        .map_err(LocalStateError::from)?;

    Ok(LocalStateResult {
        skill_id: skill_id.to_string(),
        fingerprint: snapshot.fingerprint,
        local_modified: false,
        file_count: snapshot.entries.len(),
    })
}

pub fn check_local_modification(
    skill_id: &str,
    store: &mut SkillIndexStore,
) -> Result<LocalStateResult, LocalStateError> {
    let skill = store
        .get_skill(skill_id)
        .map_err(LocalStateError::from)?
        .ok_or_else(|| LocalStateError::SkillNotFound {
            skill_id: skill_id.to_string(),
        })?;
    let Some(baseline_fingerprint) = skill.local_fingerprint else {
        return capture_local_baseline(skill_id, store);
    };

    let snapshot = compute_manifest(&skill.install_path).map_err(LocalStateError::from)?;
    let local_modified = snapshot.fingerprint != baseline_fingerprint;
    let records = manifest_records(
        skill_id,
        "current",
        &snapshot.fingerprint,
        &snapshot.entries,
    );

    store
        .replace_file_manifest(skill_id, "current", &snapshot.fingerprint, &records)
        .map_err(LocalStateError::from)?;
    store
        .update_skill_local_modified(skill_id, local_modified)
        .map_err(LocalStateError::from)?;

    Ok(LocalStateResult {
        skill_id: skill_id.to_string(),
        fingerprint: snapshot.fingerprint,
        local_modified,
        file_count: snapshot.entries.len(),
    })
}

fn manifest_records(
    skill_id: &str,
    snapshot_type: &str,
    snapshot_ref: &str,
    entries: &[ManifestEntry],
) -> Vec<FileManifestRecord> {
    entries
        .iter()
        .map(|entry| FileManifestRecord {
            id: stable_manifest_entry_id(
                skill_id,
                snapshot_type,
                snapshot_ref,
                &entry.relative_path,
            ),
            skill_id: skill_id.to_string(),
            snapshot_type: snapshot_type.to_string(),
            snapshot_ref: snapshot_ref.to_string(),
            relative_path: entry.relative_path.clone(),
            file_size: entry.file_size,
            modified_at: entry.modified_at.clone(),
            content_hash: entry.content_hash.clone(),
            is_executable: entry.is_executable,
        })
        .collect()
}

fn stable_manifest_entry_id(
    skill_id: &str,
    snapshot_type: &str,
    snapshot_ref: &str,
    relative_path: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(skill_id.as_bytes());
    hasher.update([0]);
    hasher.update(snapshot_type.as_bytes());
    hasher.update([0]);
    hasher.update(snapshot_ref.as_bytes());
    hasher.update([0]);
    hasher.update(relative_path.as_bytes());
    let digest = hasher.finalize();
    let hex = digest
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    format!("manifest_{}", hex)
}

impl From<ManifestError> for LocalStateError {
    fn from(error: ManifestError) -> Self {
        LocalStateError::Manifest(error.to_string())
    }
}

impl From<StorageError> for LocalStateError {
    fn from(error: StorageError) -> Self {
        LocalStateError::Storage(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use metis_storage::db::{SkillIndexStore, SkillRecord};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("metis-core-{}-{}", name, suffix));
        fs::create_dir_all(&root).expect("temp directory should be created");
        root
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent directory should be created");
        }
        fs::write(path, contents).expect("test file should be writable");
    }

    fn sample_skill(id: &str, install_path: &Path) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            agent_id: "codex".to_string(),
            name: "Example Skill".to_string(),
            description: Some("A skill with local state".to_string()),
            version: Some("1.0.0".to_string()),
            author: Some("Metis Team".to_string()),
            license: Some("MIT".to_string()),
            tags: vec!["workflow".to_string()],
            category: Some("workflow".to_string()),
            install_path: install_path.to_string_lossy().to_string(),
            scope: "user".to_string(),
            metadata_path: Some(install_path.join("SKILL.md").to_string_lossy().to_string()),
            metadata_status: "found".to_string(),
            metadata_error: None,
            source_id: None,
            local_fingerprint: None,
            local_modified: None,
            last_scanned_at: "2026-06-19T10:00:00Z".to_string(),
        }
    }

    #[test]
    fn capture_local_baseline_computes_manifest_and_marks_skill_unmodified() {
        let root = temp_dir("local-baseline");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");

        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("skill-1", &skill_dir))
            .expect("skill should upsert");

        let result =
            capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(result.skill_id, "skill-1");
        assert!(!result.local_modified);
        assert_eq!(result.file_count, 1);
        assert!(result.fingerprint.starts_with("sha256:"));

        let stored = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        assert_eq!(
            stored.local_fingerprint.as_deref(),
            Some(result.fingerprint.as_str())
        );
        assert_eq!(stored.local_modified, Some(false));

        let baseline_entries = store
            .list_file_manifest("skill-1", "baseline", &result.fingerprint)
            .expect("baseline manifest should list");
        assert_eq!(baseline_entries.len(), 1);
        assert_eq!(baseline_entries[0].relative_path, "SKILL.md");
    }

    #[test]
    fn check_local_modification_returns_false_when_fingerprint_matches_baseline() {
        let root = temp_dir("local-unmodified");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");

        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("skill-1", &skill_dir))
            .expect("skill should upsert");
        let baseline =
            capture_local_baseline("skill-1", &mut store).expect("baseline should capture");

        let result =
            check_local_modification("skill-1", &mut store).expect("local state should check");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(result.fingerprint, baseline.fingerprint);
        assert!(!result.local_modified);
    }

    #[test]
    fn check_local_modification_returns_true_when_file_content_changes() {
        let root = temp_dir("local-modified");
        let skill_dir = root.join("skill");
        let skill_md = skill_dir.join("SKILL.md");
        write_file(&skill_md, "# Example\n");

        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("skill-1", &skill_dir))
            .expect("skill should upsert");
        let baseline =
            capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        write_file(&skill_md, "# Example Changed\n");

        let result =
            check_local_modification("skill-1", &mut store).expect("local state should check");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_ne!(result.fingerprint, baseline.fingerprint);
        assert!(result.local_modified);

        let stored = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        assert_eq!(
            stored.local_fingerprint.as_deref(),
            Some(baseline.fingerprint.as_str())
        );
        assert_eq!(stored.local_modified, Some(true));
    }

    #[test]
    fn check_local_modification_captures_baseline_when_missing() {
        let root = temp_dir("local-missing-baseline");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");

        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("skill-1", &skill_dir))
            .expect("skill should upsert");

        let result =
            check_local_modification("skill-1", &mut store).expect("local state should check");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert!(!result.local_modified);

        let stored = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        assert_eq!(
            stored.local_fingerprint.as_deref(),
            Some(result.fingerprint.as_str())
        );
        assert_eq!(stored.local_modified, Some(false));
    }
}
