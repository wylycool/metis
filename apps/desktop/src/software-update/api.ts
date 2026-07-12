import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  SoftwareUpdateDownloadEvent,
  SoftwareUpdateDownloadResult,
  SoftwareUpdateInfo,
} from "./types";

export function checkSoftwareUpdate(): Promise<SoftwareUpdateInfo | null> {
  return invoke("check_software_update");
}

export function downloadSoftwareUpdate(
  onProgress: (event: SoftwareUpdateDownloadEvent) => void,
): Promise<SoftwareUpdateDownloadResult> {
  const progressChannel = new Channel<SoftwareUpdateDownloadEvent>(onProgress);
  return invoke("download_software_update", { progressChannel });
}

export function openSoftwareUpdateInstaller(): Promise<void> {
  return invoke("open_software_update_installer");
}

export function openDownloadsDirectory(): Promise<void> {
  return invoke("open_downloads_directory");
}
