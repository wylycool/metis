use serde::{Deserialize, Serialize};
use std::env;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use wait_timeout::ChildExt;

const GIT_RUNTIME_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitRuntime {
    executable: PathBuf,
    version: String,
    path_environment: Option<String>,
    source: GitRuntimeSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GitRuntimeSource {
    LoginShell,
    ProcessPathFallback,
    WindowsPath,
}

impl GitRuntime {
    pub fn executable(&self) -> &Path {
        &self.executable
    }

    pub fn environment(&self) -> Vec<(String, String)> {
        self.path_environment
            .as_ref()
            .map(|path| vec![("PATH".to_string(), path.clone())])
            .unwrap_or_default()
    }
}

pub trait GitRuntimeResolver: Send + Sync {
    fn resolve(&self) -> Result<GitRuntime, String>;
}

#[derive(Debug, Default)]
pub struct SystemGitRuntimeResolver;

impl GitRuntimeResolver for SystemGitRuntimeResolver {
    fn resolve(&self) -> Result<GitRuntime, String> {
        let started = Instant::now();
        eprintln!(
            "[metis][git-runtime] resolve start timeout_ms={}",
            GIT_RUNTIME_TIMEOUT.as_millis()
        );

        #[cfg(target_os = "windows")]
        {
            return resolve_windows_path_runtime();
        }

        #[cfg(not(target_os = "windows"))]
        match resolve_login_shell_runtime() {
            Ok(runtime) => {
                eprintln!(
                    "[metis][git-runtime] resolve selected source=login-shell executable={} version={} elapsed_ms={}",
                    runtime.executable.display(),
                    runtime.version,
                    started.elapsed().as_millis()
                );
                Ok(runtime)
            }
            Err(error) => {
                eprintln!(
                    "[metis][git-runtime] login-shell unavailable reason={} fallback=process-path",
                    sanitized_reason(&error)
                );
                let runtime = resolve_process_path_fallback()?;
                eprintln!(
                    "[metis][git-runtime] resolve selected source=process-path executable={} version={} elapsed_ms={}",
                    runtime.executable.display(),
                    runtime.version,
                    started.elapsed().as_millis()
                );
                Ok(runtime)
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn resolve_windows_path_runtime() -> Result<GitRuntime, String> {
    let path_environment = env::var_os("PATH").ok_or_else(|| "未找到可用 Git".to_string())?;
    let path_text = path_environment.to_string_lossy().to_string();
    let executable = first_git_in_path(&path_text).ok_or_else(|| "未找到可用 Git".to_string())?;
    let version = validate_git(&executable, Some(&path_text))?;
    eprintln!(
        "[metis][git-runtime] resolve selected source=windows-path executable={} version={}",
        executable.display(),
        version
    );
    Ok(GitRuntime {
        executable,
        version,
        path_environment: Some(path_text),
        source: GitRuntimeSource::WindowsPath,
    })
}

pub struct GitRuntimeManager {
    resolver: Arc<dyn GitRuntimeResolver>,
    current: Mutex<Option<GitRuntime>>,
    state_file: Option<PathBuf>,
}

impl std::fmt::Debug for GitRuntimeManager {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("GitRuntimeManager")
            .finish_non_exhaustive()
    }
}

impl Default for GitRuntimeManager {
    fn default() -> Self {
        Self::new(Arc::new(SystemGitRuntimeResolver))
    }
}

impl GitRuntimeManager {
    pub fn new(resolver: Arc<dyn GitRuntimeResolver>) -> Self {
        Self {
            resolver,
            current: Mutex::new(None),
            state_file: None,
        }
    }

    pub fn system(state_file: PathBuf) -> Self {
        Self {
            resolver: Arc::new(SystemGitRuntimeResolver),
            current: Mutex::new(None),
            state_file: Some(state_file),
        }
    }

    pub fn current_or_resolve(&self, force_refresh: bool) -> Result<GitRuntime, String> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| "Git Runtime 状态暂时不可用，请重启 Metis 后重试。".to_string())?;
        if !force_refresh {
            if let Some(runtime) = current.as_ref() {
                eprintln!(
                    "[metis][git-runtime] cache hit executable={} version={}",
                    runtime.executable.display(),
                    runtime.version
                );
                return Ok(runtime.clone());
            }
            if let Some(runtime) = self.load_persisted_runtime()? {
                eprintln!(
                    "[metis][git-runtime] persisted runtime accepted executable={} version={}",
                    runtime.executable.display(),
                    runtime.version
                );
                *current = Some(runtime.clone());
                return Ok(runtime);
            }
        }

        eprintln!(
            "[metis][git-runtime] cache {}",
            if force_refresh { "refresh" } else { "miss" }
        );
        match self.resolver.resolve() {
            Ok(runtime) => {
                self.persist_runtime(&runtime);
                *current = Some(runtime.clone());
                Ok(runtime)
            }
            Err(error) => {
                if let Some(runtime) = current.as_ref() {
                    eprintln!(
                        "[metis][git-runtime] refresh failed reason={} keep_current=true",
                        sanitized_reason(&error)
                    );
                    return Ok(runtime.clone());
                }
                Err(error)
            }
        }
    }

    fn load_persisted_runtime(&self) -> Result<Option<GitRuntime>, String> {
        let Some(state_file) = self.state_file.as_ref() else {
            return Ok(None);
        };
        if !state_file.is_file() {
            return Ok(None);
        }
        let contents = match std::fs::read_to_string(state_file) {
            Ok(contents) => contents,
            Err(error) => {
                eprintln!(
                    "[metis][git-runtime] persisted runtime read failed reason={}",
                    sanitized_reason(&error.to_string())
                );
                return Ok(None);
            }
        };
        let persisted: PersistedGitRuntime = match serde_json::from_str(&contents) {
            Ok(persisted) => persisted,
            Err(_) => {
                eprintln!("[metis][git-runtime] persisted runtime invalid");
                return Ok(None);
            }
        };
        let executable = PathBuf::from(&persisted.executable);
        if !is_executable(&executable) {
            eprintln!("[metis][git-runtime] persisted runtime executable unavailable");
            return Ok(None);
        }
        let version = match validate_git(&executable, persisted.path_environment.as_deref()) {
            Ok(version) => version,
            Err(error) => {
                eprintln!(
                    "[metis][git-runtime] persisted runtime validation failed reason={}",
                    sanitized_reason(&error)
                );
                return Ok(None);
            }
        };
        Ok(Some(GitRuntime {
            executable,
            version,
            path_environment: persisted.path_environment,
            source: persisted.source,
        }))
    }

    fn persist_runtime(&self, runtime: &GitRuntime) {
        let Some(state_file) = self.state_file.as_ref() else {
            return;
        };
        let Some(parent) = state_file.parent() else {
            return;
        };
        let persisted = PersistedGitRuntime {
            executable: runtime.executable.to_string_lossy().to_string(),
            path_environment: runtime.path_environment.clone(),
            source: runtime.source,
        };
        let Ok(contents) = serde_json::to_vec_pretty(&persisted) else {
            return;
        };
        if std::fs::create_dir_all(parent).is_err() {
            return;
        }
        if std::fs::write(state_file, contents).is_ok() {
            eprintln!("[metis][git-runtime] persisted runtime saved");
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedGitRuntime {
    executable: String,
    path_environment: Option<String>,
    source: GitRuntimeSource,
}

pub fn run_detection_git(runtime: &GitRuntime, args: &[&OsStr]) -> Result<Output, String> {
    let mut command = Command::new(runtime.executable());
    command.args(args);
    if let Some(path) = runtime.path_environment.as_ref() {
        command.env("PATH", path);
    }
    run_command_with_timeout(
        command,
        GIT_RUNTIME_TIMEOUT,
        &format!("git {}", sanitized_git_operation(args)),
    )
}

#[cfg(not(target_os = "windows"))]
fn resolve_login_shell_runtime() -> Result<GitRuntime, String> {
    let shell = login_shell()?;
    eprintln!(
        "[metis][git-runtime] login shell detected executable={}",
        shell.display()
    );
    let path_environment = login_shell_path(&shell)?;
    let git = first_git_in_path(&path_environment)
        .ok_or_else(|| "登录 Shell PATH 中没有可执行 Git".to_string())?;
    let version = validate_git(&git, Some(&path_environment))?;
    Ok(GitRuntime {
        executable: git,
        version,
        path_environment: Some(path_environment),
        source: GitRuntimeSource::LoginShell,
    })
}

#[cfg(not(target_os = "windows"))]
fn resolve_process_path_fallback() -> Result<GitRuntime, String> {
    let executable = env::var_os("PATH")
        .and_then(|path| first_git_in_path(&path.to_string_lossy()))
        .unwrap_or_else(|| PathBuf::from("git"));
    let version = validate_git(&executable, None)?;
    Ok(GitRuntime {
        executable,
        version,
        path_environment: None,
        source: GitRuntimeSource::ProcessPathFallback,
    })
}

#[cfg(not(target_os = "windows"))]
fn login_shell() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    if let Ok(shell) = macos_account_shell() {
        return Ok(shell);
    }

    env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|shell| is_executable(shell))
        .ok_or_else(|| "无法确定用户登录 Shell".to_string())
}

#[cfg(target_os = "macos")]
fn macos_account_shell() -> Result<PathBuf, String> {
    let user = env::var("USER").map_err(|_| "系统账户缺少 USER".to_string())?;
    let mut command = Command::new("/usr/bin/dscl");
    command.args([".", "-read", &format!("/Users/{user}"), "UserShell"]);
    let output = run_command_with_timeout(command, GIT_RUNTIME_TIMEOUT, "dscl UserShell")?;
    if !output.status.success() {
        return Err("读取系统账户登录 Shell 失败".to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let shell = stdout
        .split_once(':')
        .map(|(_, value)| PathBuf::from(value.trim()))
        .filter(|path| is_executable(path))
        .ok_or_else(|| "系统账户登录 Shell 无效".to_string())?;
    Ok(shell)
}

#[cfg(not(target_os = "windows"))]
fn login_shell_path(shell: &Path) -> Result<String, String> {
    let mut command = Command::new(shell);
    command.args(["-l", "-i", "-c", "/usr/bin/printenv PATH"]);
    let output = run_command_with_timeout(command, GIT_RUNTIME_TIMEOUT, "login shell PATH")?;
    if !output.status.success() {
        return Err("登录 Shell PATH 查询失败".to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty() && first_git_in_path(line).is_some())
        .map(str::to_string)
        .ok_or_else(|| "登录 Shell PATH 输出无效".to_string())
}

fn first_git_in_path(path_environment: &str) -> Option<PathBuf> {
    first_executable_in_path(path_environment, git_executable_name())
}

fn first_executable_in_path(path_environment: &str, executable_name: &str) -> Option<PathBuf> {
    env::split_paths(OsStr::new(path_environment))
        .map(|directory| directory.join(executable_name))
        .find(|candidate| is_executable(candidate))
}

fn git_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "git.exe"
    } else {
        "git"
    }
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn validate_git(executable: &Path, path_environment: Option<&str>) -> Result<String, String> {
    eprintln!(
        "[metis][git-runtime] validate start executable={} command=--version timeout_ms={}",
        executable.display(),
        GIT_RUNTIME_TIMEOUT.as_millis()
    );
    let mut command = Command::new(executable);
    command.arg("--version");
    if let Some(path) = path_environment {
        command.env("PATH", path);
    }
    let output = run_command_with_timeout(command, GIT_RUNTIME_TIMEOUT, "git --version")?;
    if !output.status.success() {
        return Err("git --version 执行失败".to_string());
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return Err("git --version 返回空结果".to_string());
    }
    Ok(version)
}

fn run_command_with_timeout(
    mut command: Command,
    timeout: Duration,
    label: &str,
) -> Result<Output, String> {
    let started = Instant::now();
    eprintln!(
        "[metis][git-runtime] command start label={} timeout_ms={}",
        label,
        timeout.as_millis()
    );
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("{label} 启动失败: {error}"))?;
    match child
        .wait_timeout(timeout)
        .map_err(|error| format!("{label} 等待失败: {error}"))?
    {
        Some(_) => {
            let output = child
                .wait_with_output()
                .map_err(|error| format!("{label} 输出读取失败: {error}"))?;
            eprintln!(
                "[metis][git-runtime] command finish label={} elapsed_ms={} status={}",
                label,
                started.elapsed().as_millis(),
                output.status
            );
            Ok(output)
        }
        None => {
            let _ = child.kill();
            let _ = child.wait();
            eprintln!(
                "[metis][git-runtime] command timeout label={} elapsed_ms={}",
                label,
                started.elapsed().as_millis()
            );
            Err(format!("{label} 超过 {}ms", timeout.as_millis()))
        }
    }
}

fn sanitized_git_operation(args: &[&OsStr]) -> String {
    if let Some(operation) = args.iter().find_map(|arg| {
        let value = arg.to_string_lossy();
        (!value.starts_with('-') && !value.contains(std::path::MAIN_SEPARATOR))
            .then(|| value.into_owned())
    }) {
        return operation;
    }
    let flags = args
        .iter()
        .filter_map(|arg| {
            let value = arg.to_string_lossy();
            value.starts_with('-').then(|| value.into_owned())
        })
        .collect::<Vec<_>>()
        .join(" ");
    if flags.is_empty() {
        "unknown".to_string()
    } else {
        flags
    }
}

fn sanitized_reason(reason: &str) -> String {
    if reason.contains("超时") || reason.contains("超过") {
        "timeout".to_string()
    } else {
        reason
            .split(':')
            .next()
            .unwrap_or("unknown")
            .chars()
            .take(120)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    struct SequenceResolver {
        results: Mutex<VecDeque<Result<GitRuntime, String>>>,
    }

    impl GitRuntimeResolver for SequenceResolver {
        fn resolve(&self) -> Result<GitRuntime, String> {
            self.results.lock().unwrap().pop_front().unwrap()
        }
    }

    fn runtime(path: &str, version: &str, source: GitRuntimeSource) -> GitRuntime {
        GitRuntime {
            executable: PathBuf::from(path),
            version: version.to_string(),
            path_environment: None,
            source,
        }
    }

    #[test]
    fn manager_reuses_runtime_until_forced_refresh_then_switches() {
        let resolver = Arc::new(SequenceResolver {
            results: Mutex::new(VecDeque::from([
                Ok(runtime(
                    "git",
                    "git version 2.30.1",
                    GitRuntimeSource::ProcessPathFallback,
                )),
                Ok(runtime(
                    "/opt/example/bin/git",
                    "git version 2.45.1",
                    GitRuntimeSource::LoginShell,
                )),
            ])),
        });
        let manager = GitRuntimeManager::new(resolver);

        assert_eq!(
            manager.current_or_resolve(false).unwrap().version,
            "git version 2.30.1"
        );
        assert_eq!(
            manager.current_or_resolve(false).unwrap().version,
            "git version 2.30.1"
        );
        assert_eq!(
            manager.current_or_resolve(true).unwrap().version,
            "git version 2.45.1"
        );
        assert_eq!(
            manager.current_or_resolve(false).unwrap().executable(),
            Path::new("/opt/example/bin/git")
        );
    }

    #[test]
    fn manager_keeps_existing_runtime_when_refresh_fails() {
        let resolver = Arc::new(SequenceResolver {
            results: Mutex::new(VecDeque::from([
                Ok(runtime(
                    "git",
                    "git version 2.30.1",
                    GitRuntimeSource::ProcessPathFallback,
                )),
                Err("login shell timeout".to_string()),
            ])),
        });
        let manager = GitRuntimeManager::new(resolver);

        manager.current_or_resolve(false).unwrap();
        let current = manager.current_or_resolve(true).unwrap();
        assert_eq!(current.version, "git version 2.30.1");
        assert_eq!(current.executable(), Path::new("git"));
    }

    #[test]
    fn finds_first_executable_git_in_login_path_order() {
        let root = std::env::temp_dir().join(format!("metis-git-runtime-{}", std::process::id()));
        let first = root.join("first");
        let second = root.join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let first_git = first.join(git_executable_name());
        let second_git = second.join(git_executable_name());
        std::fs::write(&first_git, "git").unwrap();
        std::fs::write(&second_git, "git").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&first_git, std::fs::Permissions::from_mode(0o755)).unwrap();
            std::fs::set_permissions(&second_git, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let joined = env::join_paths([&first, &second]).unwrap();

        assert_eq!(
            first_git_in_path(&joined.to_string_lossy()),
            Some(first_git)
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn windows_path_strategy_selects_first_git_exe_without_shell_discovery() {
        use std::os::unix::fs::PermissionsExt;

        let root =
            std::env::temp_dir().join(format!("metis-windows-git-runtime-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let first = root.join("first");
        let second = root.join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let first_git = first.join("git.exe");
        let second_git = second.join("git.exe");
        std::fs::write(&first_git, "git").unwrap();
        std::fs::write(&second_git, "git").unwrap();
        std::fs::set_permissions(&first_git, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::set_permissions(&second_git, std::fs::Permissions::from_mode(0o755)).unwrap();
        let joined = env::join_paths([&first, &second]).unwrap();

        assert_eq!(
            first_executable_in_path(&joined.to_string_lossy(), "git.exe"),
            Some(first_git)
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn version_probe_log_uses_version_flag_instead_of_unknown() {
        assert_eq!(
            sanitized_git_operation(&[OsStr::new("--version")]),
            "--version"
        );
    }

    #[cfg(unix)]
    #[test]
    fn timed_out_detection_command_is_killed_and_returns_error() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "while :; do :; done"]);
        let started = Instant::now();

        let error = run_command_with_timeout(command, Duration::from_millis(20), "timeout-test")
            .expect_err("busy command should time out");

        assert!(error.contains("超过 20ms"));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[test]
    fn persisted_runtime_is_reused_after_manager_restart() {
        use std::os::unix::fs::PermissionsExt;

        let root =
            std::env::temp_dir().join(format!("metis-git-runtime-persist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("git");
        std::fs::write(&executable, "#!/bin/sh\nprintf 'git version 9.9.9\\n'\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let state_file = root.join("runtime.json");
        let first = GitRuntimeManager {
            resolver: Arc::new(SequenceResolver {
                results: Mutex::new(VecDeque::from([Ok(GitRuntime {
                    executable: executable.clone(),
                    version: "git version 9.9.9".to_string(),
                    path_environment: None,
                    source: GitRuntimeSource::LoginShell,
                })])),
            }),
            current: Mutex::new(None),
            state_file: Some(state_file.clone()),
        };
        first.current_or_resolve(false).unwrap();

        let restarted = GitRuntimeManager {
            resolver: Arc::new(SequenceResolver {
                results: Mutex::new(VecDeque::from([Err("resolver should not run".to_string())])),
            }),
            current: Mutex::new(None),
            state_file: Some(state_file),
        };
        let restored = restarted.current_or_resolve(false).unwrap();

        assert_eq!(restored.executable, executable);
        assert_eq!(restored.version, "git version 9.9.9");
        let _ = std::fs::remove_dir_all(root);
    }
}
