use crate::audit::{write_audit_event, AuditAction, AuditEventInput};
use metis_storage::db::{SkillIndexStore, SourceRecord, StorageError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceInput {
    pub source_type: SourceType,
    pub url: String,
    pub repo_path: String,
    pub ref_: String,
    pub credential_ref: Option<String>,
    pub auto_update: bool,
    pub trusted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SourceType {
    Git,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Source {
    pub id: String,
    pub source_type: SourceType,
    pub url: String,
    pub repo_path: String,
    pub ref_: String,
    pub current_commit: Option<String>,
    pub remote_commit: Option<String>,
    pub last_checked_at: Option<String>,
    pub trusted: bool,
    pub auto_update: bool,
    pub credential_ref: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BindError {
    #[error("skill not found: {skill_id}")]
    SkillNotFound { skill_id: String },

    #[error("skill already bound to source: {existing_source_id}")]
    AlreadyBound { existing_source_id: String },

    #[error("storage error: {0}")]
    Storage(String),
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SourceLookupError {
    #[error("storage error: {0}")]
    Storage(String),
}

pub fn bind_source(
    skill_id: &str,
    input: SourceInput,
    store: &SkillIndexStore,
) -> Result<Source, BindError> {
    let skill = store
        .get_skill(skill_id)
        .map_err(BindError::from)?
        .ok_or_else(|| BindError::SkillNotFound {
            skill_id: skill_id.to_string(),
        })?;
    let source_id = stable_source_id(&input);

    if let Some(existing_source_id) = skill.source_id {
        if existing_source_id != source_id {
            return Err(BindError::AlreadyBound { existing_source_id });
        }
    }

    let source_record = input_to_record(source_id, input);
    store
        .upsert_source(&source_record)
        .map_err(BindError::from)?;
    store
        .bind_skill_source(skill_id, &source_record.id)
        .map_err(BindError::from)?;
    let _ = write_audit_event(
        store,
        AuditEventInput {
            skill_id: skill_id.to_string(),
            action: AuditAction::SourceBound,
            detail: Some(format!("bound git source {}", source_record.url)),
            commit_before: None,
            commit_after: source_record.current_commit.clone(),
            status: "success".to_string(),
            risk_summary: None,
        },
    );

    let stored = store
        .get_source(&source_record.id)
        .map_err(BindError::from)?
        .unwrap_or(source_record);

    Ok(record_to_source(stored))
}

pub fn unbind_source(skill_id: &str, store: &SkillIndexStore) -> Result<(), BindError> {
    store
        .get_skill(skill_id)
        .map_err(BindError::from)?
        .ok_or_else(|| BindError::SkillNotFound {
            skill_id: skill_id.to_string(),
        })?;
    store
        .unbind_skill_source(skill_id)
        .map_err(BindError::from)?;
    let _ = write_audit_event(
        store,
        AuditEventInput {
            skill_id: skill_id.to_string(),
            action: AuditAction::SourceUnbound,
            detail: Some("unbound source".to_string()),
            commit_before: None,
            commit_after: None,
            status: "success".to_string(),
            risk_summary: None,
        },
    );
    Ok(())
}

pub fn get_source(
    source_id: &str,
    store: &SkillIndexStore,
) -> Result<Option<Source>, SourceLookupError> {
    store
        .get_source(source_id)
        .map(|source| source.map(record_to_source))
        .map_err(SourceLookupError::from)
}

fn input_to_record(id: String, input: SourceInput) -> SourceRecord {
    SourceRecord {
        id,
        source_type: source_type_to_storage(&input.source_type),
        url: input.url,
        repo_path: input.repo_path,
        ref_: input.ref_,
        current_commit: None,
        remote_commit: None,
        last_checked_at: None,
        trusted: input.trusted,
        auto_update: input.auto_update,
        credential_ref: input.credential_ref,
        created_at: None,
        updated_at: None,
    }
}

fn record_to_source(record: SourceRecord) -> Source {
    Source {
        id: record.id,
        source_type: source_type_from_storage(&record.source_type),
        url: record.url,
        repo_path: record.repo_path,
        ref_: record.ref_,
        current_commit: record.current_commit,
        remote_commit: record.remote_commit,
        last_checked_at: record.last_checked_at,
        trusted: record.trusted,
        auto_update: record.auto_update,
        credential_ref: record.credential_ref,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

pub(crate) fn stable_source_id(input: &SourceInput) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source_type_to_storage(&input.source_type).as_bytes());
    hasher.update([0]);
    hasher.update(input.url.as_bytes());
    hasher.update([0]);
    hasher.update(input.repo_path.as_bytes());
    hasher.update([0]);
    hasher.update(input.ref_.as_bytes());
    let digest = hasher.finalize();
    let hex = digest
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    format!("source_{}", hex)
}

fn source_type_to_storage(source_type: &SourceType) -> String {
    match source_type {
        SourceType::Git => "git",
    }
    .to_string()
}

fn source_type_from_storage(source_type: &str) -> SourceType {
    match source_type {
        "git" => SourceType::Git,
        _ => SourceType::Git,
    }
}

impl From<StorageError> for BindError {
    fn from(error: StorageError) -> Self {
        BindError::Storage(error.to_string())
    }
}

impl From<StorageError> for SourceLookupError {
    fn from(error: StorageError) -> Self {
        SourceLookupError::Storage(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use metis_storage::db::{SkillIndexStore, SkillRecord};

    fn sample_skill(id: &str) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            agent_id: "codex".to_string(),
            name: "Example Skill".to_string(),
            description: Some("A skill with a source".to_string()),
            version: Some("1.0.0".to_string()),
            author: Some("Metis Team".to_string()),
            license: Some("MIT".to_string()),
            tags: vec!["workflow".to_string()],
            category: Some("workflow".to_string()),
            install_path: "/tmp/metis/skills/example".to_string(),
            scope: "user".to_string(),
            metadata_path: Some("/tmp/metis/skills/example/SKILL.md".to_string()),
            metadata_status: "found".to_string(),
            metadata_error: None,
            source_id: None,
            local_fingerprint: None,
            local_modified: None,
            last_scanned_at: "2026-06-19T10:00:00Z".to_string(),
            local_updated_at: None,
        }
    }

    fn sample_source_input() -> SourceInput {
        SourceInput {
            source_type: SourceType::Git,
            url: "https://github.com/example/metis-skills.git".to_string(),
            repo_path: "skills/example".to_string(),
            ref_: "main".to_string(),
            credential_ref: Some("github-main".to_string()),
            auto_update: false,
            trusted: true,
        }
    }

    #[test]
    fn bind_source_persists_source_and_links_existing_skill() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("skill-1"))
            .expect("skill should upsert");

        let source =
            bind_source("skill-1", sample_source_input(), &store).expect("source should bind");

        assert!(source.id.starts_with("source_"));
        assert_eq!(source.source_type, SourceType::Git);
        assert_eq!(source.repo_path, "skills/example");
        assert_eq!(source.ref_, "main");
        assert!(source.trusted);
        assert!(!source.auto_update);

        let stored_skill = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        assert_eq!(stored_skill.source_id.as_deref(), Some(source.id.as_str()));
        let audits = store
            .list_audit_events(&metis_storage::db::AuditEventFilter {
                skill_id: Some("skill-1".to_string()),
                action: Some("source_bound".to_string()),
                limit: 10,
                offset: 0,
            })
            .expect("audit events should list");
        assert_eq!(audits.len(), 1);
        assert_eq!(audits[0].status, "success");
    }

    #[test]
    fn bind_source_reuses_existing_source_for_same_url_path_and_ref() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("skill-1"))
            .expect("skill should upsert");
        let first = bind_source("skill-1", sample_source_input(), &store)
            .expect("first source should bind");
        let mut updated_input = sample_source_input();
        updated_input.auto_update = true;

        let second =
            bind_source("skill-1", updated_input, &store).expect("same source should rebind");

        assert_eq!(second.id, first.id);
        assert!(second.auto_update);
        assert_eq!(store.list_sources().expect("sources should list").len(), 1);
    }

    #[test]
    fn bind_source_rejects_different_source_when_skill_is_already_bound() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("skill-1"))
            .expect("skill should upsert");
        let first = bind_source("skill-1", sample_source_input(), &store)
            .expect("first source should bind");
        let mut different_input = sample_source_input();
        different_input.repo_path = "skills/other".to_string();

        let error = bind_source("skill-1", different_input, &store)
            .expect_err("different source should be rejected");

        assert_eq!(
            error,
            BindError::AlreadyBound {
                existing_source_id: first.id
            }
        );
    }

    #[test]
    fn unbind_source_clears_existing_skill_source() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("skill-1"))
            .expect("skill should upsert");
        bind_source("skill-1", sample_source_input(), &store).expect("source should bind");

        unbind_source("skill-1", &store).expect("source should unbind");

        let stored_skill = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        assert_eq!(stored_skill.source_id, None);
        let audits = store
            .list_audit_events(&metis_storage::db::AuditEventFilter {
                skill_id: Some("skill-1".to_string()),
                action: Some("source_unbound".to_string()),
                limit: 10,
                offset: 0,
            })
            .expect("audit events should list");
        assert_eq!(audits.len(), 1);
    }
}
