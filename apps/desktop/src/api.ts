import { invoke } from "@tauri-apps/api/core";
import type {
  DesktopAgentStatus,
  DesktopApplyUpdateResult,
  DesktopAuditEvent,
  DesktopBackupSummary,
  DesktopBindSourceRequest,
  DesktopDiffDetail,
  DesktopEnvironmentReport,
  DesktopFileExportResult,
  DesktopInstallRemoteSkillRequest,
  DesktopInstallRemoteSkillResult,
  DesktopPreviewRemoteSkillSourceRequest,
  DesktopRemoteSkillPreview,
  DesktopRestoreBackupRequest,
  DesktopRestoreBackupResult,
  DesktopScanResponse,
  DesktopSettings,
  DesktopSkill,
  DesktopSkillSize,
  DesktopSkillTarget,
  DesktopSkillTargetsRequest,
  DesktopSource,
  DesktopSourceConnectionTestResult,
  DesktopAuditLogExportRequest,
  DesktopTeamComplianceReportExportRequest,
  DesktopTeamPolicyAuditReport,
  DesktopTeamManifestComplianceReport,
  DesktopTeamManifestComplianceRequest,
  DesktopTeamPolicySummary,
  DesktopUpdateCheckRequest,
  DesktopUpdateCheckResult,
} from "./types";

export function listAgents(): Promise<DesktopAgentStatus[]> {
  return invoke("list_agents");
}

export function listIndexedSkills(): Promise<DesktopSkill[]> {
  return invoke("list_indexed_skills");
}

export function getSkillSize(skillId: string): Promise<DesktopSkillSize> {
  return invoke("get_skill_size", { skillId });
}

export function scanSkills(): Promise<DesktopScanResponse> {
  return invoke("scan_skills");
}

export function getDesktopSettings(): Promise<DesktopSettings> {
  return invoke("get_desktop_settings");
}

export function saveDesktopSettings(settings: DesktopSettings): Promise<DesktopSettings> {
  return invoke("save_desktop_settings", { settings });
}

export function getTeamPolicySummary(): Promise<DesktopTeamPolicySummary | null> {
  return invoke("get_team_policy_summary");
}

export function getTeamPolicyAuditReport(): Promise<DesktopTeamPolicyAuditReport> {
  return invoke("get_team_policy_audit_report");
}

export function bindSkillSource(
  request: DesktopBindSourceRequest,
): Promise<DesktopSource> {
  return invoke("bind_skill_source", { request });
}

export function unbindSkillSource(skillId: string): Promise<void> {
  return invoke("unbind_skill_source", { skillId });
}

export function previewRemoteSkillSource(
  request: DesktopPreviewRemoteSkillSourceRequest,
): Promise<DesktopRemoteSkillPreview> {
  return invoke("preview_remote_skill_source", { request });
}

export function testSourceConnection(
  request: DesktopPreviewRemoteSkillSourceRequest,
): Promise<DesktopSourceConnectionTestResult> {
  return invoke("test_source_connection", { request });
}

export function getSkillTargetsForSource(
  request: DesktopSkillTargetsRequest,
): Promise<DesktopSkillTarget[]> {
  return invoke("get_skill_targets_for_source", { request });
}

export function installRemoteSkillToTargets(
  request: DesktopInstallRemoteSkillRequest,
): Promise<DesktopInstallRemoteSkillResult> {
  return invoke("install_remote_skill_to_targets", { request });
}

export function checkSkillUpdates(
  request: DesktopUpdateCheckRequest,
): Promise<DesktopUpdateCheckResult[]> {
  return invoke("check_skill_updates", { request });
}

export function getSkillDiff(skillId: string): Promise<DesktopDiffDetail> {
  return invoke("get_skill_diff", { skillId });
}

export function applySkillUpdate(skillId: string): Promise<DesktopApplyUpdateResult> {
  return invoke("apply_skill_update", { skillId });
}

export function listSkillBackups(skillId: string): Promise<DesktopBackupSummary[]> {
  return invoke("list_skill_backups", { skillId });
}

export function listSkillAuditEvents(skillId: string, limit = 6): Promise<DesktopAuditEvent[]> {
  return invoke("list_skill_audit_events", { skillId, limit });
}

export function restoreSkillBackup(
  request: DesktopRestoreBackupRequest,
): Promise<DesktopRestoreBackupResult> {
  return invoke("restore_skill_backup", { request });
}

export function exportEnvironmentReport(): Promise<DesktopEnvironmentReport> {
  return invoke("export_environment_report");
}

export function checkTeamManifestCompliance(
  request: DesktopTeamManifestComplianceRequest,
): Promise<DesktopTeamManifestComplianceReport> {
  return invoke("check_team_manifest_compliance", { request });
}

export function loadTeamManifestFromFile(path: string): Promise<string> {
  return invoke("load_team_manifest_from_file", { path });
}

export function exportTeamComplianceReportToFile(
  request: DesktopTeamComplianceReportExportRequest,
): Promise<DesktopFileExportResult> {
  return invoke("export_team_compliance_report_to_file", { request });
}

export function exportEnvironmentReportToFile(
  outputPath: string,
): Promise<DesktopFileExportResult> {
  return invoke("export_environment_report_to_file", { outputPath });
}

export function exportAuditLogReportToFile(
  request: DesktopAuditLogExportRequest,
): Promise<DesktopFileExportResult> {
  return invoke("export_audit_log_report_to_file", { request });
}

export function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}
