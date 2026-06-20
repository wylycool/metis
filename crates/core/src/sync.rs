use metis_adapters::registry::AdapterRegistry;
use metis_adapters::traits::SkillInstallRootStatus;
use metis_storage::db::{SkillIndexStore, SkillRecord, SourceRecord};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillTargetSource {
    pub url: String,
    pub repo_path: String,
    pub ref_: String,
    pub commit: String,
    pub install_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillTarget {
    pub agent_id: String,
    pub agent_name: String,
    pub root_path: String,
    pub install_path: String,
    pub status: SkillTargetStatus,
    pub local_modified: bool,
    pub skill_id: Option<String>,
    pub source_id: Option<String>,
    pub root_available: bool,
    pub root_status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SkillTargetStatus {
    NotInstalled,
    InstalledUnbound,
    InstalledBound,
    UpToDate,
    UpdateAvailable,
    ConflictNonSkill,
    AgentRootUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetPathEvaluation {
    pub root_available: bool,
    pub path_exists: bool,
    pub has_skill_md: bool,
    pub indexed: Option<IndexedTargetState>,
    pub expected_commit: String,
    pub source_matches: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexedTargetState {
    pub source_id: Option<String>,
    pub current_commit: Option<String>,
    pub local_modified: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetPathClassification {
    pub status: SkillTargetStatus,
    pub local_modified: bool,
}

pub fn get_skill_targets_for_source(
    source: SkillTargetSource,
    store: &SkillIndexStore,
) -> Result<Vec<SkillTarget>, String> {
    let registry = AdapterRegistry::default();
    let sources = store.list_sources().map_err(|error| error.to_string())?;
    let mut targets = Vec::new();

    for adapter in registry.sync_target_adapters() {
        let Some(root) = adapter.user_skill_root() else {
            continue;
        };
        let install_path = Path::new(&root.path)
            .join(&source.install_name)
            .to_string_lossy()
            .to_string();
        let stored_skill = store
            .get_skill_by_agent_and_path(adapter.agent_id(), &install_path)
            .map_err(|error| error.to_string())?;
        let stored_source = stored_skill
            .as_ref()
            .and_then(|skill| skill.source_id.as_deref())
            .and_then(|source_id| sources.iter().find(|record| record.id == source_id));
        let source_matches = stored_source
            .map(|record| source_record_matches(record, &source))
            .unwrap_or(false);
        let path = Path::new(&install_path);
        let path_exists = path.exists();
        let has_skill_md = path.join("SKILL.md").is_file();
        let indexed = stored_skill
            .as_ref()
            .map(|skill| indexed_state_from_skill(skill, stored_source));
        let classification = classify_target_path(TargetPathEvaluation {
            root_available: matches!(root.status, SkillInstallRootStatus::Available),
            path_exists,
            has_skill_md,
            indexed,
            expected_commit: source.commit.clone(),
            source_matches,
        });

        targets.push(SkillTarget {
            agent_id: root.agent_id,
            agent_name: root.agent_name,
            root_path: root.path,
            install_path,
            status: classification.status,
            local_modified: classification.local_modified,
            skill_id: stored_skill.as_ref().map(|skill| skill.id.clone()),
            source_id: stored_skill.and_then(|skill| skill.source_id),
            root_available: matches!(root.status, SkillInstallRootStatus::Available),
            root_status: root_status_to_string(&root.status),
        });
    }

    Ok(targets)
}

pub fn classify_target_path(input: TargetPathEvaluation) -> TargetPathClassification {
    if !input.root_available {
        return TargetPathClassification {
            status: SkillTargetStatus::AgentRootUnavailable,
            local_modified: input
                .indexed
                .as_ref()
                .map(|indexed| indexed.local_modified)
                .unwrap_or(false),
        };
    }
    if input.path_exists && !input.has_skill_md {
        return TargetPathClassification {
            status: SkillTargetStatus::ConflictNonSkill,
            local_modified: false,
        };
    }
    if !input.path_exists {
        return TargetPathClassification {
            status: SkillTargetStatus::NotInstalled,
            local_modified: false,
        };
    }

    let Some(indexed) = input.indexed else {
        return TargetPathClassification {
            status: SkillTargetStatus::InstalledUnbound,
            local_modified: false,
        };
    };
    if indexed.source_id.is_none() {
        return TargetPathClassification {
            status: SkillTargetStatus::InstalledUnbound,
            local_modified: indexed.local_modified,
        };
    }
    if !input.source_matches {
        return TargetPathClassification {
            status: SkillTargetStatus::InstalledBound,
            local_modified: indexed.local_modified,
        };
    }

    let status = match indexed.current_commit {
        Some(current_commit) if current_commit == input.expected_commit => {
            SkillTargetStatus::UpToDate
        }
        Some(_) => SkillTargetStatus::UpdateAvailable,
        None => SkillTargetStatus::InstalledBound,
    };

    TargetPathClassification {
        status,
        local_modified: indexed.local_modified,
    }
}

fn indexed_state_from_skill(
    skill: &SkillRecord,
    source: Option<&SourceRecord>,
) -> IndexedTargetState {
    IndexedTargetState {
        source_id: skill.source_id.clone(),
        current_commit: source.and_then(|record| record.current_commit.clone()),
        local_modified: skill.local_modified.unwrap_or(false),
    }
}

fn source_record_matches(record: &SourceRecord, source: &SkillTargetSource) -> bool {
    record.url == source.url && record.repo_path == source.repo_path && record.ref_ == source.ref_
}

fn root_status_to_string(status: &SkillInstallRootStatus) -> String {
    match status {
        SkillInstallRootStatus::Available => "available",
        SkillInstallRootStatus::Missing => "missing",
        SkillInstallRootStatus::NotReadable => "not_readable",
        SkillInstallRootStatus::NotWritable => "not_writable",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_target_reports_agent_root_unavailable_first() {
        let input = TargetPathEvaluation {
            root_available: false,
            path_exists: false,
            has_skill_md: false,
            indexed: None,
            expected_commit: "new".to_string(),
            source_matches: false,
        };

        assert_eq!(
            classify_target_path(input).status,
            SkillTargetStatus::AgentRootUnavailable
        );
    }

    #[test]
    fn classify_target_reports_conflict_before_install_states() {
        let input = TargetPathEvaluation {
            root_available: true,
            path_exists: true,
            has_skill_md: false,
            indexed: None,
            expected_commit: "new".to_string(),
            source_matches: false,
        };

        assert_eq!(
            classify_target_path(input).status,
            SkillTargetStatus::ConflictNonSkill
        );
    }

    #[test]
    fn classify_target_maps_install_and_update_states() {
        let not_installed = classify_target_path(TargetPathEvaluation {
            root_available: true,
            path_exists: false,
            has_skill_md: false,
            indexed: None,
            expected_commit: "new".to_string(),
            source_matches: false,
        });
        assert_eq!(not_installed.status, SkillTargetStatus::NotInstalled);

        let installed_unbound = classify_target_path(TargetPathEvaluation {
            root_available: true,
            path_exists: true,
            has_skill_md: true,
            indexed: Some(IndexedTargetState {
                source_id: None,
                current_commit: None,
                local_modified: true,
            }),
            expected_commit: "new".to_string(),
            source_matches: false,
        });
        assert_eq!(
            installed_unbound.status,
            SkillTargetStatus::InstalledUnbound
        );
        assert!(installed_unbound.local_modified);

        let installed_bound = classify_target_path(TargetPathEvaluation {
            root_available: true,
            path_exists: true,
            has_skill_md: true,
            indexed: Some(IndexedTargetState {
                source_id: Some("source-1".to_string()),
                current_commit: None,
                local_modified: false,
            }),
            expected_commit: "new".to_string(),
            source_matches: true,
        });
        assert_eq!(installed_bound.status, SkillTargetStatus::InstalledBound);

        let up_to_date = classify_target_path(TargetPathEvaluation {
            root_available: true,
            path_exists: true,
            has_skill_md: true,
            indexed: Some(IndexedTargetState {
                source_id: Some("source-1".to_string()),
                current_commit: Some("new".to_string()),
                local_modified: false,
            }),
            expected_commit: "new".to_string(),
            source_matches: true,
        });
        assert_eq!(up_to_date.status, SkillTargetStatus::UpToDate);

        let update_available = classify_target_path(TargetPathEvaluation {
            root_available: true,
            path_exists: true,
            has_skill_md: true,
            indexed: Some(IndexedTargetState {
                source_id: Some("source-1".to_string()),
                current_commit: Some("old".to_string()),
                local_modified: false,
            }),
            expected_commit: "new".to_string(),
            source_matches: true,
        });
        assert_eq!(update_available.status, SkillTargetStatus::UpdateAvailable);
    }
}
