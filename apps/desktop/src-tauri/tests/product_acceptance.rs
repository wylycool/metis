use metis_desktop_lib::{
    apply_skill_update_for_state_with_checker, bind_skill_source_for_state,
    check_skill_updates_for_state_with_checker, get_skill_diff_for_state_with_checker,
    list_skill_backups_for_state, restore_skill_backup_for_state, scan_skills_for_state,
    DesktopAppState, DesktopBindSourceRequest, DesktopRestoreBackupRequest, DesktopScanRequest,
    DesktopUpdateCheckRequest,
};
use metis_git_provider::fetch::{EnvironmentGitRunner, GitCliProvider};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn p0_product_acceptance_runs_against_real_home_git_sqlite_and_backups() {
    let workspace = temp_dir("product-acceptance");
    let fixture = ProductAcceptanceFixture::create(&workspace);
    let previous_home = std::env::var_os("HOME");
    let previous_user_profile = std::env::var_os("USERPROFILE");
    let previous_xdg_config_home = std::env::var_os("XDG_CONFIG_HOME");
    std::env::set_var("HOME", &fixture.home);
    std::env::set_var("USERPROFILE", &fixture.home);
    std::env::set_var("XDG_CONFIG_HOME", fixture.home.join(".config"));

    let result = run_p0_product_acceptance(&fixture);

    restore_env("HOME", previous_home);
    restore_env("USERPROFILE", previous_user_profile);
    restore_env("XDG_CONFIG_HOME", previous_xdg_config_home);
    fs::remove_dir_all(&workspace).expect("product acceptance workspace should be removed");

    result.expect("P0 product acceptance should pass");
}

fn run_p0_product_acceptance(fixture: &ProductAcceptanceFixture) -> Result<(), String> {
    let state = DesktopAppState::new(&fixture.data_root, &fixture.cache_root);
    let checker = GitCliProvider::with_cache_root(
        EnvironmentGitRunner::new(vec![
            (
                "GIT_CONFIG_GLOBAL".to_string(),
                fixture.gitconfig.to_string_lossy().to_string(),
            ),
            (
                "HOME".to_string(),
                fixture.home.to_string_lossy().to_string(),
            ),
        ]),
        state.cache_root().to_string_lossy().to_string(),
    );

    let initial_scan = scan_skills_for_state(&state, DesktopScanRequest::default())
        .map_err(|error| format!("首次启动与扫描失败: {error}"))?;
    assert_at_least_skill_count(&initial_scan.skills, 2)?;
    assert!(
        initial_scan.warnings.iter().any(|warning| warning
            .skill_path
            .as_deref()
            .is_some_and(|path| path.contains("broken-skill"))),
        "broken skill should produce a scan warning"
    );

    let visible_skill = initial_scan
        .skills
        .iter()
        .find(|skill| skill.name == "e2e-skill")
        .ok_or_else(|| "扫描结果缺少 e2e-skill".to_string())?;
    let source = bind_skill_source_for_state(
        &state,
        DesktopBindSourceRequest {
            skill_id: visible_skill.id.clone(),
            url: fixture.source_repo.to_string_lossy().to_string(),
            repo_path: "skills/e2e-skill".to_string(),
            ref_: "main".to_string(),
            credential_ref: None,
            trusted: true,
            auto_update: false,
        },
    )
    .map_err(|error| format!("绑定来源失败: {error}"))?;
    assert_eq!(source.url, fixture.source_repo.to_string_lossy());
    assert_eq!(source.repo_path, "skills/e2e-skill");

    let first_check = check_skill_updates_for_state_with_checker(
        &state,
        DesktopUpdateCheckRequest {
            skill_ids: vec![visible_skill.id.clone()],
        },
        &checker,
    )
    .map_err(|error| format!("初始检查更新失败: {error}"))?;
    assert_eq!(first_check[0].status, "UpToDate");
    assert_eq!(
        first_check[0]
            .source
            .as_ref()
            .and_then(|item| item.current_commit.as_deref()),
        Some(fixture.old_commit.as_str())
    );

    fixture.write_updated_source_commit();

    let second_check = check_skill_updates_for_state_with_checker(
        &state,
        DesktopUpdateCheckRequest {
            skill_ids: vec![visible_skill.id.clone()],
        },
        &checker,
    )
    .map_err(|error| format!("检查更新失败: {error}"))?;
    assert_eq!(second_check[0].status, "UpdateAvailable");
    assert_eq!(second_check[0].commits_behind, Some(1));
    assert_eq!(
        second_check[0]
            .diff_summary
            .as_ref()
            .map(|summary| (summary.files_added, summary.files_modified)),
        Some((1, 1))
    );

    let diff = get_skill_diff_for_state_with_checker(&state, visible_skill.id.clone(), &checker)
        .map_err(|error| format!("查看 diff 失败: {error}"))?;
    assert!(diff
        .files
        .iter()
        .any(|file| file.path.ends_with("SKILL.md")));
    assert!(diff
        .files
        .iter()
        .any(|file| file.path.ends_with("EXTRA.md")));
    assert!(diff
        .files
        .iter()
        .filter_map(|file| file.patch.as_deref())
        .any(|patch| patch.contains("Updated P0 acceptance skill")));

    let applied =
        apply_skill_update_for_state_with_checker(&state, visible_skill.id.clone(), &checker)
            .map_err(|error| format!("应用更新失败: {error}"))?;
    assert_eq!(applied.previous_commit, fixture.old_commit);
    assert_eq!(applied.new_commit, fixture.new_commit());
    assert!(
        fixture.installed_skill.join("EXTRA.md").is_file(),
        "updated skill should include new file"
    );

    let backups = list_skill_backups_for_state(&state, visible_skill.id.clone())
        .map_err(|error| format!("备份列表失败: {error}"))?;
    let pre_update_backup = backups
        .iter()
        .find(|backup| backup.reason == "pre-update")
        .ok_or_else(|| "缺少 pre-update 备份".to_string())?;

    let restored = restore_skill_backup_for_state(
        &state,
        DesktopRestoreBackupRequest {
            skill_id: visible_skill.id.clone(),
            backup_id: pre_update_backup.backup_id.clone(),
        },
    )
    .map_err(|error| format!("回滚失败: {error}"))?;
    assert_eq!(
        restored.restored_from_backup_id,
        pre_update_backup.backup_id
    );
    let restored_skill = fs::read_to_string(fixture.installed_skill.join("SKILL.md"))
        .map_err(|error| format!("读取回滚后 SKILL.md 失败: {error}"))?;
    assert!(restored_skill.contains("Initial P0 acceptance skill"));

    let report = ProductAcceptanceReport {
        fixture_root: fixture.workspace.clone(),
        report_path: fixture.report_path.clone(),
        scanned_skills: initial_scan.skills.len(),
        scan_warnings: initial_scan.warnings.len(),
        checked_status: second_check[0].status.clone(),
        diff_files: diff.files.len(),
        backup_count: backups.len(),
        restored_backup_id: restored.restored_from_backup_id,
    };
    write_product_acceptance_report(&report)?;
    assert!(fixture.report_path.is_file());

    Ok(())
}

struct ProductAcceptanceFixture {
    workspace: PathBuf,
    home: PathBuf,
    data_root: PathBuf,
    cache_root: PathBuf,
    source_repo: PathBuf,
    installed_skill: PathBuf,
    report_path: PathBuf,
    gitconfig: PathBuf,
    old_commit: String,
}

impl ProductAcceptanceFixture {
    fn create(workspace: &Path) -> Self {
        let home = workspace.join("home");
        let data_root = workspace.join("data");
        let cache_root = workspace.join("cache");
        let source_repo = workspace.join("repos/source-skill");
        let report_path = repo_root().join("target/product-acceptance/p0-product-acceptance.md");
        let gitconfig = workspace.join("gitconfig");
        fs::create_dir_all(workspace).expect("workspace should be created");
        fs::write(
            &gitconfig,
            "[user]\n  name = Metis Acceptance\n  email = metis-acceptance@example.invalid\n",
        )
        .expect("gitconfig should be written");

        let codex_root = home.join(".codex/skills");
        let claude_root = home.join(".claude/skills");
        let generic_root = home.join(".agent-skills");
        let installed_skill = codex_root.join("e2e-skill");
        write_skill(&installed_skill, "e2e-skill", "Initial P0 acceptance skill");
        write_skill(
            &claude_root.join("same-name-skill"),
            "same-name-skill",
            "Same skill name across agents",
        );
        write_skill(
            &generic_root.join("long-content-skill-with-a-very-long-directory-name-for-layout"),
            "long-content-skill",
            "Long description ".repeat(16).trim(),
        );
        let broken_skill = codex_root.join("broken-skill");
        fs::create_dir_all(&broken_skill).expect("broken skill directory should be created");
        fs::write(
            broken_skill.join("SKILL.md"),
            "---\nname: broken-skill\ndescription: missing closing front matter\n",
        )
        .expect("broken skill metadata should be written");

        fs::create_dir_all(source_repo.join("skills/e2e-skill"))
            .expect("source skill directory should be created");
        write_skill(
            &source_repo.join("skills/e2e-skill"),
            "e2e-skill",
            "Initial P0 acceptance skill",
        );
        git(&source_repo, &["init"]);
        git(&source_repo, &["checkout", "-b", "main"]);
        git(&source_repo, &["add", "."]);
        let old_commit = git_commit(&source_repo, "initial p0 skill");

        Self {
            workspace: workspace.to_path_buf(),
            home,
            data_root,
            cache_root,
            source_repo,
            installed_skill,
            report_path,
            gitconfig,
            old_commit,
        }
    }

    fn write_updated_source_commit(&self) {
        write_skill(
            &self.source_repo.join("skills/e2e-skill"),
            "e2e-skill",
            "Updated P0 acceptance skill",
        );
        fs::write(
            self.source_repo.join("skills/e2e-skill/EXTRA.md"),
            "extra acceptance fixture file\n",
        )
        .expect("extra source file should be written");
        git(&self.source_repo, &["add", "."]);
        git_commit(&self.source_repo, "updated p0 skill");
    }

    fn new_commit(&self) -> String {
        git_stdout(&self.source_repo, &["rev-parse", "HEAD"])
            .trim()
            .to_string()
    }
}

struct ProductAcceptanceReport {
    fixture_root: PathBuf,
    report_path: PathBuf,
    scanned_skills: usize,
    scan_warnings: usize,
    checked_status: String,
    diff_files: usize,
    backup_count: usize,
    restored_backup_id: String,
}

fn write_product_acceptance_report(report: &ProductAcceptanceReport) -> Result<(), String> {
    if let Some(parent) = report.report_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let contents = format!(
        "# Metis P0 产品功能真实验收报告\n\n\
         - Fixture: `{}`\n\
         - 扫描 skills: {}\n\
         - 扫描 warnings: {}\n\
         - 更新检查状态: {}\n\
         - Diff 文件数: {}\n\
         - 备份数: {}\n\
         - 回滚备份: `{}`\n\n\
         ## 覆盖范围\n\n\
         - 首次启动与扫描：真实 HOME 下 Codex / Claude fixture。\n\
         - 绑定来源：真实本地 Git repo。\n\
         - 检查更新：真实 Git ref / commits behind / diff summary。\n\
         - 查看 diff：真实 `git diff` 输出。\n\
         - 备份与回滚：真实 SQLite、备份目录和文件覆盖。\n\n\
         ## 未覆盖风险\n\n\
         - 本报告由 desktop command 层验收生成，真实 Tauri 窗口点击级自动化仍需单独接入。\n",
        report.fixture_root.display(),
        report.scanned_skills,
        report.scan_warnings,
        report.checked_status,
        report.diff_files,
        report.backup_count,
        report.restored_backup_id,
    );
    fs::write(&report.report_path, contents).map_err(|error| error.to_string())
}

fn assert_at_least_skill_count<T>(items: &[T], expected_minimum: usize) -> Result<(), String> {
    if items.len() < expected_minimum {
        return Err(format!(
            "扫描结果数量不足：期望至少 {expected_minimum} 个，实际 {} 个",
            items.len()
        ));
    }
    Ok(())
}

fn write_skill(path: &Path, name: &str, description: &str) {
    fs::create_dir_all(path).expect("skill dir should be created");
    fs::write(
        path.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: {description}\n---\n"),
    )
    .expect("skill metadata should be written");
}

fn git(repo: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(["-C", &repo.to_string_lossy()])
        .args(args)
        .output()
        .expect("git should run");
    assert!(
        output.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_stdout(repo: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(["-C", &repo.to_string_lossy()])
        .args(args)
        .output()
        .expect("git should run");
    assert!(
        output.status.success(),
        "git {} failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn git_commit(repo: &Path, message: &str) -> String {
    let output = Command::new("git")
        .args(["-C", &repo.to_string_lossy()])
        .args([
            "-c",
            "user.name=Metis Acceptance",
            "-c",
            "user.email=metis-acceptance@example.invalid",
        ])
        .args(["commit", "-m", message])
        .output()
        .expect("git commit should run");
    assert!(
        output.status.success(),
        "git commit failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    git_stdout(repo, &["rev-parse", "HEAD"]).trim().to_string()
}

fn temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("metis-{name}-{suffix}"))
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("repo root should resolve")
}

fn restore_env(key: &str, value: Option<std::ffi::OsString>) {
    if let Some(value) = value {
        std::env::set_var(key, value);
    } else {
        std::env::remove_var(key);
    }
}
