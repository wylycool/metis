use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};

const MAX_INSTALLER_NAME_ATTEMPTS: usize = 1_000;
const MAX_TEMP_FILE_ATTEMPTS: usize = 100;
const OPERATION_IDLE: u8 = 0;
const OPERATION_CHECKING: u8 = 1;
const OPERATION_DOWNLOADING: u8 = 2;
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(20);
const UPDATE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SoftwareUpdateInfo {
    pub current_version: String,
    pub version: String,
    pub notes: Option<String>,
    pub published_at: Option<String>,
    pub file_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SoftwareUpdateDownloadResult {
    pub version: String,
    pub file_name: String,
    pub file_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum SoftwareUpdateDownloadEvent {
    Started {
        content_length: Option<u64>,
    },
    Progress {
        chunk_length: usize,
        downloaded: u64,
        content_length: Option<u64>,
    },
    Verifying,
    Saving,
    Finished {
        file_path: String,
    },
}

#[derive(Debug, Clone)]
struct DownloadedSoftwareUpdate {
    path: PathBuf,
    sha256: [u8; 32],
}

struct SavedVerifiedInstaller {
    path: PathBuf,
    sha256: [u8; 32],
}

#[derive(Default)]
pub struct SoftwareUpdateState {
    pending: Mutex<Option<Update>>,
    downloaded: Mutex<Option<DownloadedSoftwareUpdate>>,
    operation: AtomicU8,
}

#[tauri::command]
pub async fn check_software_update(
    app: AppHandle,
    state: State<'_, SoftwareUpdateState>,
) -> Result<Option<SoftwareUpdateInfo>, String> {
    if state
        .operation
        .compare_exchange(
            OPERATION_IDLE,
            OPERATION_CHECKING,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_err()
    {
        return Err("Metis 正在执行另一项软件更新操作，请稍后重试。".to_string());
    }
    let _operation_guard = SoftwareUpdateOperationGuard::new(&state.operation);

    let updater = app
        .updater_builder()
        .timeout(UPDATE_CHECK_TIMEOUT)
        .build()
        .map_err(|_| software_update_check_error())?;
    let update = updater
        .check()
        .await
        .map_err(|_| software_update_check_error())?;

    let mut pending = state
        .pending
        .lock()
        .map_err(|_| "软件更新状态暂时不可用，请重启 Metis 后重试。".to_string())?;
    match update {
        Some(mut update) => {
            update.timeout = Some(UPDATE_DOWNLOAD_TIMEOUT);
            let info = software_update_info(&update)?;
            *pending = Some(update);
            Ok(Some(info))
        }
        None => {
            *pending = None;
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn download_software_update(
    app: AppHandle,
    state: State<'_, SoftwareUpdateState>,
    progress_channel: Channel<SoftwareUpdateDownloadEvent>,
) -> Result<SoftwareUpdateDownloadResult, String> {
    if state
        .operation
        .compare_exchange(
            OPERATION_IDLE,
            OPERATION_DOWNLOADING,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .is_err()
    {
        return Err("Metis 正在执行另一项软件更新操作，请稍后重试。".to_string());
    }
    let _operation_guard = SoftwareUpdateOperationGuard::new(&state.operation);

    let update = state
        .pending
        .lock()
        .map_err(|_| "软件更新状态暂时不可用，请重启 Metis 后重试。".to_string())?
        .clone()
        .ok_or_else(|| "没有待下载的软件更新，请先重新检查。".to_string())?;
    let version = update.version.clone();
    let file_name = validated_update_file_name(&update, current_platform())?;
    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|_| "暂时无法使用下载目录，请稍后重试。".to_string())?;
    validate_downloads_directory(&downloads_dir)?;

    let _ = progress_channel.send(SoftwareUpdateDownloadEvent::Started {
        content_length: None,
    });
    let downloaded = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let progress_downloaded = downloaded.clone();
    let progress_events = progress_channel.clone();
    let verifying_events = progress_channel.clone();
    let bytes = update
        .download(
            move |chunk_length, content_length| {
                let downloaded = progress_downloaded
                    .fetch_add(chunk_length as u64, Ordering::AcqRel)
                    + chunk_length as u64;
                let _ = progress_events.send(SoftwareUpdateDownloadEvent::Progress {
                    chunk_length,
                    downloaded,
                    content_length,
                });
            },
            move || {
                let _ = verifying_events.send(SoftwareUpdateDownloadEvent::Verifying);
            },
        )
        .await
        .map_err(software_update_download_error)?;

    let _ = progress_channel.send(SoftwareUpdateDownloadEvent::Saving);
    let save_dir = downloads_dir.clone();
    let save_name = file_name.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || {
        save_verified_installer(&save_dir, &save_name, &bytes, current_platform())
    })
    .await
    .map_err(|_| "安装包保存失败，请稍后重试。".to_string())??;
    let saved_path = saved.path;
    let saved_path_text = saved_path.to_string_lossy().to_string();

    *state
        .downloaded
        .lock()
        .map_err(|_| "软件更新状态暂时不可用，请重启 Metis 后重试。".to_string())? =
        Some(DownloadedSoftwareUpdate {
            path: saved_path.clone(),
            sha256: saved.sha256,
        });
    *state
        .pending
        .lock()
        .map_err(|_| "软件更新状态暂时不可用，请重启 Metis 后重试。".to_string())? = None;

    let _ = progress_channel.send(SoftwareUpdateDownloadEvent::Finished {
        file_path: saved_path_text.clone(),
    });

    Ok(SoftwareUpdateDownloadResult {
        version,
        file_name: saved_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&file_name)
            .to_string(),
        file_path: saved_path_text,
    })
}

#[tauri::command]
pub async fn open_software_update_installer(
    app: AppHandle,
    state: State<'_, SoftwareUpdateState>,
) -> Result<(), String> {
    let downloaded = state
        .downloaded
        .lock()
        .map_err(|_| "软件更新状态暂时不可用，请重启 Metis 后重试。".to_string())?
        .clone()
        .ok_or_else(|| "当前没有已下载并通过校验的安装包。".to_string())?;
    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|_| "暂时无法使用下载目录，请稍后重试。".to_string())?;
    let verification_downloads = downloads_dir.clone();
    let verification_downloaded = downloaded.clone();
    if let Err(error) = tauri::async_runtime::spawn_blocking(move || {
        verify_downloaded_installer(
            &verification_downloads,
            &verification_downloaded.path,
            current_platform(),
            &verification_downloaded.sha256,
        )
    })
    .await
    .map_err(|_| "安装包校验失败，请重新下载。".to_string())?
    {
        *state
            .downloaded
            .lock()
            .map_err(|_| "软件更新状态暂时不可用，请重启 Metis 后重试。".to_string())? = None;
        return Err(error);
    }
    tauri_plugin_opener::open_path(&downloaded.path, None::<&str>)
        .map_err(|_| "暂时无法打开安装包，请稍后重试。".to_string())
}

#[tauri::command]
pub fn open_downloads_directory(app: AppHandle) -> Result<(), String> {
    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|_| "暂时无法使用下载目录，请稍后重试。".to_string())?;
    validate_downloads_directory(&downloads_dir)?;
    tauri_plugin_opener::open_path(&downloads_dir, None::<&str>)
        .map_err(|_| "暂时无法打开下载目录，请稍后重试。".to_string())
}

fn software_update_info(update: &Update) -> Result<SoftwareUpdateInfo, String> {
    Ok(SoftwareUpdateInfo {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        notes: update.body.clone(),
        published_at: update.date.map(|date| date.to_string()),
        file_name: validated_update_file_name(update, current_platform())?,
    })
}

fn software_update_check_error() -> String {
    "暂时无法获取更新信息，请稍后重试。".to_string()
}

fn software_update_download_error(error: UpdaterError) -> String {
    match error {
        UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_) => {
            "安装包校验失败，已停止下载，请勿安装该文件。".to_string()
        }
        _ => "更新没有下载完成，请检查网络后重试。".to_string(),
    }
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unsupported"
    }
}

fn validated_update_download_url(
    url: &tauri::Url,
    version: &str,
    platform: &str,
) -> Result<String, String> {
    let file_name = expected_installer_file_name(version, platform)?;
    let tag = format!("desktop-v{version}");
    let expected_segments = [
        "wylycool",
        "metis",
        "releases",
        "download",
        tag.as_str(),
        file_name.as_str(),
    ];
    let actual_segments = url
        .path_segments()
        .ok_or_else(|| "更新元数据包含无效的安装包地址。".to_string())?
        .collect::<Vec<_>>();
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || actual_segments != expected_segments
    {
        return Err("更新元数据包含非 Metis 官方版本的安装包地址。".to_string());
    }
    Ok(file_name)
}

fn validated_update_file_name(update: &Update, platform: &str) -> Result<String, String> {
    let file_name = validated_update_download_url(&update.download_url, &update.version, platform)?;
    validate_update_signature_file_name(&update.signature, &file_name)?;
    Ok(file_name)
}

fn validate_update_signature_file_name(
    encoded_signature: &str,
    expected_file_name: &str,
) -> Result<(), String> {
    if encoded_signature.len() > 16 * 1024 {
        return Err("更新签名数据异常，已停止下载。".to_string());
    }
    let signature_box = base64::engine::general_purpose::STANDARD
        .decode(encoded_signature)
        .map_err(|_| "更新签名数据无效，已停止下载。".to_string())?;
    let signature_text = std::str::from_utf8(&signature_box)
        .map_err(|_| "更新签名数据无效，已停止下载。".to_string())?;
    let mut trusted_comments = signature_text
        .lines()
        .filter_map(|line| line.strip_prefix("trusted comment: "));
    let trusted_comment = trusted_comments
        .next()
        .ok_or_else(|| "更新签名缺少可信文件信息，已停止下载。".to_string())?;
    if trusted_comments.next().is_some() {
        return Err("更新签名包含重复可信信息，已停止下载。".to_string());
    }
    let mut signed_file_names = trusted_comment
        .split('\t')
        .filter_map(|field| field.strip_prefix("file:"));
    let signed_file_name = signed_file_names
        .next()
        .ok_or_else(|| "更新签名缺少可信文件名，已停止下载。".to_string())?;
    if signed_file_names.next().is_some() {
        return Err("更新签名包含重复可信文件名，已停止下载。".to_string());
    }
    if !trusted_comment.starts_with("timestamp:") || signed_file_name != expected_file_name {
        return Err("更新签名与当前版本安装包不匹配，已停止下载。".to_string());
    }
    Ok(())
}

fn expected_installer_file_name(version: &str, platform: &str) -> Result<String, String> {
    let file_name = match platform {
        "macos" => format!("Metis_{version}_universal.dmg"),
        "windows" => format!("Metis_{version}_x64-setup.exe"),
        "linux" => format!("Metis_{version}_amd64.AppImage"),
        _ => return Err("当前系统暂不支持应用内软件更新。".to_string()),
    };
    validate_installer_file_name(&file_name, platform)?;
    Ok(file_name)
}

fn validate_installer_file_name(file_name: &str, platform: &str) -> Result<(), String> {
    if file_name == "."
        || file_name == ".."
        || !file_name.starts_with("Metis_")
        || file_name.contains('%')
        || !file_name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._+-()".contains(character))
    {
        return Err("更新元数据包含不安全的安装包文件名。".to_string());
    }

    let extension_matches = match platform {
        "macos" => file_name.ends_with(".dmg"),
        "windows" => file_name.ends_with(".exe"),
        "linux" => file_name.ends_with(".AppImage"),
        _ => false,
    };
    if !extension_matches {
        return Err("更新元数据没有提供当前系统支持的安装包。".to_string());
    }
    Ok(())
}

fn validate_downloads_directory(downloads_dir: &Path) -> Result<(), String> {
    let metadata = fs::metadata(downloads_dir)
        .map_err(|_| "暂时无法使用下载目录，请稍后重试。".to_string())?;
    if !metadata.is_dir() {
        return Err("系统 Downloads 路径不是目录。".to_string());
    }
    Ok(())
}

fn validate_downloaded_installer_path(
    downloads_dir: &Path,
    installer_path: &Path,
    platform: &str,
) -> Result<(), String> {
    validate_downloads_directory(downloads_dir)?;
    let metadata = fs::symlink_metadata(installer_path)
        .map_err(|_| "安装包已被移动或删除，请重新下载。".to_string())?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("已下载的安装包不是普通文件。".to_string());
    }
    let file_name = installer_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "已下载的安装包文件名无效。".to_string())?;
    validate_installer_file_name(file_name, platform)?;

    let canonical_downloads = downloads_dir
        .canonicalize()
        .map_err(|_| "暂时无法使用下载目录，请稍后重试。".to_string())?;
    let canonical_parent = installer_path
        .parent()
        .ok_or_else(|| "已下载的安装包没有父目录。".to_string())?
        .canonicalize()
        .map_err(|_| "安装包已被移动或删除，请重新下载。".to_string())?;
    if canonical_parent != canonical_downloads {
        return Err("拒绝打开 Downloads 目录之外的文件。".to_string());
    }
    Ok(())
}

fn verify_downloaded_installer(
    downloads_dir: &Path,
    installer_path: &Path,
    platform: &str,
    expected_sha256: &[u8; 32],
) -> Result<(), String> {
    validate_downloaded_installer_path(downloads_dir, installer_path, platform)?;
    let actual_sha256 =
        sha256_file(installer_path).map_err(|_| "安装包校验失败，请重新下载。".to_string())?;
    if &actual_sha256 != expected_sha256 {
        return Err("安装包内容已发生变化，请删除该文件并重新下载。".to_string());
    }
    set_installer_download_origin(installer_path, platform)
        .map_err(|_| "安装包安全检查未完成，请重新下载。".to_string())?;
    Ok(())
}

fn save_verified_installer(
    downloads_dir: &Path,
    file_name: &str,
    bytes: &[u8],
    platform: &str,
) -> Result<SavedVerifiedInstaller, String> {
    validate_downloads_directory(downloads_dir)?;
    validate_installer_file_name(file_name, platform)?;
    let (temp_path, mut temp_file) = create_unique_temp_file(downloads_dir, file_name)?;
    let mut pending = PendingFile::new(temp_path.clone());
    temp_file
        .write_all(bytes)
        .and_then(|_| temp_file.sync_all())
        .map_err(|_| pending.fail("安装包保存失败，请稍后重试。".to_string()))?;
    set_installer_permissions(&temp_path, platform)
        .map_err(|_| pending.fail("安装包保存失败，请稍后重试。".to_string()))?;
    drop(temp_file);
    set_installer_download_origin(&temp_path, platform)
        .map_err(|_| pending.fail("安装包安全检查未完成，请重新下载。".to_string()))?;

    for index in 0..MAX_INSTALLER_NAME_ATTEMPTS {
        let destination = installer_destination(downloads_dir, file_name, index);
        match rename_without_overwrite(&temp_path, &destination) {
            Ok(()) => {
                pending.disarm();
                return Ok(SavedVerifiedInstaller {
                    path: destination,
                    sha256: sha256_bytes(bytes),
                });
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::AlreadyExists | io::ErrorKind::PermissionDenied
                ) && destination.exists() =>
            {
                continue;
            }
            Err(_) => {
                return Err(pending.fail("安装包保存失败，请稍后重试。".to_string()));
            }
        }
    }

    Err(pending.fail("Downloads 中同名安装包过多，无法生成安全文件名。".to_string()))
}

fn sha256_bytes(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn sha256_file(path: &Path) -> io::Result<[u8; 32]> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().into())
}

fn create_unique_temp_file(
    downloads_dir: &Path,
    file_name: &str,
) -> Result<(PathBuf, File), String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    for attempt in 0..MAX_TEMP_FILE_ATTEMPTS {
        let path = downloads_dir.join(format!(
            ".{file_name}.{}.{}.{}.part",
            std::process::id(),
            now,
            attempt
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("安装包保存失败，请稍后重试。".to_string()),
        }
    }
    Err("无法在 Downloads 创建唯一临时安装包。".to_string())
}

fn installer_destination(downloads_dir: &Path, file_name: &str, index: usize) -> PathBuf {
    if index == 0 {
        return downloads_dir.join(file_name);
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(file_name);
    let extension = path.extension().and_then(|extension| extension.to_str());
    match extension {
        Some(extension) => downloads_dir.join(format!("{stem}-{index}.{extension}")),
        None => downloads_dir.join(format!("{stem}-{index}")),
    }
}

#[cfg(unix)]
fn set_installer_permissions(path: &Path, platform: &str) -> io::Result<()> {
    if platform == "linux" {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn set_installer_permissions(_path: &Path, _platform: &str) -> io::Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_installer_download_origin(path: &Path, platform: &str) -> io::Result<()> {
    if platform != "macos" {
        return Ok(());
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let quarantine = format!("0081;{timestamp:x};Metis;");
    xattr::set(path, "com.apple.quarantine", quarantine.as_bytes())
}

#[cfg(windows)]
fn set_installer_download_origin(path: &Path, platform: &str) -> io::Result<()> {
    if platform != "windows" {
        return Ok(());
    }
    let mut zone_identifier = path.as_os_str().to_os_string();
    zone_identifier.push(":Zone.Identifier");
    fs::write(
        PathBuf::from(zone_identifier),
        b"[ZoneTransfer]\r\nZoneId=3\r\n",
    )
}

#[cfg(not(any(target_os = "macos", windows)))]
fn set_installer_download_origin(_path: &Path, _platform: &str) -> io::Result<()> {
    Ok(())
}

struct PendingFile {
    path: PathBuf,
    armed: bool,
}

impl PendingFile {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }

    fn fail(&mut self, message: String) -> String {
        match fs::remove_file(&self.path) {
            Ok(()) => self.armed = false,
            Err(error) if error.kind() == io::ErrorKind::NotFound => self.armed = false,
            Err(_) => return format!("{message} 请稍后重试。"),
        }
        message
    }
}

impl Drop for PendingFile {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

struct SoftwareUpdateOperationGuard<'a> {
    operation: &'a AtomicU8,
}

impl<'a> SoftwareUpdateOperationGuard<'a> {
    fn new(operation: &'a AtomicU8) -> Self {
        Self { operation }
    }
}

impl Drop for SoftwareUpdateOperationGuard<'_> {
    fn drop(&mut self) {
        self.operation.store(OPERATION_IDLE, Ordering::Release);
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
fn rename_without_overwrite(_source: &Path, _target: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "atomic no-replace rename is unsupported on this platform",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use minisign_verify::{PublicKey, Signature};
    use std::fs;

    #[test]
    fn updater_errors_never_expose_internal_messages() {
        let check_message = software_update_check_error();
        assert_eq!(check_message, "暂时无法获取更新信息，请稍后重试。");
        assert!(!check_message.contains("JSON"));
        assert!(!check_message.contains("remote"));

        let download_message =
            software_update_download_error(UpdaterError::Network("connection reset".to_string()));
        assert_eq!(download_message, "更新没有下载完成，请检查网络后重试。");
        assert!(!download_message.contains("connection reset"));
    }

    #[test]
    fn installer_file_name_only_accepts_safe_platform_package() {
        assert_eq!(
            validated_update_download_url(
                &tauri::Url::parse(
                    "https://github.com/wylycool/metis/releases/download/desktop-v1.5.1/Metis_1.5.1_universal.dmg",
                )
                .expect("valid update URL should parse"),
                "1.5.1",
                "macos",
            )
            .expect("DMG should be accepted"),
            "Metis_1.5.1_universal.dmg"
        );
        assert_eq!(
            validated_update_download_url(
                &tauri::Url::parse(
                    "https://github.com/wylycool/metis/releases/download/desktop-v1.5.1+build.1/Metis_1.5.1+build.1_universal.dmg",
                )
                .expect("valid build metadata URL should parse"),
                "1.5.1+build.1",
                "macos",
            )
            .expect("SemVer build metadata should be accepted"),
            "Metis_1.5.1+build.1_universal.dmg"
        );
        for rejected in [
            "http://github.com/wylycool/metis/releases/download/desktop-v1.5.1/Metis_1.5.1_universal.dmg",
            "https://example.test/wylycool/metis/releases/download/desktop-v1.5.1/Metis_1.5.1_universal.dmg",
            "https://github.com/other/metis/releases/download/desktop-v1.5.1/Metis_1.5.1_universal.dmg",
            "https://github.com/wylycool/metis/releases/download/desktop-v9.9.9/Metis_1.5.1_universal.dmg",
            "https://github.com/wylycool/metis/releases/download/desktop-v1.5.1/Metis_1.5.0_universal.dmg",
            "https://github.com/wylycool/metis/releases/download/desktop-v1.5.1/Metis_1.5.1_x64-setup.exe",
            "https://github.com/wylycool/metis/releases/download/desktop-v1.5.1/Metis_1.5.1_universal.dmg?source=other",
        ] {
            assert!(
                validated_update_download_url(
                    &tauri::Url::parse(rejected).expect("rejected URL should still parse"),
                    "1.5.1",
                    "macos",
                )
                .is_err(),
                "URL should be rejected: {rejected}",
            );
        }
    }

    #[test]
    fn updater_signature_trusted_comment_is_bound_to_the_expected_file_name() {
        let expected = "Metis_1.5.1_universal.dmg";
        let matching = base64::engine::general_purpose::STANDARD.encode(format!(
            "untrusted comment: signature from tauri secret key\nAAAA\ntrusted comment: timestamp:1\tfile:{expected}\nBBBB\n"
        ));
        validate_update_signature_file_name(&matching, expected)
            .expect("matching signed file name should be accepted");

        let replayed = base64::engine::general_purpose::STANDARD.encode(
            "untrusted comment: signature from tauri secret key\nAAAA\ntrusted comment: timestamp:1\tfile:Metis_1.5.0_universal.dmg\nBBBB\n",
        );
        assert!(validate_update_signature_file_name(&replayed, expected).is_err());
        assert!(validate_update_signature_file_name("not-base64", expected).is_err());
    }

    #[test]
    fn software_update_operation_state_serializes_check_and_download() {
        let operation = AtomicU8::new(OPERATION_IDLE);
        operation
            .compare_exchange(
                OPERATION_IDLE,
                OPERATION_CHECKING,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .expect("first operation should start");
        let guard = SoftwareUpdateOperationGuard::new(&operation);
        assert!(operation
            .compare_exchange(
                OPERATION_IDLE,
                OPERATION_DOWNLOADING,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_err());

        drop(guard);
        operation
            .compare_exchange(
                OPERATION_IDLE,
                OPERATION_DOWNLOADING,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .expect("download should start after check finishes");
    }

    #[ignore = "requires signed desktop release packages"]
    #[test]
    fn ci_updater_signatures_verify_against_configured_public_key() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace_root = manifest_dir
            .ancestors()
            .nth(3)
            .expect("desktop manifest should be inside the workspace");
        let tauri_config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json"))
                .expect("Tauri config should parse");
        let encoded_public_key = tauri_config["plugins"]["updater"]["pubkey"]
            .as_str()
            .expect("updater pubkey should be configured");
        let public_key_box = base64::engine::general_purpose::STANDARD
            .decode(encoded_public_key)
            .expect("updater pubkey should be base64");
        let public_key = PublicKey::decode(
            std::str::from_utf8(&public_key_box).expect("updater pubkey should be UTF-8"),
        )
        .expect("updater pubkey should be a minisign public key");
        let search_roots = [
            workspace_root.join("target/universal-apple-darwin/release/bundle/dmg"),
            workspace_root.join("target/release/bundle/nsis"),
            workspace_root.join("target/release/bundle/appimage"),
        ];
        let mut signatures = Vec::new();
        for search_root in search_roots {
            if !search_root.is_dir() {
                continue;
            }
            signatures.extend(
                fs::read_dir(search_root)
                    .expect("updater bundle directory should list")
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .filter(|path| {
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .is_some_and(|name| {
                                name.starts_with("Metis_") && name.ends_with(".sig")
                            })
                    }),
            );
        }
        assert!(
            !signatures.is_empty(),
            "no signed updater packages were found"
        );

        for signature_path in signatures {
            let package_path = signature_path.with_extension("");
            let signature_box = base64::engine::general_purpose::STANDARD
                .decode(fs::read(&signature_path).expect("signature should read"))
                .expect("signature should be base64");
            let signature = Signature::decode(
                std::str::from_utf8(&signature_box).expect("signature should be UTF-8"),
            )
            .expect("signature should be a minisign signature");
            let package = fs::read(&package_path).expect("signed package should read");
            public_key
                .verify(&package, &signature, false)
                .unwrap_or_else(|error| {
                    panic!(
                        "{} does not verify against plugins.updater.pubkey: {error}",
                        package_path.display()
                    )
                });
        }
    }

    #[test]
    fn verified_installer_save_uses_unique_name_and_keeps_existing_file() {
        let root = test_dir("unique-installer");
        let existing = root.join("Metis_1.5.1_universal.dmg");
        fs::write(&existing, b"existing").expect("existing package should be written");

        let saved = save_verified_installer(
            &root,
            "Metis_1.5.1_universal.dmg",
            b"verified package",
            "macos",
        )
        .expect("verified package should be saved");

        assert_eq!(
            fs::read(&existing).expect("existing package should remain"),
            b"existing"
        );
        assert_ne!(saved.path, existing);
        assert_eq!(
            fs::read(&saved.path).expect("saved package should be readable"),
            b"verified package"
        );
        assert_eq!(saved.sha256, sha256_bytes(b"verified package"));
        verify_downloaded_installer(&root, &saved.path, "macos", &saved.sha256)
            .expect("uniquely named package should remain openable");
        assert!(!fs::read_dir(&root)
            .expect("downloads should list")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().ends_with(".part")));

        fs::remove_dir_all(&root).expect("test directory should be removed");
    }

    #[test]
    fn downloaded_installer_must_remain_inside_downloads_directory() {
        let root = test_dir("download-boundary");
        let installer = root.join("Metis_1.5.1_universal.dmg");
        fs::write(&installer, b"verified").expect("installer should be written");
        let outside = root
            .parent()
            .expect("root should have parent")
            .join(format!("outside-installer-{}.dmg", std::process::id()));
        fs::write(&outside, b"outside").expect("outside file should be written");

        validate_downloaded_installer_path(&root, &installer, "macos")
            .expect("verified Downloads package should be accepted");
        assert!(validate_downloaded_installer_path(&root, &outside, "macos").is_err());

        fs::remove_file(outside).expect("outside file should be removed");
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn downloaded_installer_hash_detects_changes_before_opening() {
        let root = test_dir("download-hash");
        let saved = save_verified_installer(
            &root,
            "Metis_1.5.1_universal.dmg",
            b"verified package",
            "macos",
        )
        .expect("verified package should be saved");

        verify_downloaded_installer(&root, &saved.path, "macos", &saved.sha256)
            .expect("unchanged installer should verify");
        fs::write(&saved.path, b"tampered package").expect("installer should be replaced");
        let error = verify_downloaded_installer(&root, &saved.path, "macos", &saved.sha256)
            .expect_err("changed installer should be rejected");

        assert!(error.contains("内容已发生变化"));
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_installer_keeps_the_system_quarantine_warning() {
        let root = test_dir("macos-quarantine");
        let saved = save_verified_installer(
            &root,
            "Metis_1.5.1_universal.dmg",
            b"verified package",
            "macos",
        )
        .expect("verified package should be saved");

        let quarantine = xattr::get(&saved.path, "com.apple.quarantine")
            .expect("quarantine attribute should read")
            .expect("quarantine attribute should exist");
        let quarantine =
            String::from_utf8(quarantine).expect("quarantine attribute should be UTF-8");
        assert!(quarantine.starts_with("0081;"));
        assert!(quarantine.contains(";Metis;"));

        xattr::remove(&saved.path, "com.apple.quarantine")
            .expect("quarantine attribute should be removable for the test");
        verify_downloaded_installer(&root, &saved.path, "macos", &saved.sha256)
            .expect("opening should restore the system warning marker");
        assert!(xattr::get(&saved.path, "com.apple.quarantine")
            .expect("restored quarantine attribute should read")
            .is_some());

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[cfg(windows)]
    #[test]
    fn windows_installer_keeps_the_internet_zone_marker() {
        let root = test_dir("windows-zone-identifier");
        let saved = save_verified_installer(
            &root,
            "Metis_1.5.1_x64-setup.exe",
            b"verified package",
            "windows",
        )
        .expect("verified package should be saved");
        let mut zone_identifier = saved.path.as_os_str().to_os_string();
        zone_identifier.push(":Zone.Identifier");
        let zone_identifier = PathBuf::from(zone_identifier);

        assert_eq!(
            fs::read_to_string(&zone_identifier).expect("Zone.Identifier should read"),
            "[ZoneTransfer]\r\nZoneId=3\r\n"
        );
        fs::remove_file(&zone_identifier).expect("Zone.Identifier should be removable for test");
        verify_downloaded_installer(&root, &saved.path, "windows", &saved.sha256)
            .expect("opening should restore the Internet Zone marker");
        assert_eq!(
            fs::read_to_string(&zone_identifier).expect("restored Zone.Identifier should read"),
            "[ZoneTransfer]\r\nZoneId=3\r\n"
        );

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn appimage_is_saved_with_execute_permission() {
        use std::os::unix::fs::PermissionsExt;

        let root = test_dir("appimage-mode");
        let saved = save_verified_installer(
            &root,
            "Metis_1.5.1_amd64.AppImage",
            b"verified appimage",
            "linux",
        )
        .expect("AppImage should be saved");
        let mode = fs::metadata(&saved.path)
            .expect("AppImage metadata should load")
            .permissions()
            .mode();

        assert_ne!(mode & 0o111, 0);
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    fn test_dir(label: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "metis-software-update-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should be after epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&path).expect("test directory should be created");
        path
    }
}
