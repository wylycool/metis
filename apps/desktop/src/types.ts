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
  team_policy_path?: string | null;
  enterprise_network?: DesktopEnterpriseNetworkSettings | null;
}

export interface DesktopEnterpriseNetworkSettings {
  proxy_url?: string | null;
  no_proxy?: string | null;
  certificate_authority_bundle_path?: string | null;
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

export interface DesktopPreviewRemoteSkillSourceRequest {
  url: string;
  repo_path: string;
  ref_: string;
}

export interface DesktopRemoteSkillPreview {
  name: string;
  description?: string | null;
  install_name: string;
  commit: string;
  repo_path: string;
}

export interface DesktopSkillTargetsRequest {
  url: string;
  repo_path: string;
  ref_: string;
  commit: string;
  install_name: string;
}

export interface DesktopSkillTarget {
  agent_id: string;
  agent_name: string;
  root_path: string;
  install_path: string;
  status: string;
  local_modified: boolean;
  skill_id?: string | null;
  source_id?: string | null;
  root_available: boolean;
  root_status: string;
}

export interface DesktopInstallRemoteSkillRequest {
  url: string;
  repo_path: string;
  ref_: string;
  commit: string;
  install_name: string;
  targets: DesktopInstallSkillTarget[];
}

export interface DesktopInstallSkillTarget {
  agent_id: string;
  agent_name: string;
  install_path: string;
}

export interface DesktopInstallRemoteSkillResult {
  targets: DesktopInstallTargetResult[];
}

export interface DesktopInstallTargetResult {
  agent_id: string;
  install_path: string;
  status: string;
  reason?: string | null;
  skill_id?: string | null;
  backup_id?: string | null;
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

export interface DesktopEnvironmentReport {
  generated_at: string;
  total_skills: number;
  bound_sources: number;
  trusted_sources: number;
  auto_update_sources: number;
  local_modified_skills: number;
  agents: DesktopAgentStatus[];
  skills: DesktopEnvironmentSkill[];
}

export interface DesktopEnvironmentSkill {
  id: string;
  name: string;
  agent_id: string;
  install_path: string;
  metadata_status: string;
  local_modified?: boolean | null;
  source?: DesktopEnvironmentSource | null;
}

export interface DesktopEnvironmentSource {
  url: string;
  repo_path: string;
  ref_: string;
  current_commit?: string | null;
  remote_commit?: string | null;
  trusted: boolean;
  auto_update: boolean;
  has_credential_ref: boolean;
}

export interface DesktopFileExportResult {
  output_path: string;
  bytes_written: number;
}

export interface DesktopTeamPolicySummary {
  version: string;
  trusted_sources: number;
  allow_auto_update: boolean;
  require_trusted_source: boolean;
}

export interface DesktopTeamPolicyAuditReport {
  generated_at: string;
  total_bound_sources: number;
  compliant: number;
  should_mark_trusted: number;
  auto_update_disallowed: number;
  items: DesktopTeamPolicyAuditItem[];
}

export interface DesktopTeamPolicyAuditItem {
  skill_id: string;
  skill_name: string;
  source_id: string;
  source_url: string;
  source_repo_path: string;
  source_ref: string;
  current_trusted: boolean;
  current_auto_update: boolean;
  policy_trusted: boolean;
  auto_update_allowed: boolean;
  status: string;
  recommendation: string;
}

export interface DesktopTeamManifestComplianceRequest {
  manifest_json: string;
}

export interface DesktopTeamManifestComplianceReport {
  generated_at: string;
  manifest_version: string;
  summary: DesktopTeamManifestComplianceSummary;
  items: DesktopTeamManifestComplianceItem[];
}

export interface DesktopTeamManifestComplianceSummary {
  total: number;
  installed: number;
  missing: number;
  version_mismatch: number;
  local_modified: number;
  source_mismatch: number;
}

export interface DesktopTeamManifestComplianceItem {
  name: string;
  agent_id: string;
  status: string;
  expected_source_url?: string | null;
  expected_source_repo_path?: string | null;
  expected_source_ref?: string | null;
  expected_commit?: string | null;
  local_skill_id?: string | null;
  local_install_path?: string | null;
  local_source_url?: string | null;
  local_source_repo_path?: string | null;
  local_source_ref?: string | null;
  local_commit?: string | null;
  local_modified?: boolean | null;
  trusted_source?: boolean | null;
}

export interface DesktopTeamComplianceReportExportRequest {
  output_path: string;
  report: DesktopTeamManifestComplianceReport;
}

export interface DesktopAuditLogExportRequest {
  output_path: string;
  limit: number;
  offset: number;
}

export interface DesktopError {
  category: string;
  title: string;
  message: string;
  suggestion: string;
  debug_detail?: string | null;
}
