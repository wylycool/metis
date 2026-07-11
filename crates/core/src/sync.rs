use crate::local_state::check_local_modification;
use crate::update::RemoteCommitChecker;
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
pub struct SkillTargetRoot {
    pub agent_id: String,
    pub agent_name: String,
    pub root_path: String,
    pub root_available: bool,
    pub root_status: String,
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
    pub content_changed: Option<bool>,
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
    store: &mut SkillIndexStore,
) -> Result<Vec<SkillTarget>, String> {
    get_skill_targets_for_roots(source, default_skill_target_roots(), store)
}

pub fn get_skill_targets_for_roots(
    source: SkillTargetSource,
    roots: Vec<SkillTargetRoot>,
    store: &mut SkillIndexStore,
) -> Result<Vec<SkillTarget>, String> {
    get_skill_targets_for_roots_with_content_status(source, roots, store, |_, _, _| Ok(None))
}

pub fn get_skill_targets_for_source_with_checker<C: RemoteCommitChecker>(
    source: SkillTargetSource,
    store: &mut SkillIndexStore,
    checker: &C,
) -> Result<Vec<SkillTarget>, String> {
    get_skill_targets_for_roots_with_checker(source, default_skill_target_roots(), store, checker)
}

pub fn get_skill_targets_for_roots_with_checker<C: RemoteCommitChecker>(
    source: SkillTargetSource,
    roots: Vec<SkillTargetRoot>,
    store: &mut SkillIndexStore,
    checker: &C,
) -> Result<Vec<SkillTarget>, String> {
    get_skill_targets_for_roots_with_content_status(
        source,
        roots,
        store,
        |source_record, current_commit, target_commit| {
            Ok(checker
                .diff_summary(source_record, current_commit, target_commit)
                .ok()
                .map(|summary| summary.total_changes > 0))
        },
    )
}

fn default_skill_target_roots() -> Vec<SkillTargetRoot> {
    AdapterRegistry::default()
        .sync_target_adapters()
        .into_iter()
        .filter_map(|adapter| adapter.user_skill_root())
        .map(|root| {
            let root_available = matches!(&root.status, SkillInstallRootStatus::Available);
            let root_status = root_status_to_string(&root.status);
            SkillTargetRoot {
                agent_id: root.agent_id,
                agent_name: root.agent_name,
                root_path: root.path,
                root_available,
                root_status,
            }
        })
        .collect()
}

fn get_skill_targets_for_roots_with_content_status<F>(
    source: SkillTargetSource,
    roots: Vec<SkillTargetRoot>,
    store: &mut SkillIndexStore,
    mut content_changed_for_source: F,
) -> Result<Vec<SkillTarget>, String>
where
    F: FnMut(&SourceRecord, &str, &str) -> Result<Option<bool>, String>,
{
    let sources = store.list_sources().map_err(|error| error.to_string())?;
    let mut targets = Vec::with_capacity(roots.len());

    for root in roots {
        let install_path = Path::new(&root.root_path)
            .join(&source.install_name)
            .to_string_lossy()
            .to_string();
        let stored_skill = store
            .get_skill_by_agent_and_path(&root.agent_id, &install_path)
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
            .map(|skill| refreshed_indexed_state_from_skill(skill, stored_source, store))
            .transpose()?;
        let content_changed = target_content_changed(
            stored_source,
            indexed.as_ref(),
            source_matches,
            &source.commit,
            &mut content_changed_for_source,
        )?;
        let classification = classify_target_path(TargetPathEvaluation {
            root_available: root.root_available,
            path_exists,
            has_skill_md,
            indexed,
            expected_commit: source.commit.clone(),
            source_matches,
            content_changed,
        });

        targets.push(SkillTarget {
            agent_id: root.agent_id,
            agent_name: root.agent_name,
            root_path: root.root_path,
            install_path,
            status: classification.status,
            local_modified: classification.local_modified,
            skill_id: stored_skill.as_ref().map(|skill| skill.id.clone()),
            source_id: stored_skill.and_then(|skill| skill.source_id),
            root_available: root.root_available,
            root_status: root.root_status,
        });
    }

    Ok(targets)
}

pub fn target_content_changed<F>(
    stored_source: Option<&SourceRecord>,
    indexed: Option<&IndexedTargetState>,
    source_matches: bool,
    target_commit: &str,
    content_changed_for_source: &mut F,
) -> Result<Option<bool>, String>
where
    F: FnMut(&SourceRecord, &str, &str) -> Result<Option<bool>, String>,
{
    if !source_matches {
        return Ok(None);
    }
    let Some(source_record) = stored_source else {
        return Ok(None);
    };
    let Some(current_commit) = indexed.and_then(|state| state.current_commit.as_deref()) else {
        return Ok(None);
    };
    if current_commit == target_commit {
        return Ok(None);
    }

    content_changed_for_source(source_record, current_commit, target_commit)
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
        Some(_) if input.content_changed == Some(false) => SkillTargetStatus::UpToDate,
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

fn refreshed_indexed_state_from_skill(
    skill: &SkillRecord,
    source: Option<&SourceRecord>,
    store: &mut SkillIndexStore,
) -> Result<IndexedTargetState, String> {
    let local_modified = check_local_modification(&skill.id, store)
        .map(|result| result.local_modified)
        .unwrap_or_else(|_| skill.local_modified.unwrap_or(false));
    let mut indexed = indexed_state_from_skill(skill, source);
    indexed.local_modified = local_modified;

    Ok(indexed)
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
    use crate::local_state::capture_local_baseline;
    use metis_storage::db::{SkillIndexStore, SourceRecord};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn classify_target_reports_agent_root_unavailable_first() {
        let input = TargetPathEvaluation {
            root_available: false,
            path_exists: false,
            has_skill_md: false,
            indexed: None,
            expected_commit: "new".to_string(),
            source_matches: false,
            content_changed: None,
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
            content_changed: None,
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
            content_changed: None,
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
            content_changed: None,
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
            content_changed: None,
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
            content_changed: None,
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
            content_changed: None,
        });
        assert_eq!(update_available.status, SkillTargetStatus::UpdateAvailable);

        let commit_differs_but_content_matches = classify_target_path(TargetPathEvaluation {
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
            content_changed: Some(false),
        });
        assert_eq!(
            commit_differs_but_content_matches.status,
            SkillTargetStatus::UpToDate
        );
    }

    #[test]
    fn get_skill_targets_for_explicit_roots_uses_configured_paths() {
        let workspace = temp_dir("explicit-roots");
        let codex_root = workspace.join("codex-override");
        let custom_root = workspace.join("team-memory");
        fs::create_dir_all(&codex_root).expect("codex root should exist");
        fs::create_dir_all(&custom_root).expect("custom root should exist");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");

        let targets = get_skill_targets_for_roots(
            SkillTargetSource {
                url: "https://github.com/example/metis-skills.git".to_string(),
                repo_path: "skills/planner".to_string(),
                ref_: "main".to_string(),
                commit: "abc123".to_string(),
                install_name: "planner".to_string(),
            },
            vec![
                SkillTargetRoot {
                    agent_id: "codex".to_string(),
                    agent_name: "Codex".to_string(),
                    root_path: codex_root.to_string_lossy().to_string(),
                    root_available: true,
                    root_status: "available".to_string(),
                },
                SkillTargetRoot {
                    agent_id: "custom-team-memory".to_string(),
                    agent_name: "团队记忆".to_string(),
                    root_path: custom_root.to_string_lossy().to_string(),
                    root_available: true,
                    root_status: "available".to_string(),
                },
            ],
            &mut store,
        )
        .expect("explicit targets should load");

        assert_eq!(targets.len(), 2);
        assert_eq!(
            targets[0].root_path,
            codex_root.to_string_lossy().to_string()
        );
        assert_eq!(
            targets[0].install_path,
            codex_root.join("planner").to_string_lossy().to_string()
        );
        assert_eq!(targets[0].status, SkillTargetStatus::NotInstalled);
        assert_eq!(targets[1].agent_id, "custom-team-memory");
        assert_eq!(
            targets[1].install_path,
            custom_root.join("planner").to_string_lossy().to_string()
        );

        fs::remove_dir_all(workspace).expect("workspace should be removed");
    }

    #[test]
    fn refreshed_indexed_state_detects_local_modification_before_classifying_target() {
        let root = temp_dir("sync-local-modified");
        let skill_dir = root.join("skill");
        write_file(&skill_dir.join("SKILL.md"), "# Example\n");

        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        let source = sample_source("source-1", "new");
        store.upsert_source(&source).expect("source should upsert");
        store
            .upsert_skill(&sample_skill("skill-1", &skill_dir, Some("source-1")))
            .expect("skill should upsert");
        capture_local_baseline("skill-1", &mut store).expect("baseline should capture");
        write_file(&skill_dir.join("notes.md"), "local edit");

        let skill = store
            .get_skill("skill-1")
            .expect("skill lookup should work")
            .expect("skill should exist");
        let refreshed = refreshed_indexed_state_from_skill(&skill, Some(&source), &mut store)
            .expect("indexed state should refresh");

        fs::remove_dir_all(root).expect("workspace should be removed");
        assert!(refreshed.local_modified);
        assert_eq!(refreshed.current_commit.as_deref(), Some("new"));
    }

    #[test]
    fn target_content_changed_only_checks_matching_sources_with_different_commits() {
        let source = sample_source("source-1", "old");
        let indexed = IndexedTargetState {
            source_id: Some("source-1".to_string()),
            current_commit: Some("old".to_string()),
            local_modified: false,
        };
        let mut calls = Vec::new();
        let mut diff_probe =
            |source_record: &SourceRecord, current_commit: &str, target_commit: &str| {
                calls.push((
                    source_record.id.clone(),
                    current_commit.to_string(),
                    target_commit.to_string(),
                ));
                Ok(Some(false))
            };

        let content_changed =
            target_content_changed(Some(&source), Some(&indexed), true, "new", &mut diff_probe)
                .expect("content changed should be resolved");

        assert_eq!(content_changed, Some(false));
        assert_eq!(
            calls,
            vec![("source-1".to_string(), "old".to_string(), "new".to_string())]
        );

        let mut skipped_probe =
            |_: &SourceRecord, _: &str, _: &str| -> Result<Option<bool>, String> {
                panic!("diff should not run when source does not match")
            };
        assert_eq!(
            target_content_changed(
                Some(&source),
                Some(&indexed),
                false,
                "new",
                &mut skipped_probe
            )
            .expect("non-matching source should skip diff"),
            None
        );
    }

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("metis-core-sync-{}-{}", name, suffix));
        fs::create_dir_all(&root).expect("temp directory should be created");
        root
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent should be created");
        }
        fs::write(path, contents).expect("file should write");
    }

    fn sample_source(id: &str, current_commit: &str) -> SourceRecord {
        SourceRecord {
            id: id.to_string(),
            source_type: "git".to_string(),
            url: "file:///tmp/metis-sync.git".to_string(),
            repo_path: "skills/example".to_string(),
            ref_: "main".to_string(),
            current_commit: Some(current_commit.to_string()),
            remote_commit: Some(current_commit.to_string()),
            last_checked_at: None,
            trusted: true,
            auto_update: false,
            credential_ref: None,
            created_at: None,
            updated_at: None,
        }
    }

    fn sample_skill(id: &str, install_path: &Path, source_id: Option<&str>) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            agent_id: "codex".to_string(),
            name: "Example".to_string(),
            description: Some("Example skill".to_string()),
            version: None,
            author: None,
            license: None,
            tags: Vec::new(),
            category: None,
            install_path: install_path.to_string_lossy().to_string(),
            scope: "user".to_string(),
            metadata_path: Some(install_path.join("SKILL.md").to_string_lossy().to_string()),
            metadata_status: "found".to_string(),
            metadata_error: None,
            source_id: source_id.map(ToOwned::to_owned),
            local_fingerprint: None,
            local_modified: None,
            last_scanned_at: "2026-06-21T10:00:00Z".to_string(),
            local_updated_at: None,
        }
    }
}
