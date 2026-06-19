export type LoadState = "idle" | "loading" | "loaded" | "error";

export interface DesktopAgentPath {
  path: string;
  scope: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
}

export interface DesktopAgentStatus {
  agent_id: string;
  agent_name: string;
  enabled: boolean;
  paths: DesktopAgentPath[];
}

export interface DesktopSkill {
  id: string;
  agent_id: string;
  agent_name: string;
  name: string;
  description?: string | null;
  install_path: string;
  metadata_path?: string | null;
  metadata_status: string;
  metadata_error?: string | null;
  source_id?: string | null;
  source?: DesktopSource | null;
  local_modified?: boolean | null;
  last_scanned_at: string;
}

export interface DesktopSource {
  id: string;
  source_type: string;
  url: string;
  repo_path: string;
  ref_: string;
  current_commit?: string | null;
  remote_commit?: string | null;
  last_checked_at?: string | null;
  trusted: boolean;
  auto_update: boolean;
  credential_ref?: string | null;
}

export interface DesktopSettings {
  custom_scan_paths: string[];
}

export interface DesktopBindSourceRequest {
  skill_id: string;
  url: string;
  repo_path: string;
  ref_: string;
  credential_ref?: string | null;
  trusted: boolean;
  auto_update: boolean;
}

export interface DesktopUpdateCheckRequest {
  skill_ids: string[];
}

export interface DesktopDiffSummary {
  files_added: number;
  files_modified: number;
  files_deleted: number;
  total_changes: number;
}

export interface DesktopFileDiff {
  path: string;
  old_path?: string | null;
  status: string;
  patch?: string | null;
}

export interface DesktopDiffDetail {
  skill_id: string;
  current_commit: string;
  target_commit: string;
  files: DesktopFileDiff[];
}

export interface DesktopSecurityFinding {
  severity: string;
  rule_id: string;
  message: string;
  relative_path: string;
  line?: number | null;
}

export interface DesktopApplyUpdateResult {
  skill_id: string;
  previous_commit: string;
  new_commit: string;
  backup_id: string;
  security_findings: DesktopSecurityFinding[];
  warnings: string[];
}

export interface DesktopBackupSummary {
  backup_id: string;
  skill_id: string;
  source_commit?: string | null;
  backup_path: string;
  created_at: string;
  reason: string;
  file_count: number;
  total_size_bytes: number;
}

export interface DesktopRestoreBackupRequest {
  skill_id: string;
  backup_id: string;
}

export interface DesktopRestoreBackupResult {
  skill_id: string;
  restored_from_backup_id: string;
  previous_state_backup_id: string;
}

export interface DesktopUpdateCheckResult {
  skill_id: string;
  skill_name: string;
  status: string;
  failure_reason?: string | null;
  local_modified: boolean;
  commits_behind?: number | null;
  diff_summary?: DesktopDiffSummary | null;
  source?: DesktopSource | null;
}

export interface DesktopScanWarning {
  agent_id: string;
  path: string;
  skill_path?: string | null;
  kind: string;
  message: string;
}

export interface DesktopScanResponse {
  skills: DesktopSkill[];
  warnings: DesktopScanWarning[];
}
