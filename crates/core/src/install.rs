use crate::audit::{write_audit_event, AuditAction, AuditEventInput};
use crate::local_state::capture_local_baseline;
use crate::rollback::{create_backup, CreateBackupOptions};
use crate::source::{bind_source, SourceInput, SourceType};
use crate::sync::SkillTargetSource;
use crate::update::RemoteCommitChecker;
use chrono::Utc;
use metis_adapters::standard::parse_standard_skill_metadata;
use metis_security::checker::scan_directory;
use metis_security::findings::SecuritySeverity;
use metis_storage::backup::replace_skill_directory;
use metis_storage::db::{SkillIndexStore, SkillRecord, SourceRecord};
use metis_storage::manifest::compute_local_updated_at;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstallRemoteSkillOptions {
    pub source: SkillTargetSource,
    pub targets: Vec<InstallSkillTarget>,
    pub backup_root: String,
    pub cache_dir: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstallSkillTarget {
    pub agent_id: String,
    pub agent_name: String,
    pub install_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstallRemoteSkillResult {
    pub targets: Vec<InstallTargetResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstallTargetResult {
    pub agent_id: String,
    pub install_path: String,
    pub status: InstallTargetStatus,
    pub reason: Option<String>,
    pub skill_id: Option<String>,
    pub backup_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum InstallTargetStatus {
    Installed,
    Updated,
    Skipped,
    Failed,
}

pub fn install_remote_skill_to_targets<C: RemoteCommitChecker>(
    options: InstallRemoteSkillOptions,
    store: &mut SkillIndexStore,
    checker: &C,
) -> Result<InstallRemoteSkillResult, String> {
    let mut results = Vec::new();

    for target in &options.targets {
        results.push(install_one_target(&options, target, store, checker));
    }

    Ok(InstallRemoteSkillResult { targets: results })
}

fn install_one_target<C: RemoteCommitChecker>(
    options: &InstallRemoteSkillOptions,
    target: &InstallSkillTarget,
    store: &mut SkillIndexStore,
    checker: &C,
) -> InstallTargetResult {
    match try_install_one_target(options, target, store, checker) {
        Ok(result) => result,
        Err(reason) => InstallTargetResult {
            agent_id: target.agent_id.clone(),
            install_path: target.install_path.clone(),
            status: InstallTargetStatus::Failed,
            reason: Some(reason),
            skill_id: None,
            backup_id: None,
        },
    }
}

fn try_install_one_target<C: RemoteCommitChecker>(
    options: &InstallRemoteSkillOptions,
    target: &InstallSkillTarget,
    store: &mut SkillIndexStore,
    checker: &C,
) -> Result<InstallTargetResult, String> {
    let install_path = Path::new(&target.install_path);
    if install_path.exists() && !install_path.join("SKILL.md").is_file() {
        return Ok(skipped(target, "conflict_non_skill", None));
    }

    let existing_skill = store
        .get_skill_by_agent_and_path(&target.agent_id, &target.install_path)
        .map_err(|error| error.to_string())?;
    if let Some(existing_skill) = existing_skill.as_ref() {
        if let Some(source_id) = existing_skill.source_id.as_deref() {
            let source = store
                .get_source(source_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| format!("source not found: {source_id}"))?;
            if !source_matches(&source, &options.source) {
                return Ok(skipped(
                    target,
                    "installed_bound",
                    Some(existing_skill.id.clone()),
                ));
            }
        }
    }

    let source_record = source_record_for_install(&options.source);
    let checkout = checker
        .checkout_to_cache(&source_record, &options.source.commit, &options.cache_dir)
        .map_err(|error| format!("checkout failed: {error}"))?;
    let security_report = scan_directory(&checkout.skill_dir).map_err(|error| error.to_string())?;
    if security_report
        .findings
        .iter()
        .any(|finding| finding.severity == SecuritySeverity::High)
    {
        return Ok(skipped(target, "security_blocked", None));
    }

    let backup_id = if install_path.exists() {
        let backup = create_backup(
            CreateBackupOptions {
                skill_id: existing_skill
                    .as_ref()
                    .map(|skill| skill.id.clone())
                    .unwrap_or_else(|| stable_skill_id(&target.agent_id, &target.install_path)),
                backup_root: options.backup_root.clone(),
                reason: "pre-sync".to_string(),
            },
            store,
        )
        .map_err(|error| error.to_string())?;
        Some(backup.backup_id)
    } else {
        None
    };

    if let Some(parent) = install_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    replace_skill_directory(&checkout.skill_dir, install_path)
        .map_err(|error| error.to_string())?;
    let metadata =
        parse_standard_skill_metadata(&target.install_path).map_err(|error| error.to_string())?;
    let skill_id = existing_skill
        .as_ref()
        .map(|skill| skill.id.clone())
        .unwrap_or_else(|| stable_skill_id(&target.agent_id, &target.install_path));
    let skill_record = SkillRecord {
        id: skill_id.clone(),
        agent_id: target.agent_id.clone(),
        name: metadata.name,
        description: metadata.description,
        version: metadata.version,
        author: metadata.author,
        license: metadata.license,
        tags: metadata.tags,
        category: metadata
            .category
            .map(|category| format!("{:?}", category).to_lowercase()),
        install_path: target.install_path.clone(),
        scope: "user".to_string(),
        metadata_path: Some(install_path.join("SKILL.md").to_string_lossy().to_string()),
        metadata_status: "found".to_string(),
        metadata_error: None,
        source_id: existing_skill.and_then(|skill| skill.source_id),
        local_fingerprint: None,
        local_modified: Some(false),
        last_scanned_at: Utc::now().to_rfc3339(),
        local_updated_at: compute_local_updated_at(install_path)
            .map_err(|error| error.to_string())?,
    };
    store
        .upsert_skill(&skill_record)
        .map_err(|error| error.to_string())?;
    let source = bind_source(
        &skill_id,
        SourceInput {
            source_type: SourceType::Git,
            url: options.source.url.clone(),
            repo_path: options.source.repo_path.clone(),
            ref_: options.source.ref_.clone(),
            credential_ref: None,
            auto_update: false,
            trusted: false,
        },
        store,
    )
    .map_err(|error| error.to_string())?;
    store
        .update_source_check_result(
            &source.id,
            Some(&options.source.commit),
            Some(&options.source.commit),
            &Utc::now().to_rfc3339(),
        )
        .map_err(|error| error.to_string())?;
    capture_local_baseline(&skill_id, store).map_err(|error| error.to_string())?;
    let _ = write_audit_event(
        store,
        AuditEventInput {
            skill_id: skill_id.clone(),
            action: AuditAction::UpdateApplied,
            detail: Some("cross-agent skill sync applied".to_string()),
            commit_before: None,
            commit_after: Some(options.source.commit.clone()),
            status: "success".to_string(),
            risk_summary: serde_json::to_string(&security_report.findings).ok(),
        },
    );

    Ok(InstallTargetResult {
        agent_id: target.agent_id.clone(),
        install_path: target.install_path.clone(),
        status: if backup_id.is_some() {
            InstallTargetStatus::Updated
        } else {
            InstallTargetStatus::Installed
        },
        reason: None,
        skill_id: Some(skill_id),
        backup_id,
    })
}

fn skipped(
    target: &InstallSkillTarget,
    reason: &str,
    skill_id: Option<String>,
) -> InstallTargetResult {
    InstallTargetResult {
        agent_id: target.agent_id.clone(),
        install_path: target.install_path.clone(),
        status: InstallTargetStatus::Skipped,
        reason: Some(reason.to_string()),
        skill_id,
        backup_id: None,
    }
}

fn source_record_for_install(source: &SkillTargetSource) -> SourceRecord {
    SourceRecord {
        id: "remote-install".to_string(),
        source_type: "git".to_string(),
        url: source.url.clone(),
        repo_path: source.repo_path.clone(),
        ref_: source.ref_.clone(),
        current_commit: Some(source.commit.clone()),
        remote_commit: Some(source.commit.clone()),
        last_checked_at: None,
        trusted: false,
        auto_update: false,
        credential_ref: None,
        created_at: None,
        updated_at: None,
    }
}

fn source_matches(record: &SourceRecord, source: &SkillTargetSource) -> bool {
    record.url == source.url && record.repo_path == source.repo_path && record.ref_ == source.ref_
}

fn stable_skill_id(agent_id: &str, install_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(agent_id.as_bytes());
    hasher.update([0]);
    hasher.update(install_path.as_bytes());
    let digest = hasher.finalize();
    let hex = digest
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    format!("skill_{}", hex)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::update::{CheckoutResult, DiffDetail, DiffSummary, RemoteCommitChecker};
    use metis_storage::db::SkillIndexStore;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct FakeInstallChecker {
        checkout: CheckoutResult,
    }

    impl RemoteCommitChecker for FakeInstallChecker {
        fn remote_commit(&self, _source: &SourceRecord) -> Result<String, String> {
            Ok("new".to_string())
        }

        fn diff_summary(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<DiffSummary, String> {
            unreachable!("install should not request diff summary")
        }

        fn commits_behind(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<u32, String> {
            unreachable!("install should not request commits behind")
        }

        fn diff_detail(
            &self,
            _source: &SourceRecord,
            _current_commit: &str,
            _target_commit: &str,
        ) -> Result<DiffDetail, String> {
            unreachable!("install should not request diff detail")
        }

        fn checkout_to_cache(
            &self,
            _source: &SourceRecord,
            _target_commit: &str,
            _cache_dir: &str,
        ) -> Result<CheckoutResult, String> {
            Ok(self.checkout.clone())
        }
    }

    #[test]
    fn install_remote_skill_to_targets_installs_new_target_and_indexes_it() {
        let workspace = temp_dir("install-new");
        let checkout_skill = write_skill(&workspace.join("checkout"), "remote", "Remote Skill");
        let install_path = workspace.join("codex-skills").join("remote");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");

        let result = install_remote_skill_to_targets(
            InstallRemoteSkillOptions {
                source: SkillTargetSource {
                    url: "https://github.com/example/metis-skills.git".to_string(),
                    repo_path: "skills/remote".to_string(),
                    ref_: "main".to_string(),
                    commit: "new".to_string(),
                    install_name: "remote".to_string(),
                },
                targets: vec![InstallSkillTarget {
                    agent_id: "codex".to_string(),
                    agent_name: "Codex".to_string(),
                    install_path: install_path.to_string_lossy().to_string(),
                }],
                backup_root: workspace.join("backups").to_string_lossy().to_string(),
                cache_dir: workspace.join("cache").to_string_lossy().to_string(),
            },
            &mut store,
            &FakeInstallChecker {
                checkout: CheckoutResult {
                    checkout_dir: workspace.join("checkout").to_string_lossy().to_string(),
                    skill_dir: checkout_skill.to_string_lossy().to_string(),
                },
            },
        )
        .expect("install should complete");

        assert_eq!(result.targets.len(), 1);
        assert_eq!(result.targets[0].status, InstallTargetStatus::Installed);
        assert!(install_path.join("SKILL.md").is_file());
        let stored = store
            .get_skill_by_agent_and_path("codex", &install_path.to_string_lossy())
            .expect("lookup should succeed")
            .expect("skill should be indexed");
        assert_eq!(stored.name, "Remote Skill");
        assert!(stored.source_id.is_some());
        let backups = store
            .list_backups(&stored.id)
            .expect("backup list should load");
        assert!(backups.is_empty());

        fs::remove_dir_all(workspace).expect("workspace should be removed");
    }

    #[test]
    fn install_remote_skill_to_targets_overwrites_local_modified_existing_skill_after_backup() {
        let workspace = temp_dir("install-local-modified");
        let checkout_skill = write_skill(&workspace.join("checkout"), "remote", "Remote Skill");
        let install_path = write_skill(&workspace.join("codex-skills"), "remote", "Old Skill");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&SkillRecord {
                id: "skill-codex-remote".to_string(),
                agent_id: "codex".to_string(),
                name: "Old Skill".to_string(),
                description: None,
                version: None,
                author: None,
                license: None,
                tags: vec![],
                category: None,
                install_path: install_path.to_string_lossy().to_string(),
                scope: "user".to_string(),
                metadata_path: Some(install_path.join("SKILL.md").to_string_lossy().to_string()),
                metadata_status: "found".to_string(),
                metadata_error: None,
                source_id: None,
                local_fingerprint: Some("old".to_string()),
                local_modified: Some(true),
                last_scanned_at: "now".to_string(),
                local_updated_at: None,
            })
            .expect("skill should upsert");

        let result = install_remote_skill_to_targets(
            InstallRemoteSkillOptions {
                source: SkillTargetSource {
                    url: "https://github.com/example/metis-skills.git".to_string(),
                    repo_path: "skills/remote".to_string(),
                    ref_: "main".to_string(),
                    commit: "new".to_string(),
                    install_name: "remote".to_string(),
                },
                targets: vec![InstallSkillTarget {
                    agent_id: "codex".to_string(),
                    agent_name: "Codex".to_string(),
                    install_path: install_path.to_string_lossy().to_string(),
                }],
                backup_root: workspace.join("backups").to_string_lossy().to_string(),
                cache_dir: workspace.join("cache").to_string_lossy().to_string(),
            },
            &mut store,
            &FakeInstallChecker {
                checkout: CheckoutResult {
                    checkout_dir: workspace.join("checkout").to_string_lossy().to_string(),
                    skill_dir: checkout_skill.to_string_lossy().to_string(),
                },
            },
        )
        .expect("install batch should continue");

        assert_eq!(result.targets[0].status, InstallTargetStatus::Updated);
        assert_eq!(result.targets[0].reason, None);
        assert!(result.targets[0].backup_id.is_some());
        assert_eq!(
            fs::read_to_string(install_path.join("SKILL.md")).expect("new file should replace old"),
            "---
name: Remote Skill
---
"
        );
        let stored = store
            .get_skill("skill-codex-remote")
            .expect("skill lookup should succeed")
            .expect("skill should remain indexed");
        assert_eq!(stored.local_modified, Some(false));
        let backups = store
            .list_backups("skill-codex-remote")
            .expect("backup list should load");
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].reason, "pre-sync");

        fs::remove_dir_all(workspace).expect("workspace should be removed");
    }

    #[test]
    fn install_remote_skill_to_targets_skips_conflict_and_continues_other_targets() {
        let workspace = temp_dir("install-partial");
        let checkout_skill = write_skill(&workspace.join("checkout"), "remote", "Remote Skill");
        let conflict_path = workspace.join("codex-skills").join("remote");
        fs::create_dir_all(&conflict_path).expect("conflict dir should exist");
        fs::write(conflict_path.join("README.md"), "not a skill")
            .expect("conflict file should write");
        let hermes_path = workspace.join("hermes-skills").join("remote");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");

        let result = install_remote_skill_to_targets(
            InstallRemoteSkillOptions {
                source: SkillTargetSource {
                    url: "https://github.com/example/metis-skills.git".to_string(),
                    repo_path: "skills/remote".to_string(),
                    ref_: "main".to_string(),
                    commit: "new".to_string(),
                    install_name: "remote".to_string(),
                },
                targets: vec![
                    InstallSkillTarget {
                        agent_id: "codex".to_string(),
                        agent_name: "Codex".to_string(),
                        install_path: conflict_path.to_string_lossy().to_string(),
                    },
                    InstallSkillTarget {
                        agent_id: "hermes".to_string(),
                        agent_name: "Hermes".to_string(),
                        install_path: hermes_path.to_string_lossy().to_string(),
                    },
                ],
                backup_root: workspace.join("backups").to_string_lossy().to_string(),
                cache_dir: workspace.join("cache").to_string_lossy().to_string(),
            },
            &mut store,
            &FakeInstallChecker {
                checkout: CheckoutResult {
                    checkout_dir: workspace.join("checkout").to_string_lossy().to_string(),
                    skill_dir: checkout_skill.to_string_lossy().to_string(),
                },
            },
        )
        .expect("batch install should complete");

        assert_eq!(result.targets[0].status, InstallTargetStatus::Skipped);
        assert_eq!(
            result.targets[0].reason.as_deref(),
            Some("conflict_non_skill")
        );
        assert_eq!(result.targets[1].status, InstallTargetStatus::Installed);
        assert!(hermes_path.join("SKILL.md").is_file());
        assert_eq!(
            fs::read_to_string(conflict_path.join("README.md")).expect("conflict should remain"),
            "not a skill"
        );

        fs::remove_dir_all(workspace).expect("workspace should be removed");
    }

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("metis-install-{}-{}", name, suffix));
        fs::create_dir_all(&path).expect("workspace should be created");
        path
    }

    fn write_skill(root: &Path, dir_name: &str, name: &str) -> PathBuf {
        let skill_dir = root.join(dir_name);
        fs::create_dir_all(&skill_dir).expect("skill dir should be created");
        fs::write(
            skill_dir.join("SKILL.md"),
            format!(
                "---
name: {name}
---
"
            ),
        )
        .expect("skill should be written");
        skill_dir
    }
}
