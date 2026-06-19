import { invoke } from "@tauri-apps/api/core";
import type {
  DesktopAgentStatus,
  DesktopBindSourceRequest,
  DesktopDiffDetail,
  DesktopScanResponse,
  DesktopSkill,
  DesktopSource,
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
