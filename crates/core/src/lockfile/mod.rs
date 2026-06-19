use crate::audit::{write_audit_event, AuditAction, AuditEventInput};
use metis_storage::db::{SkillIndexStore, SkillRecord, SourceRecord, StorageError};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportLockfileOptions {
    pub output_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockFile {
    pub version: String,
    pub exported_at: String,
    pub skills: Vec<LockFileEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LockFileEntry {
    pub name: String,
    pub agent_id: String,
    pub source_url: Option<String>,
    pub source_repo_path: Option<String>,
    pub source_ref: Option<String>,
    pub source_commit: Option<String>,
    pub install_path_hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportDiff {
    pub matched: Vec<SkillMatch>,
    pub outdated: Vec<SkillMismatch>,
    pub missing: Vec<LockFileEntry>,
    pub extra: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillMatch {
    pub lock_entry: LockFileEntry,
    pub local_skill_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillMismatch {
    pub lock_entry: LockFileEntry,
    pub local_skill_id: String,
    pub lock_commit: String,
    pub local_commit: String,
}

#[derive(Debug, thiserror::Error)]
pub enum LockfileError {
    #[error("storage error: {0}")]
    Storage(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn export_lockfile(
    options: ExportLockfileOptions,
    store: &SkillIndexStore,
) -> Result<LockFile, LockfileError> {
    let mut entries = Vec::new();
    for skill in store.list_skills().map_err(LockfileError::from)? {
        let source = match skill.source_id.as_deref() {
            Some(source_id) => store.get_source(source_id).map_err(LockfileError::from)?,
            None => None,
        };
        entries.push(LockFileEntry {
            name: skill.name.clone(),
            agent_id: skill.agent_id.clone(),
            source_url: source.as_ref().map(|source| source.url.clone()),
            source_repo_path: source.as_ref().map(|source| source.repo_path.clone()),
            source_ref: source.as_ref().map(|source| source.ref_.clone()),
            source_commit: source
                .as_ref()
                .and_then(|source| source.current_commit.clone()),
            install_path_hint: Path::new(&skill.install_path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string()),
        });
        let _ = write_audit_event(
            store,
            AuditEventInput {
                skill_id: skill.id.clone(),
                action: AuditAction::LockFileExported,
                detail: Some("lockfile exported".to_string()),
                commit_before: None,
                commit_after: source
                    .as_ref()
                    .and_then(|source| source.current_commit.clone()),
                status: "success".to_string(),
                risk_summary: None,
            },
        );
    }

    let lockfile = LockFile {
        version: "1".to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        skills: entries,
    };
    fs::write(
        &options.output_path,
        serde_json::to_string_pretty(&lockfile)?,
    )?;
    Ok(lockfile)
}

pub fn import_lockfile(
    file_path: impl AsRef<Path>,
    store: &SkillIndexStore,
) -> Result<ImportDiff, LockfileError> {
    let contents = fs::read_to_string(file_path)?;
    let lockfile = serde_json::from_str::<LockFile>(&contents)?;
    let local_skills = store.list_skills().map_err(LockfileError::from)?;
    let mut local_candidates = Vec::new();
    for skill in &local_skills {
        let source = match skill.source_id.as_deref() {
            Some(source_id) => store.get_source(source_id).map_err(LockfileError::from)?,
            None => None,
        };
        local_candidates.push((skill, source));
    }
    let mut matched = Vec::new();
    let mut outdated = Vec::new();
    let mut missing = Vec::new();
    let mut matched_local_ids = HashSet::new();

    for entry in lockfile.skills {
        let Some((local_skill, local_source)) =
            find_local_lockfile_match(&entry, &local_candidates)
        else {
            missing.push(entry);
            continue;
        };
        let local_commit = local_source
            .as_ref()
            .and_then(|source| source.current_commit.clone());

        match (entry.source_commit.as_ref(), local_commit.as_ref()) {
            (Some(lock_commit), Some(local_commit)) if lock_commit != local_commit => {
                outdated.push(SkillMismatch {
                    lock_entry: entry.clone(),
                    local_skill_id: local_skill.id.clone(),
                    lock_commit: lock_commit.clone(),
                    local_commit: local_commit.clone(),
                });
            }
            _ => matched.push(SkillMatch {
                lock_entry: entry.clone(),
                local_skill_id: local_skill.id.clone(),
            }),
        }
        matched_local_ids.insert(local_skill.id.clone());
        let _ = write_audit_event(
            store,
            AuditEventInput {
                skill_id: local_skill.id.clone(),
                action: AuditAction::LockFileImported,
                detail: Some("lockfile imported".to_string()),
                commit_before: local_commit,
                commit_after: entry.source_commit.clone(),
                status: "success".to_string(),
                risk_summary: None,
            },
        );
    }

    let mut extra = local_skills
        .iter()
        .filter(|skill| !matched_local_ids.contains(&skill.id))
        .map(|skill| skill.id.clone())
        .collect::<Vec<_>>();
    extra.sort();

    Ok(ImportDiff {
        matched,
        outdated,
        missing,
        extra,
    })
}

fn find_local_lockfile_match<'a>(
    entry: &LockFileEntry,
    local_candidates: &'a [(&'a SkillRecord, Option<SourceRecord>)],
) -> Option<(&'a SkillRecord, &'a Option<SourceRecord>)> {
    local_candidates.iter().find_map(|(skill, source)| {
        if skill.agent_id != entry.agent_id || skill.name != entry.name {
            return None;
        }
        if lock_entry_has_source_identity(entry) && !source_matches_lock_entry(source, entry) {
            return None;
        }
        Some((*skill, source))
    })
}

fn lock_entry_has_source_identity(entry: &LockFileEntry) -> bool {
    entry.source_url.is_some() || entry.source_repo_path.is_some() || entry.source_ref.is_some()
}

fn source_matches_lock_entry(source: &Option<SourceRecord>, entry: &LockFileEntry) -> bool {
    let Some(source) = source else {
        return false;
    };
    Some(source.url.as_str()) == entry.source_url.as_deref()
        && Some(source.repo_path.as_str()) == entry.source_repo_path.as_deref()
        && Some(source.ref_.as_str()) == entry.source_ref.as_deref()
}

impl From<StorageError> for LockfileError {
    fn from(error: StorageError) -> Self {
        LockfileError::Storage(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use metis_storage::db::{SkillIndexStore, SkillRecord, SourceRecord};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("metis-core-lockfile-{}-{}", name, suffix));
        fs::create_dir_all(&root).expect("temp directory should be created");
        root
    }

    fn sample_skill(id: &str, name: &str, source_id: Option<&str>) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            agent_id: "codex".to_string(),
            name: name.to_string(),
            description: Some("A skill in a lockfile".to_string()),
            version: Some("1.0.0".to_string()),
            author: Some("Metis Team".to_string()),
            license: Some("MIT".to_string()),
            tags: vec!["workflow".to_string()],
            category: Some("workflow".to_string()),
            install_path: format!("/tmp/metis/skills/{id}"),
            scope: "user".to_string(),
            metadata_path: Some(format!("/tmp/metis/skills/{id}/SKILL.md")),
            metadata_status: "found".to_string(),
            metadata_error: None,
            source_id: source_id.map(ToOwned::to_owned),
            local_fingerprint: None,
            local_modified: None,
            last_scanned_at: "2026-06-19T10:00:00Z".to_string(),
        }
    }

    fn sample_source(id: &str, current_commit: &str, credential_ref: Option<&str>) -> SourceRecord {
        SourceRecord {
            id: id.to_string(),
            source_type: "git".to_string(),
            url: "https://github.com/example/metis-skills.git".to_string(),
            repo_path: "skills/example".to_string(),
            ref_: "main".to_string(),
            current_commit: Some(current_commit.to_string()),
            remote_commit: None,
            last_checked_at: None,
            trusted: true,
            auto_update: false,
            credential_ref: credential_ref.map(ToOwned::to_owned),
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn export_lockfile_writes_json_without_credentials() {
        let root = temp_dir("export");
        let output = root.join("skills.lock.json");
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_source(&sample_source("source-1", "abc123", Some("github-main")))
            .expect("source should upsert");
        store
            .upsert_skill(&sample_skill("skill-1", "Example Skill", Some("source-1")))
            .expect("skill should upsert");

        let lockfile = export_lockfile(
            ExportLockfileOptions {
                output_path: output.clone(),
            },
            &store,
        )
        .expect("lockfile should export");

        let contents = fs::read_to_string(&output).expect("lockfile should read");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(lockfile.skills.len(), 1);
        assert_eq!(lockfile.skills[0].source_commit.as_deref(), Some("abc123"));
        assert!(!contents.contains("github-main"));
        assert!(!contents.to_ascii_lowercase().contains("token"));
    }

    #[test]
    fn import_lockfile_classifies_matched_outdated_missing_and_extra() {
        let root = temp_dir("import");
        let input = root.join("skills.lock.json");
        let lockfile = LockFile {
            version: "1".to_string(),
            exported_at: "2026-06-19T12:00:00Z".to_string(),
            skills: vec![
                LockFileEntry {
                    name: "Matched".to_string(),
                    agent_id: "codex".to_string(),
                    source_url: None,
                    source_repo_path: None,
                    source_ref: None,
                    source_commit: Some("abc123".to_string()),
                    install_path_hint: None,
                },
                LockFileEntry {
                    name: "Outdated".to_string(),
                    agent_id: "codex".to_string(),
                    source_url: None,
                    source_repo_path: None,
                    source_ref: None,
                    source_commit: Some("new456".to_string()),
                    install_path_hint: None,
                },
                LockFileEntry {
                    name: "Missing".to_string(),
                    agent_id: "codex".to_string(),
                    source_url: None,
                    source_repo_path: None,
                    source_ref: None,
                    source_commit: Some("miss789".to_string()),
                    install_path_hint: None,
                },
            ],
        };
        fs::write(&input, serde_json::to_string_pretty(&lockfile).unwrap())
            .expect("lockfile should write");
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_source(&sample_source("source-matched", "abc123", None))
            .expect("matched source should upsert");
        let mut outdated_source = sample_source("source-outdated", "old000", None);
        outdated_source.repo_path = "skills/outdated".to_string();
        store
            .upsert_source(&outdated_source)
            .expect("outdated source should upsert");
        store
            .upsert_skill(&sample_skill(
                "skill-matched",
                "Matched",
                Some("source-matched"),
            ))
            .expect("matched skill should upsert");
        store
            .upsert_skill(&sample_skill(
                "skill-outdated",
                "Outdated",
                Some("source-outdated"),
            ))
            .expect("outdated skill should upsert");
        store
            .upsert_skill(&sample_skill("skill-extra", "Extra", None))
            .expect("extra skill should upsert");

        let diff = import_lockfile(input.as_path(), &store).expect("lockfile should import");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(diff.matched.len(), 1);
        assert_eq!(diff.outdated.len(), 1);
        assert_eq!(diff.missing.len(), 1);
        assert_eq!(diff.extra, vec!["skill-extra".to_string()]);
    }

    #[test]
    fn import_lockfile_uses_source_identity_when_names_collide() {
        let root = temp_dir("import-name-collision");
        let input = root.join("skills.lock.json");
        let lockfile = LockFile {
            version: "1".to_string(),
            exported_at: "2026-06-19T12:00:00Z".to_string(),
            skills: vec![LockFileEntry {
                name: "Shared Name".to_string(),
                agent_id: "codex".to_string(),
                source_url: Some("https://github.com/example/source-a.git".to_string()),
                source_repo_path: Some("skills/shared".to_string()),
                source_ref: Some("main".to_string()),
                source_commit: Some("aaa111".to_string()),
                install_path_hint: None,
            }],
        };
        fs::write(&input, serde_json::to_string_pretty(&lockfile).unwrap())
            .expect("lockfile should write");
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let mut source_a = sample_source("source-a", "aaa111", None);
        source_a.url = "https://github.com/example/source-a.git".to_string();
        source_a.repo_path = "skills/shared".to_string();
        let mut source_b = sample_source("source-b", "bbb222", None);
        source_b.url = "https://github.com/example/source-b.git".to_string();
        source_b.repo_path = "skills/shared".to_string();
        store
            .upsert_source(&source_a)
            .expect("source a should upsert");
        store
            .upsert_source(&source_b)
            .expect("source b should upsert");
        store
            .upsert_skill(&sample_skill("skill-a", "Shared Name", Some("source-a")))
            .expect("skill a should upsert");
        store
            .upsert_skill(&sample_skill("skill-b", "Shared Name", Some("source-b")))
            .expect("skill b should upsert");

        let diff = import_lockfile(input.as_path(), &store).expect("lockfile should import");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_eq!(diff.matched.len(), 1);
        assert_eq!(diff.matched[0].local_skill_id, "skill-a");
        assert!(diff.outdated.is_empty());
        assert!(diff.missing.is_empty());
    }
}
