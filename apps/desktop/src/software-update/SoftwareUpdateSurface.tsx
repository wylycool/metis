import { useEffect, useRef } from "react";
import type {
  SoftwareUpdateDownloadState,
  SoftwareUpdateInfo,
} from "./types";

type SoftwareUpdateSurfaceProps = {
  dismissed: boolean;
  dialogOpen: boolean;
  downloadDisabled: boolean;
  downloadState: SoftwareUpdateDownloadState;
  info: SoftwareUpdateInfo | null;
  openError: string | null;
  onCloseDialog: () => void;
  onDismiss: () => void;
  onDownload: () => void;
  onOpenDownloads: () => void;
  onOpenInstaller: () => void;
};

export function SoftwareUpdateSurface({
  dismissed,
  dialogOpen,
  downloadDisabled,
  downloadState,
  info,
  openError,
  onCloseDialog,
  onDismiss,
  onDownload,
  onOpenDownloads,
  onOpenInstaller,
}: SoftwareUpdateSurfaceProps) {
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeDialogRef = useRef(onCloseDialog);
  const isBusyRef = useRef(false);
  const isBusy = ["downloading", "verifying", "saving"].includes(downloadState.phase);
  const effectiveDialogOpen = dialogOpen && info !== null;
  closeDialogRef.current = onCloseDialog;
  isBusyRef.current = isBusy;

  useSoftwareUpdateDialogFocus({
    backdropRef,
    dialogOpen: effectiveDialogOpen,
    dialogRef,
    isBusyRef,
    onCloseDialogRef: closeDialogRef,
  });

  if (!info) {
    return null;
  }

  const progress = softwareUpdateProgress(downloadState.downloaded, downloadState.contentLength);

  return (
    <>
      {!dismissed && !effectiveDialogOpen && (
        <aside
          aria-label={`Metis ${info.version} 软件更新`}
          className="software-update-notice"
          data-testid="software-update-notice"
          role="status"
        >
          <span className="software-update-notice-icon" aria-hidden="true">
            <SoftwareUpdateIcon />
          </span>
          <span className="software-update-notice-copy">
            <strong>Metis {info.version} 已发布</strong>
            {info.notes && <small>{info.notes}</small>}
          </span>
          <span className="software-update-notice-actions">
            <button
              className="software-update-dismiss"
              data-testid="software-update-dismiss"
              onClick={onDismiss}
              type="button"
            >
              稍后
            </button>
            <button
              className="software-update-download"
              data-testid="software-update-download"
              disabled={downloadDisabled}
              onClick={onDownload}
              type="button"
            >
              下载更新
            </button>
          </span>
        </aside>
      )}

      {effectiveDialogOpen && (
        <div
          className="software-update-dialog-backdrop"
          ref={backdropRef}
          role="presentation"
        >
          <section
            aria-labelledby="software-update-dialog-title"
            aria-modal="true"
            className="software-update-dialog"
            data-testid="software-update-dialog"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <button
              aria-label="关闭软件更新窗口"
              className="software-update-dialog-close"
              disabled={isBusy}
              onClick={onCloseDialog}
              type="button"
            >
              <CloseIcon />
            </button>
            <div className={`software-update-hero phase-${downloadState.phase}`} aria-hidden="true">
              {downloadState.phase === "saved" ? <CheckIcon /> : <SoftwareUpdateIcon />}
            </div>
            <div className="software-update-dialog-copy" aria-live="polite">
              <p className="software-update-dialog-eyebrow">Metis 软件更新</p>
              <h2 id="software-update-dialog-title">
                {softwareUpdateTitle(info.version, downloadState.phase)}
              </h2>
              {downloadState.phase === "saved" ? (
                <p>
                  安装包已经过 Metis 更新签名校验，并保存到系统 Downloads。安装仍需由你手动完成。
                </p>
              ) : (
                <p>
                  当前版本 {info.current_version}，目标版本 {info.version}。系统可能显示未知开发者或安全提醒，请按系统提示确认。
                </p>
              )}
            </div>

            {downloadState.phase === "downloading" && (
              <div className="software-update-progress-block">
                <div className="software-update-progress-copy">
                  <span>{progress === null ? "正在接收安装包" : `${progress}%`}</span>
                  <small>
                    {formatSoftwareUpdateBytes(downloadState.downloaded)}
                    {downloadState.contentLength
                      ? ` / ${formatSoftwareUpdateBytes(downloadState.contentLength)}`
                      : ""}
                  </small>
                </div>
                <div
                  aria-label="软件更新下载进度"
                  aria-valuemax={progress === null ? undefined : 100}
                  aria-valuemin={progress === null ? undefined : 0}
                  aria-valuenow={progress ?? undefined}
                  className={`software-update-progress${progress === null ? " indeterminate" : ""}`}
                  data-testid="software-update-progress"
                  role="progressbar"
                >
                  <span style={progress === null ? undefined : { transform: `scaleX(${progress / 100})` }} />
                </div>
              </div>
            )}

            {(downloadState.phase === "verifying" || downloadState.phase === "saving") && (
              <div className="software-update-verifying" role="status">
                <span aria-hidden="true" />
                <strong>
                  {downloadState.phase === "verifying"
                    ? "请稍候，正在验证 Metis 更新签名"
                    : "写入完成后即可手动安装"}
                </strong>
              </div>
            )}

            {downloadState.phase === "saved" && downloadState.result && (
              <div className="software-update-saved-file">
                <span aria-hidden="true">
                  <PackageIcon />
                </span>
                <span>
                  <strong>{downloadState.result.file_name}</strong>
                  <small>{downloadState.result.file_path}</small>
                </span>
              </div>
            )}

            {downloadState.phase === "error" && downloadState.error && (
              <div className="software-update-error" role="alert">
                <strong>更新没有下载完成</strong>
                <span>{downloadState.error}</span>
              </div>
            )}
            {openError && (
              <div className="software-update-error compact" role="alert">
                <span>{openError}</span>
              </div>
            )}

            <div className="software-update-dialog-actions">
              {downloadState.phase === "saved" ? (
                <>
                  <button
                    className="software-update-secondary-action"
                    data-testid="software-update-open-folder"
                    onClick={onOpenDownloads}
                    type="button"
                  >
                    打开下载目录
                  </button>
                  <button
                    className="software-update-primary-action"
                    data-testid="software-update-open-installer"
                    onClick={onOpenInstaller}
                    type="button"
                  >
                    打开安装包
                  </button>
                </>
              ) : downloadState.phase === "error" ? (
                <>
                  <button
                    className="software-update-secondary-action"
                    onClick={onCloseDialog}
                    type="button"
                  >
                    稍后再试
                  </button>
                  <button
                    className="software-update-primary-action"
                    onClick={onDownload}
                    type="button"
                  >
                    重新下载
                  </button>
                </>
              ) : (
                <button
                  className="software-update-secondary-action"
                  disabled={isBusy}
                  onClick={onCloseDialog}
                  type="button"
                >
                  稍后安装
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function useSoftwareUpdateDialogFocus({
  backdropRef,
  dialogOpen,
  dialogRef,
  isBusyRef,
  onCloseDialogRef,
}: {
  backdropRef: { current: HTMLDivElement | null };
  dialogOpen: boolean;
  dialogRef: { current: HTMLElement | null };
  isBusyRef: { current: boolean };
  onCloseDialogRef: { current: () => void };
}) {
  useEffect(() => {
    if (!dialogOpen) {
      return;
    }

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inertTargets: Array<{ element: HTMLElement; inert: boolean }> = [];
    const setInert = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      inertTargets.push({ element, inert: element.inert });
      element.inert = true;
    };
    setInert(document.querySelector(".metis-sidebar"));
    const backdrop = backdropRef.current;
    for (const sibling of Array.from(backdrop?.parentElement?.children ?? [])) {
      if (sibling !== backdrop) {
        setInert(sibling);
      }
    }

    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }
      if (event.key === "Escape" && !isBusyRef.current) {
        event.preventDefault();
        onCloseDialogRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (activeElement === dialog || !dialog.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      for (const target of inertTargets) {
        target.element.inert = target.inert;
      }
      window.setTimeout(() => {
        if (previousFocus && previousFocus !== document.body && previousFocus.isConnected) {
          previousFocus.focus();
          return;
        }
        (
          document.querySelector<HTMLElement>('[data-testid="workspace-tab-settings"]') ??
          document.querySelector<HTMLElement>('[data-testid="workspace-tab-skills"]')
        )?.focus();
      }, 0);
    };
  }, [backdropRef, dialogOpen, dialogRef, isBusyRef, onCloseDialogRef]);
}

function softwareUpdateTitle(version: string, phase: SoftwareUpdateDownloadState["phase"]) {
  switch (phase) {
    case "verifying":
      return "正在校验安装包";
    case "saving":
      return "正在保存安装包";
    case "saved":
      return `Metis ${version} 已下载`;
    case "error":
      return "软件更新下载失败";
    case "downloading":
    case "idle":
      return `正在下载 Metis ${version}`;
  }
}

function softwareUpdateProgress(downloaded: number, contentLength: number | null) {
  if (!contentLength || contentLength <= 0) {
    return null;
  }
  return Math.min(100, Math.round((downloaded / contentLength) * 100));
}

function formatSoftwareUpdateBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SoftwareUpdateIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M12 3v11" />
      <path d="m7.8 10.2 4.2 4.2 4.2-4.2" />
      <path d="M5 17.5v2h14v-2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="m5.5 12.5 4 4 9-9" />
    </svg>
  );
}

function PackageIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="m4 7.5 8-4 8 4-8 4-8-4Z" />
      <path d="M4 7.5v9l8 4 8-4v-9" />
      <path d="M12 11.5v9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}
