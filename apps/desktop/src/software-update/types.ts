export interface SoftwareUpdateInfo {
  current_version: string;
  version: string;
  notes?: string | null;
  published_at?: string | null;
  file_name?: string | null;
}

export interface SoftwareUpdateDownloadResult {
  version: string;
  file_name: string;
  file_path: string;
}

export type SoftwareUpdateDownloadEvent =
  | { event: "started"; content_length?: number | null }
  | {
      event: "progress";
      chunk_length: number;
      downloaded: number;
      content_length?: number | null;
    }
  | { event: "verifying" }
  | { event: "saving" }
  | { event: "finished"; file_path: string };

export type SoftwareUpdateDownloadPhase =
  | "idle"
  | "downloading"
  | "verifying"
  | "saving"
  | "saved"
  | "error";

export interface SoftwareUpdateDownloadState {
  phase: SoftwareUpdateDownloadPhase;
  downloaded: number;
  contentLength: number | null;
  result: SoftwareUpdateDownloadResult | null;
  error: string | null;
}

export function emptySoftwareUpdateDownloadState(): SoftwareUpdateDownloadState {
  return {
    phase: "idle",
    downloaded: 0,
    contentLength: null,
    result: null,
    error: null,
  };
}
