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
  local_modified?: boolean | null;
  last_scanned_at: string;
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
