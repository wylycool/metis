use crate::audit::{write_audit_event, AuditAction, AuditEventInput};
use crate::install::InstallSkillTarget;
use crate::local_state::{check_local_modification, clone_baseline_manifest};
use crate::sync::SkillTargetRoot;
use chrono::Utc;
use metis_adapters::standard::parse_standard_skill_metadata;
use metis_storage::backup::copy_skill_directory;
use metis_storage::db::{SkillIndexStore, SkillRecord};
use metis_storage::manifest::compute_local_updated_at;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalSkillTargetOptions {
    pub source_skill_id: String,
    pub allowed_roots: Vec<SkillTargetRoot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalSkillTarget {
    pub agent_id: String,
    pub agent_name: String,
    pub root_path: String,
    pub install_path: String,
    pub status: LocalSkillTargetStatus,
    pub root_available: bool,
    pub root_status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LocalSkillTargetStatus {
    NotInstalled,
    Installed,
    ConflictNonSkill,
    AgentRootUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CopyLocalSkillOptions {
    pub source_skill_id: String,
    pub targets: Vec<InstallSkillTarget>,
    pub allowed_roots: Vec<SkillTargetRoot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CopyLocalSkillResult {
    pub targets: Vec<CopyLocalSkillTargetResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CopyLocalSkillTargetResult {
    pub agent_id: String,
    pub install_path: String,
    pub status: CopyLocalSkillTargetStatus,
    pub reason: Option<String>,
    pub skill_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CopyLocalSkillTargetStatus {
    Installed,
    Skipped,
    Failed,
}

pub fn get_local_skill_install_targets(
    options: LocalSkillTargetOptions,
    store: &SkillIndexStore,
) -> Result<Vec<LocalSkillTarget>, String> {
    let (_, install_name) = resolve_source_skill(&options.source_skill_id, store)?;
    options
        .allowed_roots
        .into_iter()
        .map(|root| {
            let install_path = Path::new(&root.root_path).join(&install_name);
            let install_path_string = install_path.to_string_lossy().to_string();
            let indexed = store
                .get_skill_by_agent_and_path(&root.agent_id, &install_path_string)
                .map_err(|error| error.to_string())?
                .is_some();
            let status = if !root.root_available {
                LocalSkillTargetStatus::AgentRootUnavailable
            } else if indexed || install_path.join("SKILL.md").is_file() {
                LocalSkillTargetStatus::Installed
            } else if install_path.exists() {
                LocalSkillTargetStatus::ConflictNonSkill
            } else {
                LocalSkillTargetStatus::NotInstalled
            };
            Ok(LocalSkillTarget {
                agent_id: root.agent_id,
                agent_name: root.agent_name,
                root_path: root.root_path,
                install_path: install_path_string,
                status,
                root_available: root.root_available,
                root_status: root.root_status,
            })
        })
        .collect()
}

pub fn copy_local_skill_to_targets(
    options: CopyLocalSkillOptions,
    store: &mut SkillIndexStore,
) -> Result<CopyLocalSkillResult, String> {
    let validated = validate_copy_request(options, store)?;
    let targets = validated
        .targets
        .iter()
        .map(|target| copy_one_target(&validated.source_skill, target, store))
        .collect();
    Ok(CopyLocalSkillResult { targets })
}

struct ValidatedCopyRequest {
    source_skill: SkillRecord,
    targets: Vec<InstallSkillTarget>,
}

fn validate_copy_request(
    options: CopyLocalSkillOptions,
    store: &SkillIndexStore,
) -> Result<ValidatedCopyRequest, String> {
    let (source_skill, install_name) = resolve_source_skill(&options.source_skill_id, store)?;
    let mut allowed = HashMap::new();
    for root in options
        .allowed_roots
        .into_iter()
        .filter(|root| root.root_available)
    {
        let install_path = Path::new(&root.root_path)
            .join(&install_name)
            .to_string_lossy()
            .to_string();
        allowed.insert(
            (root.agent_id.clone(), install_path.clone()),
            InstallSkillTarget {
                agent_id: root.agent_id,
                agent_name: root.agent_name,
                install_path,
            },
        );
    }

    let mut seen = HashSet::new();
    let mut targets = Vec::new();
    for requested in options.targets {
        let key = (requested.agent_id.clone(), requested.install_path.clone());
        let Some(authoritative) = allowed.get(&key) else {
            return Err(format!(
                "invalid install target: {} {}",
                requested.agent_id, requested.install_path
            ));
        };
        if seen.insert(key) {
            targets.push(authoritative.clone());
        }
    }

    Ok(ValidatedCopyRequest {
        source_skill,
        targets,
    })
}

fn copy_one_target(
    source_skill: &SkillRecord,
    target: &InstallSkillTarget,
    store: &mut SkillIndexStore,
) -> CopyLocalSkillTargetResult {
    match try_copy_one_target(source_skill, target, store) {
        Ok(result) => result,
        Err(reason) => CopyLocalSkillTargetResult {
            agent_id: target.agent_id.clone(),
            install_path: target.install_path.clone(),
            status: CopyLocalSkillTargetStatus::Failed,
            reason: Some(reason),
            skill_id: None,
        },
    }
}

fn try_copy_one_target(
    source_skill: &SkillRecord,
    target: &InstallSkillTarget,
    store: &mut SkillIndexStore,
) -> Result<CopyLocalSkillTargetResult, String> {
    let install_path = Path::new(&target.install_path);
    if install_path.exists() {
        return Ok(skipped_copy_target(target, "target_exists"));
    }
    if store
        .get_skill_by_agent_and_path(&target.agent_id, &target.install_path)
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Ok(skipped_copy_target(target, "target_already_indexed"));
    }
    let target_root = install_path
        .parent()
        .ok_or_else(|| "target root is unavailable".to_string())?;
    if !target_root.is_dir() {
        return Err(format!(
            "target root is unavailable: {}",
            target_root.to_string_lossy()
        ));
    }

    let install_name = install_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "invalid install name".to_string())?;
    let temp_path = target_root.join(format!(
        ".{install_name}.metis-copy-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let mut temp_guard = PendingCopyPath::new(temp_path.clone());
    if let Err(error) = copy_skill_directory(&source_skill.install_path, &temp_path) {
        return Err(temp_guard.fail(format!("local copy failed: {error}")));
    }
    let metadata = match parse_standard_skill_metadata(&temp_path.to_string_lossy()) {
        Ok(metadata) => metadata,
        Err(error) => {
            return Err(temp_guard.fail(format!("copied SKILL.md is invalid: {error}")));
        }
    };
    let local_updated_at = match compute_local_updated_at(&temp_path) {
        Ok(local_updated_at) => local_updated_at,
        Err(error) => return Err(temp_guard.fail(error.to_string())),
    };

    if let Err(error) = rename_without_overwrite(&temp_path, install_path) {
        let reason = if install_path.exists() {
            format!("target became occupied before install: {error}")
        } else {
            format!("failed to finalize local copy: {error}")
        };
        return Err(temp_guard.fail(reason));
    }
    temp_guard.disarm();

    let skill_id = stable_skill_id(&target.agent_id, &target.install_path);
    let target_skill = SkillRecord {
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
            .map(|category| format!("{category:?}").to_lowercase()),
        install_path: target.install_path.clone(),
        scope: source_skill.scope.clone(),
        metadata_path: Some(install_path.join("SKILL.md").to_string_lossy().to_string()),
        metadata_status: "found".to_string(),
        metadata_error: None,
        source_id: source_skill.source_id.clone(),
        local_fingerprint: source_skill.local_fingerprint.clone(),
        local_modified: source_skill.local_modified,
        last_scanned_at: Utc::now().to_rfc3339(),
        local_updated_at,
    };

    let mut index_written = false;
    let write_result = (|| -> Result<(), String> {
        store
            .upsert_skill(&target_skill)
            .map_err(|error| error.to_string())?;
        index_written = true;
        if let Some(baseline_fingerprint) = source_skill.local_fingerprint.as_deref() {
            clone_baseline_manifest(&source_skill.id, &skill_id, baseline_fingerprint, store)
                .map_err(|error| error.to_string())?;
            check_local_modification(&skill_id, store).map_err(|error| error.to_string())?;
        }
        write_audit_event(
            store,
            AuditEventInput {
                skill_id: skill_id.clone(),
                action: AuditAction::SkillCopied,
                detail: Some(format!(
                    "copied local skill from {} to agent {}",
                    source_skill.id, target.agent_id
                )),
                commit_before: None,
                commit_after: None,
                status: "success".to_string(),
                risk_summary: None,
            },
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    })();

    if let Err(error) = write_result {
        return Err(clean_up_failed_copy(
            install_path,
            &skill_id,
            index_written,
            store,
            error,
        ));
    }

    Ok(CopyLocalSkillTargetResult {
        agent_id: target.agent_id.clone(),
        install_path: target.install_path.clone(),
        status: CopyLocalSkillTargetStatus::Installed,
        reason: None,
        skill_id: Some(skill_id),
    })
}

fn skipped_copy_target(target: &InstallSkillTarget, reason: &str) -> CopyLocalSkillTargetResult {
    CopyLocalSkillTargetResult {
        agent_id: target.agent_id.clone(),
        install_path: target.install_path.clone(),
        status: CopyLocalSkillTargetStatus::Skipped,
        reason: Some(reason.to_string()),
        skill_id: None,
    }
}

fn clean_up_failed_copy(
    install_path: &Path,
    skill_id: &str,
    index_written: bool,
    store: &SkillIndexStore,
    original_error: String,
) -> String {
    let mut cleanup_errors = Vec::new();
    if index_written {
        if let Err(error) = store.delete_skill(skill_id) {
            cleanup_errors.push(format!("failed to delete target index: {error}"));
        }
    }
    if install_path.exists() {
        if let Err(error) = fs::remove_dir_all(install_path) {
            cleanup_errors.push(format!("failed to delete target directory: {error}"));
        }
    }
    if cleanup_errors.is_empty() {
        original_error
    } else {
        format!(
            "{original_error}; cleanup failed: {}",
            cleanup_errors.join("; ")
        )
    }
}

struct PendingCopyPath {
    path: PathBuf,
    armed: bool,
}

impl PendingCopyPath {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }

    fn fail(&mut self, original_error: String) -> String {
        self.fail_with_cleanup(original_error, |path| fs::remove_dir_all(path))
    }

    fn fail_with_cleanup<F>(&mut self, original_error: String, cleanup: F) -> String
    where
        F: FnOnce(&Path) -> io::Result<()>,
    {
        if !self.armed {
            return original_error;
        }
        match cleanup(&self.path) {
            Ok(()) => {
                self.armed = false;
                original_error
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                self.armed = false;
                original_error
            }
            Err(error) => format!(
                "{original_error}; cleanup failed to delete temporary directory {}: {error}",
                self.path.to_string_lossy()
            ),
        }
    }
}

impl Drop for PendingCopyPath {
    fn drop(&mut self) {
        if self.armed {
            match fs::remove_dir_all(&self.path) {
                Ok(()) => self.armed = false,
                Err(error) if error.kind() == io::ErrorKind::NotFound => self.armed = false,
                Err(_) => {}
            }
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn rename_without_overwrite(source: &Path, target: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_uint};
    use std::os::unix::ffi::OsStrExt;

    unsafe extern "C" {
        fn renamex_np(old: *const c_char, new: *const c_char, flags: c_uint) -> i32;
    }

    const RENAME_EXCL: c_uint = 0x0000_0004;
    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source path contains NUL"))?;
    let target = CString::new(target.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "target path contains NUL"))?;
    // SAFETY: both pointers come from live CString values and RENAME_EXCL is a valid flag.
    if unsafe { renamex_np(source.as_ptr(), target.as_ptr(), RENAME_EXCL) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn rename_without_overwrite(source: &Path, target: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int, c_uint};
    use std::os::unix::ffi::OsStrExt;

    unsafe extern "C" {
        fn renameat2(
            olddirfd: c_int,
            old: *const c_char,
            newdirfd: c_int,
            new: *const c_char,
            flags: c_uint,
        ) -> c_int;
    }

    const AT_FDCWD: c_int = -100;
    const RENAME_NOREPLACE: c_uint = 1;
    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source path contains NUL"))?;
    let target = CString::new(target.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "target path contains NUL"))?;
    // SAFETY: both pointers come from live CString values and the dirfd/flag constants match
    // renameat2(2).
    if unsafe {
        renameat2(
            AT_FDCWD,
            source.as_ptr(),
            AT_FDCWD,
            target.as_ptr(),
            RENAME_NOREPLACE,
        )
    } == 0
    {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn rename_without_overwrite(source: &Path, target: &Path) -> io::Result<()> {
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    unsafe extern "system" {
        #[link_name = "MoveFileW"]
        fn move_file_w(existing_file_name: *const u16, new_file_name: *const u16) -> i32;
    }

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(once(0))
        .collect::<Vec<_>>();
    // SAFETY: both pointers reference live, NUL-terminated UTF-16 buffers for this call.
    if unsafe { move_file_w(source.as_ptr(), target.as_ptr()) } != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "linux",
    target_os = "android",
    windows
)))]
fn rename_without_overwrite(source: &Path, target: &Path) -> io::Result<()> {
    let _ = (source, target);
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "atomic no-replace rename is unsupported on this platform",
    ))
}

fn stable_skill_id(agent_id: &str, install_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(agent_id.as_bytes());
    hasher.update([0]);
    hasher.update(install_path.as_bytes());
    let digest = hasher.finalize();
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("skill_{hex}")
}

fn resolve_source_skill(
    source_skill_id: &str,
    store: &SkillIndexStore,
) -> Result<(SkillRecord, String), String> {
    let source_skill = store
        .get_skill(source_skill_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("source skill not found: {source_skill_id}"))?;
    let source_path = Path::new(&source_skill.install_path);
    if !source_path.is_dir() {
        return Err(format!(
            "source skill directory is unavailable: {}",
            source_skill.install_path
        ));
    }
    fs::read_dir(source_path).map_err(|error| {
        format!(
            "source skill directory is not readable: {}: {error}",
            source_skill.install_path
        )
    })?;
    let skill_md = source_path.join("SKILL.md");
    if !skill_md.is_file() {
        return Err(format!(
            "source skill must contain a readable SKILL.md: {}",
            source_skill.install_path
        ));
    }
    fs::File::open(&skill_md).map_err(|error| {
        format!(
            "source SKILL.md is not readable: {}: {error}",
            skill_md.to_string_lossy()
        )
    })?;
    let install_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "invalid install name".to_string())?
        .to_string();
    validate_install_name(&install_name)?;
    Ok((source_skill, install_name))
}

fn validate_install_name(name: &str) -> Result<(), String> {
    let path = Path::new(name);
    let mut components = path.components();
    let is_single_normal_component =
        matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
    if name.is_empty()
        || name.trim() != name
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || path.is_absolute()
        || !is_single_normal_component
    {
        return Err("invalid install name".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::{query_audit_log, AuditAction, AuditQuery};
    use crate::install::InstallSkillTarget;
    use crate::local_state::{capture_local_baseline, check_local_modification};
    use crate::sync::SkillTargetRoot;
    use metis_storage::db::{SkillIndexStore, SkillRecord, SourceRecord};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("metis-core-local-install-{name}-{suffix}"));
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
            name: "Source Skill".to_string(),
            description: Some("A local skill".to_string()),
            version: Some("1.0.0".to_string()),
            author: Some("Metis Team".to_string()),
            license: Some("MIT".to_string()),
            tags: vec!["local".to_string()],
            category: Some("workflow".to_string()),
            install_path: install_path.to_string_lossy().to_string(),
            scope: "user".to_string(),
            metadata_path: Some(install_path.join("SKILL.md").to_string_lossy().to_string()),
            metadata_status: "found".to_string(),
            metadata_error: None,
            source_id: None,
            local_fingerprint: None,
            local_modified: None,
            last_scanned_at: "2026-07-11T10:00:00Z".to_string(),
            local_updated_at: None,
        }
    }

    fn target_root(
        agent_id: &str,
        agent_name: &str,
        root_path: &Path,
        root_available: bool,
        root_status: &str,
    ) -> SkillTargetRoot {
        SkillTargetRoot {
            agent_id: agent_id.to_string(),
            agent_name: agent_name.to_string(),
            root_path: root_path.to_string_lossy().to_string(),
            root_available,
            root_status: root_status.to_string(),
        }
    }

    fn install_target(agent_id: &str, agent_name: &str, install_path: &Path) -> InstallSkillTarget {
        InstallSkillTarget {
            agent_id: agent_id.to_string(),
            agent_name: agent_name.to_string(),
            install_path: install_path.to_string_lossy().to_string(),
        }
    }

    fn sample_source(id: &str) -> SourceRecord {
        SourceRecord {
            id: id.to_string(),
            source_type: "git".to_string(),
            url: "git@example.com:team/skills.git".to_string(),
            repo_path: "skills/source-folder".to_string(),
            ref_: "main".to_string(),
            current_commit: Some("abc123".to_string()),
            remote_commit: Some("def456".to_string()),
            last_checked_at: Some("2026-07-11T09:30:00Z".to_string()),
            trusted: true,
            auto_update: true,
            credential_ref: Some("team-git".to_string()),
            created_at: None,
            updated_at: None,
        }
    }

    fn valid_skill_markdown(name: &str) -> String {
        format!(
            "---\nname: {name}\ndescription: Local replication test\nversion: 1.2.3\nauthor: Metis Team\nlicense: MIT\ntags:\n  - local\ncategory: workflow\n---\n\n# {name}\n"
        )
    }

    fn copy_options(
        source_skill_id: &str,
        targets: Vec<InstallSkillTarget>,
        allowed_roots: Vec<SkillTargetRoot>,
    ) -> CopyLocalSkillOptions {
        CopyLocalSkillOptions {
            source_skill_id: source_skill_id.to_string(),
            targets,
            allowed_roots,
        }
    }

    fn copy_temp_paths(root: &Path) -> Vec<PathBuf> {
        fs::read_dir(root)
            .expect("root should be readable")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.contains(".metis-copy-"))
            })
            .collect()
    }

    #[test]
    fn local_targets_use_source_install_directory_name_and_authoritative_roots() {
        let root = temp_dir("target-paths");
        let source_dir = root.join("codex/source-folder");
        let claude_root = root.join("claude/skills");
        let custom_root = root.join("custom/team-skills");
        write_file(&source_dir.join("SKILL.md"), "# Source Skill\n");
        fs::create_dir_all(&claude_root).expect("claude root should be created");
        fs::create_dir_all(&custom_root).expect("custom root should be created");

        let store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("source-skill", &source_dir))
            .expect("source skill should upsert");

        let targets = get_local_skill_install_targets(
            LocalSkillTargetOptions {
                source_skill_id: "source-skill".to_string(),
                allowed_roots: vec![
                    target_root("claude", "Claude Code", &claude_root, true, "available"),
                    target_root(
                        "custom-team",
                        "Team Shared Skills",
                        &custom_root,
                        true,
                        "available",
                    ),
                ],
            },
            &store,
        )
        .expect("local targets should load");

        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0].agent_id, "claude");
        assert_eq!(targets[0].agent_name, "Claude Code");
        assert_eq!(targets[0].root_path, claude_root.to_string_lossy());
        assert_eq!(
            targets[0].install_path,
            claude_root.join("source-folder").to_string_lossy()
        );
        assert_eq!(targets[0].status, LocalSkillTargetStatus::NotInstalled);
        assert!(targets[0].root_available);
        assert_eq!(targets[1].agent_id, "custom-team");
        assert_eq!(targets[1].agent_name, "Team Shared Skills");
        assert_eq!(
            targets[1].install_path,
            custom_root.join("source-folder").to_string_lossy()
        );
        assert_eq!(targets[1].status, LocalSkillTargetStatus::NotInstalled);

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn local_targets_report_installed_conflict_and_unavailable_without_git() {
        let root = temp_dir("target-statuses");
        let source_dir = root.join("source-folder");
        let installed_root = root.join("installed");
        let conflict_root = root.join("conflict");
        let unavailable_root = root.join("unavailable");
        write_file(&source_dir.join("SKILL.md"), "# Source Skill\n");
        write_file(
            &installed_root.join("source-folder/SKILL.md"),
            "# Existing Skill\n",
        );
        write_file(
            &conflict_root.join("source-folder/README.md"),
            "not a skill",
        );

        let store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("source-skill", &source_dir))
            .expect("source skill should upsert");

        let targets = get_local_skill_install_targets(
            LocalSkillTargetOptions {
                source_skill_id: "source-skill".to_string(),
                allowed_roots: vec![
                    target_root("installed", "Installed", &installed_root, true, "available"),
                    target_root("conflict", "Conflict", &conflict_root, true, "available"),
                    target_root(
                        "unavailable",
                        "Unavailable",
                        &unavailable_root,
                        false,
                        "missing",
                    ),
                ],
            },
            &store,
        )
        .expect("local targets should load");

        assert_eq!(targets[0].status, LocalSkillTargetStatus::Installed);
        assert_eq!(targets[1].status, LocalSkillTargetStatus::ConflictNonSkill);
        assert_eq!(
            targets[2].status,
            LocalSkillTargetStatus::AgentRootUnavailable
        );
        assert!(!targets[2].root_available);
        assert_eq!(targets[2].root_status, "missing");

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn local_targets_do_not_offer_an_indexed_target_with_a_missing_directory() {
        let root = temp_dir("indexed-missing-target");
        let source_dir = root.join("source-folder");
        let target_root_path = root.join("target");
        let missing_target_path = target_root_path.join("source-folder");
        write_file(&source_dir.join("SKILL.md"), "# Source Skill\n");
        fs::create_dir_all(&target_root_path).expect("target root should be created");

        let store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("source-skill", &source_dir))
            .expect("source skill should upsert");
        let mut stale_target = sample_skill("stale-target", &missing_target_path);
        stale_target.agent_id = "claude".to_string();
        store
            .upsert_skill(&stale_target)
            .expect("stale target should remain indexed");

        let targets = get_local_skill_install_targets(
            LocalSkillTargetOptions {
                source_skill_id: "source-skill".to_string(),
                allowed_roots: vec![target_root(
                    "claude",
                    "Claude Code",
                    &target_root_path,
                    true,
                    "available",
                )],
            },
            &store,
        )
        .expect("local targets should load");

        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].status, LocalSkillTargetStatus::Installed);
        assert!(!missing_target_path.exists());

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn local_targets_reject_missing_or_unsafe_source_install_name() {
        let root = temp_dir("invalid-source");
        let allowed_root = root.join("allowed");
        fs::create_dir_all(&allowed_root).expect("allowed root should be created");
        let store = SkillIndexStore::open_in_memory().expect("store should open");

        let missing_error = get_local_skill_install_targets(
            LocalSkillTargetOptions {
                source_skill_id: "missing".to_string(),
                allowed_roots: vec![],
            },
            &store,
        )
        .expect_err("missing source should fail");
        assert!(missing_error.contains("source skill not found"));

        let missing_manifest_dir = root.join("missing-manifest");
        fs::create_dir_all(&missing_manifest_dir).expect("source directory should be created");
        store
            .upsert_skill(&sample_skill("missing-manifest", &missing_manifest_dir))
            .expect("source skill should upsert");
        let manifest_error = get_local_skill_install_targets(
            LocalSkillTargetOptions {
                source_skill_id: "missing-manifest".to_string(),
                allowed_roots: vec![target_root(
                    "allowed",
                    "Allowed",
                    &allowed_root,
                    true,
                    "available",
                )],
            },
            &store,
        )
        .expect_err("source without SKILL.md should fail");
        assert!(manifest_error.contains("SKILL.md"));

        let unsafe_base = root.join("unsafe-base");
        fs::create_dir_all(unsafe_base.join("child")).expect("child directory should be created");
        write_file(&unsafe_base.join("SKILL.md"), "# Unsafe Source\n");
        let unsafe_path = unsafe_base.join("child/..");
        store
            .upsert_skill(&sample_skill("unsafe-source", &unsafe_path))
            .expect("unsafe source should upsert");
        let unsafe_error = get_local_skill_install_targets(
            LocalSkillTargetOptions {
                source_skill_id: "unsafe-source".to_string(),
                allowed_roots: vec![target_root(
                    "allowed",
                    "Allowed",
                    &allowed_root,
                    true,
                    "available",
                )],
            },
            &store,
        )
        .expect_err("unsafe install name should fail");
        assert!(unsafe_error.contains("invalid install name"));

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn copy_local_skill_copies_exact_files_without_remote_dependencies() {
        let root = temp_dir("copy-files");
        let source_dir = root.join("source/source-folder");
        let target_root_path = root.join("target");
        let target_dir = target_root_path.join("source-folder");
        write_file(
            &source_dir.join("SKILL.md"),
            &valid_skill_markdown("Source Skill"),
        );
        write_file(
            &source_dir.join("scripts/run.sh"),
            "#!/bin/sh\necho copied\n",
        );
        write_file(&source_dir.join("references/note.md"), "local note");
        write_file(&source_dir.join(".git/config"), "git metadata");
        fs::create_dir_all(&target_root_path).expect("target root should be created");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(source_dir.join("scripts/run.sh"))
                .expect("script metadata should load")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(source_dir.join("scripts/run.sh"), permissions)
                .expect("script should become executable");
        }

        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("source-skill", &source_dir))
            .expect("source skill should upsert");

        let result = copy_local_skill_to_targets(
            copy_options(
                "source-skill",
                vec![install_target("claude", "Forged Name", &target_dir)],
                vec![target_root(
                    "claude",
                    "Claude Code",
                    &target_root_path,
                    true,
                    "available",
                )],
            ),
            &mut store,
        )
        .expect("local copy should complete");

        assert_eq!(result.targets.len(), 1);
        assert_eq!(
            result.targets[0].status,
            CopyLocalSkillTargetStatus::Installed
        );
        let target_skill_id = result.targets[0]
            .skill_id
            .as_deref()
            .expect("installed target should return a skill id");
        assert_eq!(
            fs::read_to_string(target_dir.join("SKILL.md"))
                .expect("target SKILL.md should be readable"),
            valid_skill_markdown("Source Skill")
        );
        assert_eq!(
            fs::read_to_string(target_dir.join("scripts/run.sh"))
                .expect("target script should be readable"),
            "#!/bin/sh\necho copied\n"
        );
        assert_eq!(
            fs::read_to_string(target_dir.join("references/note.md"))
                .expect("target reference should be readable"),
            "local note"
        );
        assert!(!target_dir.join(".git").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_ne!(
                fs::metadata(target_dir.join("scripts/run.sh"))
                    .expect("target script metadata should load")
                    .permissions()
                    .mode()
                    & 0o111,
                0
            );
        }

        let copied = store
            .get_skill(target_skill_id)
            .expect("target lookup should succeed")
            .expect("target skill should be indexed");
        assert_eq!(copied.agent_id, "claude");
        assert_eq!(copied.name, "Source Skill");
        assert_eq!(copied.install_path, target_dir.to_string_lossy());
        let audit = query_audit_log(
            AuditQuery {
                skill_id: Some(target_skill_id.to_string()),
                action: Some(AuditAction::SkillCopied),
                limit: 10,
                offset: 0,
            },
            &store,
        )
        .expect("copy audit should query");
        assert_eq!(audit.len(), 1);
        assert!(audit[0]
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("source-skill") && detail.contains("claude")));

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn copy_local_skill_works_without_a_source() {
        let root = temp_dir("copy-no-source");
        let source_dir = root.join("source-folder");
        let target_root_path = root.join("target");
        let target_dir = target_root_path.join("source-folder");
        write_file(
            &source_dir.join("SKILL.md"),
            &valid_skill_markdown("Source Less"),
        );
        fs::create_dir_all(&target_root_path).expect("target root should be created");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("source-skill", &source_dir))
            .expect("source skill should upsert");

        let result = copy_local_skill_to_targets(
            copy_options(
                "source-skill",
                vec![install_target("hermes", "Hermes", &target_dir)],
                vec![target_root(
                    "hermes",
                    "Hermes",
                    &target_root_path,
                    true,
                    "available",
                )],
            ),
            &mut store,
        )
        .expect("source-less skill should copy");

        let target_skill = store
            .get_skill(
                result.targets[0]
                    .skill_id
                    .as_deref()
                    .expect("target skill id should exist"),
            )
            .expect("target lookup should succeed")
            .expect("target should exist");
        assert_eq!(target_skill.source_id, None);
        assert_eq!(target_skill.local_modified, None);
        assert!(store
            .list_sources()
            .expect("sources should list")
            .is_empty());

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn copy_local_skill_reuses_source_record_and_commit_fields() {
        let root = temp_dir("copy-source-record");
        let source_dir = root.join("source-folder");
        let target_root_path = root.join("target");
        let target_dir = target_root_path.join("source-folder");
        write_file(
            &source_dir.join("SKILL.md"),
            &valid_skill_markdown("Source Bound"),
        );
        fs::create_dir_all(&target_root_path).expect("target root should be created");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        let source_record = sample_source("source-record");
        store
            .upsert_source(&source_record)
            .expect("source record should upsert");
        let mut source_skill = sample_skill("source-skill", &source_dir);
        source_skill.source_id = Some(source_record.id.clone());
        store
            .upsert_skill(&source_skill)
            .expect("source skill should upsert");
        let source_before = store
            .get_source("source-record")
            .expect("source lookup should succeed")
            .expect("source should exist");

        let result = copy_local_skill_to_targets(
            copy_options(
                "source-skill",
                vec![install_target("opencode", "OpenCode", &target_dir)],
                vec![target_root(
                    "opencode",
                    "OpenCode",
                    &target_root_path,
                    true,
                    "available",
                )],
            ),
            &mut store,
        )
        .expect("bound skill should copy");

        let target_skill = store
            .get_skill(
                result.targets[0]
                    .skill_id
                    .as_deref()
                    .expect("target skill id should exist"),
            )
            .expect("target lookup should succeed")
            .expect("target should exist");
        assert_eq!(target_skill.source_id.as_deref(), Some("source-record"));
        assert_eq!(store.list_sources().expect("sources should list").len(), 1);
        let source_after = store
            .get_source("source-record")
            .expect("source lookup should succeed")
            .expect("source should exist");
        assert_eq!(source_after, source_before);
        assert_eq!(source_after.current_commit.as_deref(), Some("abc123"));
        assert_eq!(source_after.remote_commit.as_deref(), Some("def456"));
        assert_eq!(
            source_after.last_checked_at.as_deref(),
            Some("2026-07-11T09:30:00Z")
        );
        assert!(source_after.trusted);
        assert!(source_after.auto_update);
        assert_eq!(source_after.credential_ref.as_deref(), Some("team-git"));

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn copy_local_skill_clones_baseline_and_preserves_local_modified_true() {
        let root = temp_dir("copy-modified");
        let source_dir = root.join("source-folder");
        let target_root_path = root.join("target");
        let target_dir = target_root_path.join("source-folder");
        let source_skill_md = source_dir.join("SKILL.md");
        write_file(&source_skill_md, &valid_skill_markdown("Baseline Source"));
        write_file(&source_dir.join("reference.md"), "baseline");
        fs::create_dir_all(&target_root_path).expect("target root should be created");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("source-skill", &source_dir))
            .expect("source skill should upsert");
        let baseline = capture_local_baseline("source-skill", &mut store)
            .expect("source baseline should capture");
        let source_baseline = store
            .list_file_manifest("source-skill", "baseline", &baseline.fingerprint)
            .expect("source baseline should list");
        write_file(
            &source_skill_md,
            &valid_skill_markdown("Locally Modified Source"),
        );
        write_file(&source_dir.join("added.md"), "added locally");
        let source_state = check_local_modification("source-skill", &mut store)
            .expect("source local state should refresh");
        assert!(source_state.local_modified);

        let result = copy_local_skill_to_targets(
            copy_options(
                "source-skill",
                vec![install_target("claude", "Claude Code", &target_dir)],
                vec![target_root(
                    "claude",
                    "Claude Code",
                    &target_root_path,
                    true,
                    "available",
                )],
            ),
            &mut store,
        )
        .expect("modified skill should copy");

        let target_skill_id = result.targets[0]
            .skill_id
            .as_deref()
            .expect("target skill id should exist");
        let target_skill = store
            .get_skill(target_skill_id)
            .expect("target lookup should succeed")
            .expect("target should exist");
        assert_eq!(
            target_skill.local_fingerprint.as_deref(),
            Some(baseline.fingerprint.as_str())
        );
        assert_eq!(target_skill.local_modified, Some(true));
        assert!(target_skill.local_updated_at.is_some());
        let target_baseline = store
            .list_file_manifest(target_skill_id, "baseline", &baseline.fingerprint)
            .expect("target baseline should list");
        assert_eq!(target_baseline.len(), source_baseline.len());
        for (source_entry, target_entry) in source_baseline.iter().zip(&target_baseline) {
            assert_ne!(target_entry.id, source_entry.id);
            assert_eq!(target_entry.skill_id, target_skill_id);
            assert_eq!(target_entry.snapshot_type, source_entry.snapshot_type);
            assert_eq!(target_entry.snapshot_ref, source_entry.snapshot_ref);
            assert_eq!(target_entry.relative_path, source_entry.relative_path);
            assert_eq!(target_entry.file_size, source_entry.file_size);
            assert_eq!(target_entry.modified_at, source_entry.modified_at);
            assert_eq!(target_entry.content_hash, source_entry.content_hash);
            assert_eq!(target_entry.is_executable, source_entry.is_executable);
        }
        let current = store
            .list_file_manifest(target_skill_id, "current", &source_state.fingerprint)
            .expect("target current manifest should list");
        assert!(!current.is_empty());

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn copy_local_skill_preserves_clean_state() {
        let root = temp_dir("copy-clean");
        let source_dir = root.join("source-folder");
        let target_root_path = root.join("target");
        let target_dir = target_root_path.join("source-folder");
        write_file(
            &source_dir.join("SKILL.md"),
            &valid_skill_markdown("Clean Source"),
        );
        write_file(&source_dir.join("notes.md"), "clean");
        fs::create_dir_all(&target_root_path).expect("target root should be created");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("source-skill", &source_dir))
            .expect("source skill should upsert");
        let baseline = capture_local_baseline("source-skill", &mut store)
            .expect("source baseline should capture");

        let result = copy_local_skill_to_targets(
            copy_options(
                "source-skill",
                vec![install_target("hermes", "Hermes", &target_dir)],
                vec![target_root(
                    "hermes",
                    "Hermes",
                    &target_root_path,
                    true,
                    "available",
                )],
            ),
            &mut store,
        )
        .expect("clean skill should copy");

        let target_skill_id = result.targets[0]
            .skill_id
            .as_deref()
            .expect("target skill id should exist");
        let target_skill = store
            .get_skill(target_skill_id)
            .expect("target lookup should succeed")
            .expect("target should exist");
        assert_eq!(target_skill.local_modified, Some(false));
        assert_eq!(
            target_skill.local_fingerprint.as_deref(),
            Some(baseline.fingerprint.as_str())
        );
        let target_baseline = store
            .list_file_manifest(target_skill_id, "baseline", &baseline.fingerprint)
            .expect("target baseline should list");
        let target_current = store
            .list_file_manifest(target_skill_id, "current", &baseline.fingerprint)
            .expect("target current manifest should list");
        assert_eq!(target_baseline.len(), target_current.len());
        assert!(!target_current.is_empty());

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn copy_local_skill_rejects_unauthorized_batch_before_side_effects() {
        let root = temp_dir("copy-unauthorized");
        let source_dir = root.join("source-folder");
        let allowed_root = root.join("allowed");
        let allowed_target = allowed_root.join("source-folder");
        let forged_target = root.join("outside/source-folder");
        write_file(
            &source_dir.join("SKILL.md"),
            &valid_skill_markdown("Authorized Source"),
        );
        fs::create_dir_all(&allowed_root).expect("allowed root should be created");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("source-skill", &source_dir))
            .expect("source skill should upsert");

        let error = copy_local_skill_to_targets(
            copy_options(
                "source-skill",
                vec![
                    install_target("claude", "Claude Code", &allowed_target),
                    install_target("claude", "Claude Code", &forged_target),
                ],
                vec![target_root(
                    "claude",
                    "Claude Code",
                    &allowed_root,
                    true,
                    "available",
                )],
            ),
            &mut store,
        )
        .expect_err("forged target should reject the whole batch");

        assert!(error.contains("invalid install target"));
        assert!(!allowed_target.exists());
        assert!(!forged_target.exists());
        assert!(copy_temp_paths(&allowed_root).is_empty());
        assert_eq!(store.list_skills().expect("skills should list").len(), 1);

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn copy_local_skill_never_overwrites_existing_or_conflict_directories() {
        let root = temp_dir("copy-existing");
        let source_dir = root.join("source-folder");
        let installed_root = root.join("installed");
        let conflict_root = root.join("conflict");
        let installed_target = installed_root.join("source-folder");
        let conflict_target = conflict_root.join("source-folder");
        write_file(
            &source_dir.join("SKILL.md"),
            &valid_skill_markdown("New Source"),
        );
        write_file(&installed_target.join("SKILL.md"), "# Existing\n");
        write_file(&installed_target.join("keep.md"), "keep installed");
        write_file(&conflict_target.join("README.md"), "keep conflict");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("source-skill", &source_dir))
            .expect("source skill should upsert");

        let result = copy_local_skill_to_targets(
            copy_options(
                "source-skill",
                vec![
                    install_target("installed", "Installed", &installed_target),
                    install_target("conflict", "Conflict", &conflict_target),
                ],
                vec![
                    target_root("installed", "Installed", &installed_root, true, "available"),
                    target_root("conflict", "Conflict", &conflict_root, true, "available"),
                ],
            ),
            &mut store,
        )
        .expect("occupied targets should return per-target results");

        assert_eq!(result.targets.len(), 2);
        assert!(result
            .targets
            .iter()
            .all(|target| target.status == CopyLocalSkillTargetStatus::Skipped));
        assert_eq!(
            fs::read_to_string(installed_target.join("SKILL.md"))
                .expect("existing SKILL.md should remain"),
            "# Existing\n"
        );
        assert_eq!(
            fs::read_to_string(installed_target.join("keep.md"))
                .expect("existing file should remain"),
            "keep installed"
        );
        assert_eq!(
            fs::read_to_string(conflict_target.join("README.md"))
                .expect("conflict file should remain"),
            "keep conflict"
        );
        assert_eq!(store.list_skills().expect("skills should list").len(), 1);

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn atomic_finalization_never_replaces_a_racing_target_directory() {
        let root = temp_dir("atomic-no-replace");
        let pending = root.join(".source-folder.metis-copy-pending");
        let target = root.join("source-folder");
        write_file(&pending.join("SKILL.md"), "# Pending\n");
        write_file(&target.join("README.md"), "created by another process");

        let error = rename_without_overwrite(&pending, &target)
            .expect_err("exclusive rename should reject an occupied target");

        assert!(matches!(
            error.kind(),
            io::ErrorKind::AlreadyExists | io::ErrorKind::PermissionDenied | io::ErrorKind::Other
        ));
        assert_eq!(
            fs::read_to_string(target.join("README.md"))
                .expect("racing target should remain readable"),
            "created by another process"
        );
        assert!(!target.join("SKILL.md").exists());
        assert!(pending.join("SKILL.md").exists());

        fs::remove_dir_all(&target).expect("occupied target should be removable");
        fs::create_dir(&target).expect("empty racing target should be created");
        rename_without_overwrite(&pending, &target)
            .expect_err("exclusive rename should also reject an empty target directory");
        assert!(target.is_dir());
        assert!(fs::read_dir(&target)
            .expect("empty target should remain readable")
            .next()
            .is_none());
        assert!(pending.join("SKILL.md").exists());

        fs::remove_dir(&target).expect("empty target should be removable");
        write_file(&target, "created by another process");
        rename_without_overwrite(&pending, &target)
            .expect_err("exclusive rename should reject an occupied regular file");
        assert_eq!(
            fs::read_to_string(&target).expect("racing file should remain readable"),
            "created by another process"
        );
        assert!(pending.join("SKILL.md").exists());

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn pending_copy_path_reports_cleanup_failure_and_retries_on_drop() {
        let root = temp_dir("pending-cleanup-failure");
        let pending = root.join(".source-folder.metis-copy-pending");
        write_file(&pending.join("SKILL.md"), "# Pending\n");

        let mut guard = PendingCopyPath::new(pending.clone());
        let reason = guard.fail_with_cleanup("local copy failed".to_string(), |_| {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "simulated cleanup denial",
            ))
        });

        assert!(reason.contains("local copy failed"));
        assert!(reason.contains("cleanup failed"));
        assert!(reason.contains("simulated cleanup denial"));
        assert!(pending.exists());
        drop(guard);
        assert!(!pending.exists());

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn pending_copy_path_attempts_cleanup_even_when_metadata_is_inaccessible() {
        let root = temp_dir("pending-cleanup-inaccessible");
        let pending = root.join("metadata-cannot-be-read");
        let mut cleanup_called = false;

        let mut guard = PendingCopyPath::new(pending);
        let reason = guard.fail_with_cleanup("local copy failed".to_string(), |_| {
            cleanup_called = true;
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "simulated metadata and cleanup denial",
            ))
        });

        assert!(cleanup_called);
        assert!(reason.contains("cleanup failed"));
        assert!(reason.contains("simulated metadata and cleanup denial"));

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn copy_local_skill_deduplicates_targets() {
        let root = temp_dir("copy-deduplicates");
        let source_dir = root.join("source-folder");
        let target_root_path = root.join("target");
        let target_dir = target_root_path.join("source-folder");
        write_file(
            &source_dir.join("SKILL.md"),
            &valid_skill_markdown("Deduplicated Source"),
        );
        fs::create_dir_all(&target_root_path).expect("target root should be created");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("source-skill", &source_dir))
            .expect("source skill should upsert");

        let result = copy_local_skill_to_targets(
            copy_options(
                "source-skill",
                vec![
                    install_target("claude", "Ignored One", &target_dir),
                    install_target("claude", "Ignored Two", &target_dir),
                ],
                vec![target_root(
                    "claude",
                    "Claude Code",
                    &target_root_path,
                    true,
                    "available",
                )],
            ),
            &mut store,
        )
        .expect("duplicate targets should deduplicate");

        assert_eq!(result.targets.len(), 1);
        assert_eq!(
            result.targets[0].status,
            CopyLocalSkillTargetStatus::Installed
        );
        assert_eq!(store.list_skills().expect("skills should list").len(), 2);
        let audit = query_audit_log(
            AuditQuery {
                skill_id: result.targets[0].skill_id.clone(),
                action: Some(AuditAction::SkillCopied),
                limit: 10,
                offset: 0,
            },
            &store,
        )
        .expect("audit should query");
        assert_eq!(audit.len(), 1);

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }

    #[test]
    fn copy_local_skill_cleans_temporary_and_final_paths_after_failure() {
        let root = temp_dir("copy-cleanup");
        let source_dir = root.join("source-folder");
        let target_root_path = root.join("target");
        let target_dir = target_root_path.join("source-folder");
        write_file(
            &source_dir.join("SKILL.md"),
            "---\nname: [unterminated\n---\n# Invalid\n",
        );
        fs::create_dir_all(&target_root_path).expect("target root should be created");
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        store
            .upsert_skill(&sample_skill("source-skill", &source_dir))
            .expect("source skill should upsert");
        let options = || {
            copy_options(
                "source-skill",
                vec![install_target("claude", "Claude Code", &target_dir)],
                vec![target_root(
                    "claude",
                    "Claude Code",
                    &target_root_path,
                    true,
                    "available",
                )],
            )
        };

        let parse_failure = copy_local_skill_to_targets(options(), &mut store)
            .expect("parse failure should be returned per target");
        assert_eq!(
            parse_failure.targets[0].status,
            CopyLocalSkillTargetStatus::Failed
        );
        assert!(!target_dir.exists());
        assert!(copy_temp_paths(&target_root_path).is_empty());
        assert_eq!(store.list_skills().expect("skills should list").len(), 1);

        write_file(
            &source_dir.join("SKILL.md"),
            &valid_skill_markdown("Valid Again"),
        );
        let mut inconsistent_source = store
            .get_skill("source-skill")
            .expect("source lookup should succeed")
            .expect("source should exist");
        inconsistent_source.local_fingerprint = Some("sha256:missing-baseline".to_string());
        inconsistent_source.local_modified = Some(true);
        store
            .upsert_skill(&inconsistent_source)
            .expect("inconsistent source state should upsert for the failure test");

        let manifest_failure = copy_local_skill_to_targets(options(), &mut store)
            .expect("manifest failure should be returned per target");
        assert_eq!(
            manifest_failure.targets[0].status,
            CopyLocalSkillTargetStatus::Failed
        );
        let target_skill_id = stable_skill_id("claude", &target_dir.to_string_lossy());
        assert!(!target_dir.exists());
        assert!(copy_temp_paths(&target_root_path).is_empty());
        assert!(store
            .get_skill(&target_skill_id)
            .expect("target lookup should succeed")
            .is_none());

        capture_local_baseline("source-skill", &mut store)
            .expect("valid source baseline should capture");
        let colliding_id = stable_skill_id("claude", &target_dir.to_string_lossy());
        let collision_dir = root.join("collision");
        let mut collision = sample_skill(&colliding_id, &collision_dir);
        collision.agent_id = "other".to_string();
        store
            .upsert_skill(&collision)
            .expect("colliding skill id should upsert");

        let index_failure = copy_local_skill_to_targets(options(), &mut store)
            .expect("index failure should be returned per target");
        assert_eq!(
            index_failure.targets[0].status,
            CopyLocalSkillTargetStatus::Failed
        );
        assert!(!target_dir.exists());
        assert!(copy_temp_paths(&target_root_path).is_empty());
        let preserved_collision = store
            .get_skill(&colliding_id)
            .expect("collision lookup should succeed")
            .expect("pre-existing collision should remain");
        assert_eq!(preserved_collision.agent_id, "other");
        assert_eq!(
            preserved_collision.install_path,
            collision_dir.to_string_lossy()
        );

        fs::remove_dir_all(&root).expect("temp directory should be removed");
    }
}
