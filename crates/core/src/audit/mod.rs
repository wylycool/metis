use metis_storage::db::{AuditEventFilter, AuditEventRecord, SkillIndexStore, StorageError};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditQuery {
    pub skill_id: Option<String>,
    pub action: Option<AuditAction>,
    pub limit: u32,
    pub offset: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuditAction {
    SourceBound,
    SourceUnbound,
    UpdateChecked,
    UpdateApplied,
    UpdateFailed,
    UpdateBlocked,
    RollbackApplied,
    RollbackFailed,
    BackupDeleted,
    LockFileExported,
    LockFileImported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: String,
    pub skill_id: String,
    pub action: AuditAction,
    pub detail: Option<String>,
    pub commit_before: Option<String>,
    pub commit_after: Option<String>,
    pub status: String,
    pub risk_summary: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct AuditEventInput {
    pub skill_id: String,
    pub action: AuditAction,
    pub detail: Option<String>,
    pub commit_before: Option<String>,
    pub commit_after: Option<String>,
    pub status: String,
    pub risk_summary: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum AuditError {
    #[error("storage error: {0}")]
    Storage(String),
}

pub fn query_audit_log(
    query: AuditQuery,
    store: &SkillIndexStore,
) -> Result<Vec<AuditEvent>, AuditError> {
    let filter = AuditEventFilter {
        skill_id: query.skill_id,
        action: query.action.as_ref().map(audit_action_to_storage),
        limit: query.limit,
        offset: query.offset,
    };
    let records = store.list_audit_events(&filter).map_err(AuditError::from)?;
    Ok(records.into_iter().map(record_to_audit_event).collect())
}

pub(crate) fn write_audit_event(
    store: &SkillIndexStore,
    input: AuditEventInput,
) -> Result<(), AuditError> {
    let event = AuditEventRecord {
        id: format!("audit_{}", uuid::Uuid::new_v4().simple()),
        skill_id: input.skill_id,
        action: audit_action_to_storage(&input.action),
        detail: input.detail,
        commit_before: input.commit_before,
        commit_after: input.commit_after,
        status: input.status,
        risk_summary: input.risk_summary,
        created_at: Some(chrono::Utc::now().to_rfc3339()),
    };
    store.insert_audit_event(&event).map_err(AuditError::from)
}

fn record_to_audit_event(record: AuditEventRecord) -> AuditEvent {
    AuditEvent {
        id: record.id,
        skill_id: record.skill_id,
        action: audit_action_from_storage(&record.action),
        detail: record.detail,
        commit_before: record.commit_before,
        commit_after: record.commit_after,
        status: record.status,
        risk_summary: record.risk_summary,
        created_at: record.created_at,
    }
}

fn audit_action_to_storage(action: &AuditAction) -> String {
    match action {
        AuditAction::SourceBound => "source_bound",
        AuditAction::SourceUnbound => "source_unbound",
        AuditAction::UpdateChecked => "update_checked",
        AuditAction::UpdateApplied => "update_applied",
        AuditAction::UpdateFailed => "update_failed",
        AuditAction::UpdateBlocked => "update_blocked",
        AuditAction::RollbackApplied => "rollback_applied",
        AuditAction::RollbackFailed => "rollback_failed",
        AuditAction::BackupDeleted => "backup_deleted",
        AuditAction::LockFileExported => "lockfile_exported",
        AuditAction::LockFileImported => "lockfile_imported",
    }
    .to_string()
}

fn audit_action_from_storage(action: &str) -> AuditAction {
    match action {
        "source_bound" => AuditAction::SourceBound,
        "source_unbound" => AuditAction::SourceUnbound,
        "update_checked" => AuditAction::UpdateChecked,
        "update_applied" => AuditAction::UpdateApplied,
        "update_failed" => AuditAction::UpdateFailed,
        "update_blocked" => AuditAction::UpdateBlocked,
        "rollback_applied" => AuditAction::RollbackApplied,
        "rollback_failed" => AuditAction::RollbackFailed,
        "backup_deleted" => AuditAction::BackupDeleted,
        "lockfile_exported" => AuditAction::LockFileExported,
        "lockfile_imported" => AuditAction::LockFileImported,
        _ => AuditAction::UpdateFailed,
    }
}

impl From<StorageError> for AuditError {
    fn from(error: StorageError) -> Self {
        AuditError::Storage(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use metis_storage::db::{AuditEventRecord, SkillIndexStore, SkillRecord};

    fn sample_skill(id: &str) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            agent_id: "codex".to_string(),
            name: "Example Skill".to_string(),
            description: Some("A skill with audit events".to_string()),
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
            source_id: None,
            local_fingerprint: None,
            local_modified: None,
            last_scanned_at: "2026-06-19T10:00:00Z".to_string(),
        }
    }

    #[test]
    fn query_audit_log_filters_by_skill_and_action() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("skill-1"))
            .expect("skill should upsert");
        store
            .insert_audit_event(&AuditEventRecord {
                id: "audit-1".to_string(),
                skill_id: "skill-1".to_string(),
                action: "source_bound".to_string(),
                detail: Some("bound source".to_string()),
                commit_before: None,
                commit_after: None,
                status: "success".to_string(),
                risk_summary: None,
                created_at: Some("2026-06-19T12:00:00Z".to_string()),
            })
            .expect("audit event should insert");

        let events = query_audit_log(
            AuditQuery {
                skill_id: Some("skill-1".to_string()),
                action: Some(AuditAction::SourceBound),
                limit: 10,
                offset: 0,
            },
            &store,
        )
        .expect("audit events should query");

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].action, AuditAction::SourceBound);
        assert_eq!(events[0].detail.as_deref(), Some("bound source"));
    }
}
