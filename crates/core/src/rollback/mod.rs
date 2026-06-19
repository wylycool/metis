use crate::audit::{write_audit_event, AuditAction, AuditEventInput};
use crate::local_state::{capture_local_baseline, manifest_records};
use chrono::Utc;
use metis_storage::backup::{
    copy_skill_directory, delete_backup_directory, replace_skill_directory,
    BackupError as BackupCopyError,
};
use metis_storage::db::{BackupRecord, SkillIndexStore, StorageError};
use metis_storage::manifest::{compute_manifest, ManifestError};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreateBackupOptions {
    pub skill_id: String,
    pub backup_root: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupSummary {
    pub backup_id: String,
    pub skill_id: String,
    pub source_commit: Option<String>,
    pub backup_path: String,
    pub created_at: String,
    pub reason: String,
    pub file_count: u64,
    pub total_size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestoreBackupOptions {
    pub skill_id: String,
    pub backup_id: String,
    pub backup_root: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RestoreResult {
    pub skill_id: String,
    pub restored_from_backup_id: String,
    pub previous_state_backup_id: String,
}

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("skill not found: {skill_id}")]
    SkillNotFound { skill_id: String },

    #[error("storage error: {0}")]
    Storage(String),

    #[error("backup copy error: {0}")]
    Copy(String),

    #[error("manifest error: {0}")]
    Manifest(String),
}

pub fn create_backup(
    options: CreateBackupOptions,
    store: &mut SkillIndexStore,
) -> Result<BackupSummary, BackupError> {
    let skill = store
        .get_skill(&options.skill_id)
        .map_err(BackupError::from)?
        .ok_or_else(|| BackupError::SkillNotFound {
            skill_id: options.skill_id.clone(),
        })?;
    let source_commit = match skill.source_id.as_deref() {
        Some(source_id) => store
            .get_source(source_id)
            .map_err(BackupError::from)?
            .and_then(|source| source.current_commit),
        None => None,
    };
    let backup_id = format!("backup_{}", Uuid::new_v4().simple());
    let backup_path = PathBuf::from(&options.backup_root)
        .join("backups")
        .join(&skill.id)
        .join(&backup_id);
    let copy_result =
        copy_skill_directory(&skill.install_path, &backup_path).map_err(BackupError::from)?;
    let snapshot = compute_manifest(&backup_path).map_err(BackupError::from)?;
    let records = manifest_records(&skill.id, "backup", &backup_id, &snapshot.entries);

    store
        .replace_file_manifest(&skill.id, "backup", &backup_id, &records)
        .map_err(BackupError::from)?;

    let created_at = Utc::now().to_rfc3339();
    let backup = BackupRecord {
        id: backup_id.clone(),
        skill_id: skill.id.clone(),
        source_commit: source_commit.clone(),
        backup_path: backup_path.to_string_lossy().to_string(),
        file_count: copy_result.file_count,
        total_size_bytes: copy_result.total_size_bytes,
        reason: options.reason.clone(),
        restore_status: None,
        created_at: Some(created_at.clone()),
    };

    store.insert_backup(&backup).map_err(BackupError::from)?;

    Ok(BackupSummary {
        backup_id,
        skill_id: skill.id,
        source_commit,
        backup_path: backup.backup_path,
        created_at,
        reason: options.reason,
        file_count: copy_result.file_count,
        total_size_bytes: copy_result.total_size_bytes,
    })
}

pub fn list_backups(
    skill_id: &str,
    store: &SkillIndexStore,
) -> Result<Vec<BackupSummary>, BackupError> {
    let backups = store.list_backups(skill_id).map_err(BackupError::from)?;
    Ok(backups
        .into_iter()
        .map(backup_summary_from_record)
        .collect())
}

pub fn restore_backup(
    options: RestoreBackupOptions,
    store: &mut SkillIndexStore,
) -> Result<RestoreResult, BackupError> {
    let skill = store
        .get_skill(&options.skill_id)
        .map_err(BackupError::from)?
        .ok_or_else(|| BackupError::SkillNotFound {
            skill_id: options.skill_id.clone(),
        })?;
    let backup = store
        .get_backup(&options.backup_id)
        .map_err(BackupError::from)?
        .ok_or_else(|| BackupError::Storage(format!("backup not found: {}", options.backup_id)))?;

    if backup.skill_id != skill.id {
        return Err(BackupError::Storage(format!(
            "backup {} does not belong to skill {}",
            backup.id, skill.id
        )));
    }

    let previous = create_backup(
        CreateBackupOptions {
            skill_id: skill.id.clone(),
            backup_root: options.backup_root,
            reason: "pre-rollback".to_string(),
        },
        store,
    )?;

    replace_skill_directory(&backup.backup_path, &skill.install_path).map_err(BackupError::from)?;
    store
        .mark_backup_restored(&backup.id, "restored")
        .map_err(BackupError::from)?;
    capture_local_baseline(&skill.id, store)
        .map_err(|error| BackupError::Manifest(error.to_string()))?;
    let _ = write_audit_event(
        store,
        AuditEventInput {
            skill_id: skill.id.clone(),
            action: AuditAction::RollbackApplied,
            detail: Some(format!("restored backup {}", backup.id)),
            commit_before: backup.source_commit.clone(),
            commit_after: backup.source_commit.clone(),
            status: "success".to_string(),
            risk_summary: None,
        },
    );

    Ok(RestoreResult {
        skill_id: skill.id,
        restored_from_backup_id: backup.id,
        previous_state_backup_id: previous.backup_id,
    })
}

pub fn delete_backup(backup_id: &str, store: &mut SkillIndexStore) -> Result<(), BackupError> {
    let Some(backup) = store.get_backup(backup_id).map_err(BackupError::from)? else {
        return Ok(());
    };

    delete_backup_directory(&backup.backup_path).map_err(BackupError::from)?;
    store.delete_backup(backup_id).map_err(BackupError::from)?;
    let _ = write_audit_event(
        store,
        AuditEventInput {
            skill_id: backup.skill_id.clone(),
            action: AuditAction::BackupDeleted,
            detail: Some(format!("deleted backup {backup_id}")),
            commit_before: backup.source_commit.clone(),
            commit_after: None,
            status: "success".to_string(),
            risk_summary: None,
        },
    );
    Ok(())
}

fn backup_summary_from_record(backup: BackupRecord) -> BackupSummary {
    BackupSummary {
        backup_id: backup.id,
        skill_id: backup.skill_id,
        source_commit: backup.source_commit,
        backup_path: backup.backup_path,
        created_at: backup.created_at.unwrap_or_default(),
        reason: backup.reason,
        file_count: backup.file_count,
        total_size_bytes: backup.total_size_bytes,
    }
}

impl From<StorageError> for BackupError {
    fn from(error: StorageError) -> Self {
        BackupError::Storage(error.to_string())
    }
}

impl From<BackupCopyError> for BackupError {
    fn from(error: BackupCopyError) -> Self {
        BackupError::Copy(error.to_string())
    }
}

impl From<ManifestError> for BackupError {
    fn from(error: ManifestError) -> Self {
        BackupError::Manifest(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use metis_storage::db::{SkillIndexStore, SkillRecord, SourceRecord};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("metis-core-backup-{}-{}", name, suffix));
        fs::create_dir_all(&root).expect("temp directory should be created");
        root
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent directory should be created");
        }
        fs::write(path, contents).expect("test file should be writable");
    }

    fn sample_skill(id: &str, install_path: &Path, source_id: Option<&str>) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            agent_id: "codex".to_string(),
            name: "Example Skill".to_string(),
            description: Some("A skill with backups".to_string()),
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
            source_id: source_id.map(ToOwned::to_owned),
            local_fingerprint: None,
            local_modified: None,
            last_scanned_at: "2026-06-19T10:00:00Z".to_string(),
        }
    }

    fn sample_source(id: &str) -> SourceRecord {
        SourceRecord {
            id: id.to_string(),
            source_type: "git".to_string(),
            url: "https://github.com/example/metis-skills.git".to_string(),
            repo_path: "skills/example".to_string(),
            ref_: "main".to_string(),
            current_commit: Some("abc123".to_string()),
            remote_commit: Some("def456".to_string()),
            last_checked_at: Some("2026-06-19T11:00:00Z".to_string()),
            trusted: true,
            auto_update: false,
            credential_ref: None,
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn create_backup_copies_skill_files_and_records_manifest() {
        let root = temp_dir("create");
        let skill_dir = root.join("skill");
        let backup_root = root.join("backup-root");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");
        write_file(&skill_dir.join("nested/tool.md"), "tool");
        write_file(&skill_dir.join(".git/config"), "git metadata");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_source(&sample_source("source-1"))
            .expect("source should upsert");
        store
            .upsert_skill(&sample_skill("skill-1", &skill_dir, Some("source-1")))
            .expect("skill should upsert");

        let backup = create_backup(
            CreateBackupOptions {
                skill_id: "skill-1".to_string(),
                backup_root: backup_root.to_string_lossy().to_string(),
                reason: "manual".to_string(),
            },
            &mut store,
        )
        .expect("backup should create");

        assert_eq!(backup.skill_id, "skill-1");
        assert_eq!(backup.reason, "manual");
        assert_eq!(backup.source_commit.as_deref(), Some("abc123"));
        assert_eq!(backup.file_count, 2);
        assert_eq!(
            backup.total_size_bytes,
            "# Example\n".len() as u64 + "tool".len() as u64
        );
        assert_eq!(
            fs::read_to_string(Path::new(&backup.backup_path).join("SKILL.md"))
                .expect("backup file should read"),
            "# Example\n"
        );
        assert!(!Path::new(&backup.backup_path).join(".git/config").exists());

        let stored = store
            .get_backup(&backup.backup_id)
            .expect("backup lookup should succeed")
            .expect("backup should exist");
        assert_eq!(stored.source_commit.as_deref(), Some("abc123"));
        assert_eq!(stored.reason, "manual");

        let manifest_entries = store
            .list_file_manifest("skill-1", "backup", &backup.backup_id)
            .expect("backup manifest should list");
        assert_eq!(manifest_entries.len(), 2);
        assert_eq!(manifest_entries[0].relative_path, "SKILL.md");
        assert_eq!(manifest_entries[1].relative_path, "nested/tool.md");

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn restore_backup_replaces_skill_directory_and_creates_previous_state_backup() {
        let root = temp_dir("restore");
        let skill_dir = root.join("skill");
        let backup_root = root.join("backup-root");
        write_file(&skill_dir.join("SKILL.md"), "# Old\n");
        write_file(&skill_dir.join("stale.md"), "stale");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("skill-1", &skill_dir, None))
            .expect("skill should upsert");
        let backup = create_backup(
            CreateBackupOptions {
                skill_id: "skill-1".to_string(),
                backup_root: backup_root.to_string_lossy().to_string(),
                reason: "manual".to_string(),
            },
            &mut store,
        )
        .expect("backup should create");
        fs::write(skill_dir.join("SKILL.md"), "# Changed\n").expect("skill should change");
        write_file(&skill_dir.join("new.md"), "new");

        let result = restore_backup(
            RestoreBackupOptions {
                skill_id: "skill-1".to_string(),
                backup_id: backup.backup_id.clone(),
                backup_root: backup_root.to_string_lossy().to_string(),
            },
            &mut store,
        )
        .expect("backup should restore");

        assert_eq!(result.skill_id, "skill-1");
        assert_eq!(result.restored_from_backup_id, backup.backup_id);
        assert_ne!(
            result.previous_state_backup_id,
            result.restored_from_backup_id
        );
        assert_eq!(
            fs::read_to_string(skill_dir.join("SKILL.md")).expect("restored file should read"),
            "# Old\n"
        );
        assert!(skill_dir.join("stale.md").exists());
        assert!(!skill_dir.join("new.md").exists());

        let restored = store
            .get_backup(&result.restored_from_backup_id)
            .expect("backup lookup should succeed")
            .expect("backup should exist");
        assert_eq!(restored.restore_status.as_deref(), Some("restored"));
        let previous = store
            .get_backup(&result.previous_state_backup_id)
            .expect("previous backup lookup should succeed")
            .expect("previous backup should exist");
        assert_eq!(previous.reason, "pre-rollback");
        let skill = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        assert_eq!(skill.local_modified, Some(false));
        assert!(skill.local_fingerprint.is_some());

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn delete_backup_removes_files_and_record() {
        let root = temp_dir("delete");
        let skill_dir = root.join("skill");
        let backup_root = root.join("backup-root");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("skill-1", &skill_dir, None))
            .expect("skill should upsert");
        let backup = create_backup(
            CreateBackupOptions {
                skill_id: "skill-1".to_string(),
                backup_root: backup_root.to_string_lossy().to_string(),
                reason: "manual".to_string(),
            },
            &mut store,
        )
        .expect("backup should create");

        delete_backup(&backup.backup_id, &mut store).expect("backup should delete");

        assert!(!Path::new(&backup.backup_path).exists());
        let stored = store
            .get_backup(&backup.backup_id)
            .expect("backup lookup should succeed");
        assert_eq!(stored, None);

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }
}
