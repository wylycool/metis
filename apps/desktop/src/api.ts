import { invoke } from "@tauri-apps/api/core";
import type {
  DesktopAgentStatus,
  DesktopScanResponse,
  DesktopSkill,
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
