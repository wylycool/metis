import { invoke } from "@tauri-apps/api/core";
import type {
  DesktopAgentStatus,
  DesktopApplyUpdateResult,
  DesktopBackupSummary,
  DesktopBindSourceRequest,
  DesktopDiffDetail,
  DesktopEnvironmentReport,
  DesktopRestoreBackupRequest,
  DesktopRestoreBackupResult,
  DesktopScanResponse,
  DesktopSettings,
  DesktopSkill,
  DesktopSource,
  DesktopTeamManifestComplianceReport,
  DesktopTeamManifestComplianceRequest,
  DesktopUpdateCheckRequest,
  DesktopUpdateCheckResult,
} from "./types";

export function listAgents(): Promise<DesktopAgentStatus[]> {
  return invoke("list_agents");
}

export function listIndexedSkills(): Promise<DesktopSkill[]> {
  return invoke("list_indexed_skills");
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

export function bindSkillSource(
  request: DesktopBindSourceRequest,
): Promise<DesktopSource> {
  return invoke("bind_skill_source", { request });
}

export function unbindSkillSource(skillId: string): Promise<void> {
  return invoke("unbind_skill_source", { skillId });
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
