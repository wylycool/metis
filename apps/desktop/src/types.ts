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
}

export interface DesktopBindSourceRequest {
  skill_id: string;
  url: string;
  repo_path: string;
  ref_: string;
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
