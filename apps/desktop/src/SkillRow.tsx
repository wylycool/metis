import type {
  DesktopBackupSummary,
  DesktopDiffDetail,
  DesktopError,
  DesktopSkill,
  DesktopUpdateCheckResult,
} from "./types";

export interface BindDraft {
  url: string;
  repo_path: string;
  ref_: string;
  credential_ref: string;
  trusted: boolean;
  auto_update: boolean;
}

export function SkillRow({
  skill,
  updateResult,
  diffDetail,
  diffError,
  backups,
  backupOpen,
  backupError,
  isBinding,
  bindDraft,
  busyKey,
  onOpenDetail,
  onOpenBind,
  onCancelBind,
  onDraftChange,
  onBind,
  onUnbind,
  onCheck,
  onToggleDiff,
  onApplyUpdate,
  onToggleBackups,
  onRestoreBackup,
}: {
  skill: DesktopSkill;
  updateResult?: DesktopUpdateCheckResult;
  diffDetail?: DesktopDiffDetail;
  diffError?: DesktopError;
  backups: DesktopBackupSummary[];
  backupOpen: boolean;
  backupError?: DesktopError;
  isBinding: boolean;
  bindDraft: BindDraft;
  busyKey: string | null;
  onOpenDetail?: () => void;
  onOpenBind: () => void;
  onCancelBind: () => void;
  onDraftChange: (draft: BindDraft) => void;
  onBind: () => void;
  onUnbind: () => void;
  onCheck: () => void;
  onToggleDiff: () => void;
  onApplyUpdate: () => void;
  onToggleBackups: () => void;
  onRestoreBackup: (backupId: string) => void;
}) {
  const bindingBusy = busyKey === `bind:${skill.id}`;
  const unbindingBusy = busyKey === `unbind:${skill.id}`;
  const checkingBusy = busyKey === "check-updates";
  const diffBusy = busyKey === `diff:${skill.id}`;
  const applyBusy = busyKey === `apply:${skill.id}`;
  const backupsBusy = busyKey === `backups:${skill.id}`;
  const canShowDiff = updateResult?.status === "UpdateAvailable";
  const canApplyUpdate = canShowDiff && !updateResult?.local_modified;

  return (
    <article
      className="skill-row"
      data-testid={`skill-row-${skill.id}`}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button, input, textarea, label, a")) {
          return;
        }
        onOpenDetail?.();
      }}
    >
      <div className="skill-row-main">
        <div className="skill-main">
          <div className="skill-title">
            <h3>{skill.name}</h3>
            <span>{skill.agent_name}</span>
          </div>
          {skill.description && <p>{skill.description}</p>}
          <code>{skill.install_path}</code>
          {skill.source && (
            <div className="source-line">
              <strong>{skill.source.ref_}</strong>
              <span>{skill.source.url}</span>
              <em>{skill.source.repo_path}</em>
              <div className="source-policy">
                <small>{skill.source.trusted ? "trusted source" : "untrusted source"}</small>
                <small>{skill.source.auto_update ? "auto update on" : "auto update off"}</small>
                {skill.source.credential_ref && <small>已配置凭据引用</small>}
              </div>
            </div>
          )}
        </div>

        <div className="skill-status">
          <StatusBadge tone={metadataTone(skill.metadata_status)}>
            metadata: {metadataLabel(skill.metadata_status)}
          </StatusBadge>
          <StatusBadge tone={skill.local_modified ? "danger" : "muted"}>
            {localModifiedLabel(skill.local_modified)}
          </StatusBadge>
          <StatusBadge tone={updateTone(updateResult, skill)}>
            {updateLabel(updateResult, skill)}
          </StatusBadge>
        </div>
      </div>

      {updateResult?.diff_summary && (
        <div className="update-summary">
          <span>+{updateResult.diff_summary.files_added}</span>
          <span>~{updateResult.diff_summary.files_modified}</span>
          <span>-{updateResult.diff_summary.files_deleted}</span>
          {updateResult.commits_behind !== null && updateResult.commits_behind !== undefined && (
            <strong>{updateResult.commits_behind} commits behind</strong>
          )}
        </div>
      )}

      <div className="skill-actions">
        {skill.source ? (
          <>
            <button
              className="ghost-button compact"
              data-testid={`check-updates-${skill.id}`}
              disabled={checkingBusy}
              onClick={onCheck}
            >
              {checkingBusy ? "检查中" : "检查更新"}
            </button>
            {canShowDiff && (
              <button
                className="ghost-button compact"
                data-testid={`toggle-diff-${skill.id}`}
                disabled={diffBusy}
                onClick={onToggleDiff}
              >
                {diffBusy ? "加载中" : diffDetail ? "收起 diff" : "查看 diff"}
              </button>
            )}
            {canShowDiff && (
              <button
                className="compact"
                data-testid={`apply-update-${skill.id}`}
                disabled={applyBusy || !canApplyUpdate}
                onClick={onApplyUpdate}
              >
                {applyBusy ? "更新中" : "应用更新"}
              </button>
            )}
            <button className="ghost-button compact" disabled={backupsBusy} onClick={onToggleBackups}>
              {backupsBusy ? "加载中" : backupOpen ? "收起备份" : "备份/回滚"}
            </button>
            <button
              className="ghost-button compact"
              data-testid={`open-bind-source-${skill.id}`}
              onClick={onOpenBind}
            >
              编辑来源
            </button>
            <button
              className="danger-button compact"
              disabled={unbindingBusy}
              onClick={onUnbind}
            >
              {unbindingBusy ? "解绑中" : "解绑"}
            </button>
          </>
        ) : (
          <button
            className="ghost-button compact"
            data-testid={`open-bind-source-${skill.id}`}
            onClick={onOpenBind}
          >
            绑定来源
          </button>
        )}
      </div>

      {diffError && <InlineError error={diffError} />}
      {diffDetail && <DiffPanel detail={diffDetail} />}
      {backupError && <InlineError error={backupError} />}
      {backupOpen && (
        <BackupPanel
          skillId={skill.id}
          backups={backups}
          busyKey={busyKey}
          onRestoreBackup={onRestoreBackup}
        />
      )}

      {isBinding && (
        <BindSourceForm
          skillId={skill.id}
          draft={bindDraft}
          busy={bindingBusy}
          onChange={onDraftChange}
          onCancel={onCancelBind}
          onSubmit={onBind}
        />
      )}
    </article>
  );
}

function BackupPanel({
  skillId,
  backups,
  busyKey,
  onRestoreBackup,
}: {
  skillId: string;
  backups: DesktopBackupSummary[];
  busyKey: string | null;
  onRestoreBackup: (backupId: string) => void;
}) {
  return (
    <div className="backup-panel">
      <div className="backup-heading">
        <strong>备份</strong>
        <span>{backups.length} items</span>
      </div>
      {backups.length === 0 ? (
        <p className="empty-backups">暂无备份。应用更新或手动备份后会出现在这里。</p>
      ) : (
        <div className="backup-list">
          {backups.map((backup) => {
            const restoring = busyKey === `restore:${backup.backup_id}`;
            return (
              <article className="backup-row" key={backup.backup_id}>
                <div>
                  <strong>{backup.reason}</strong>
                  <span>{backup.created_at || "unknown time"}</span>
                  <code>{backup.backup_id}</code>
                </div>
                <div className="backup-meta">
                  {backup.source_commit && <span>{shortCommit(backup.source_commit)}</span>}
                  <span>{backup.file_count} files</span>
                  <span>{formatBytes(backup.total_size_bytes)}</span>
                </div>
                <button
                  className="danger-button compact"
                  data-testid={`restore-backup-${skillId}-${backup.backup_id}`}
                  disabled={restoring}
                  onClick={() => onRestoreBackup(backup.backup_id)}
                >
                  {restoring ? "回滚中" : "回滚"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DiffPanel({ detail }: { detail: DesktopDiffDetail }) {
  return (
    <div className="diff-panel">
      <div className="diff-heading">
        <span>{shortCommit(detail.current_commit)}</span>
        <strong>→</strong>
        <span>{shortCommit(detail.target_commit)}</span>
        <b>{detail.files.length} files</b>
      </div>
      <div className="diff-file-list">
        {detail.files.map((file) => (
          <article className="diff-file" key={`${file.status}-${file.old_path ?? ""}-${file.path}`}>
            <div className="diff-file-heading">
              <StatusBadge tone={file.status === "Deleted" ? "danger" : "muted"}>
                {file.status}
              </StatusBadge>
              <code>{file.old_path ? `${file.old_path} → ${file.path}` : file.path}</code>
            </div>
            {file.patch ? (
              <pre>{file.patch}</pre>
            ) : (
              <p className="no-patch">这个文件没有可展示的 patch 文本。</p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function BindSourceForm({
  skillId,
  draft,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  skillId: string;
  draft: BindDraft;
  busy: boolean;
  onChange: (draft: BindDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const disabled = busy || !draft.url.trim() || !draft.repo_path.trim();

  return (
    <div className="source-form">
      <label>
        <span>Git URL</span>
        <input
          data-testid={`bind-url-${skillId}`}
          value={draft.url}
          placeholder="https://github.com/org/repo.git"
          onChange={(event) => onChange({ ...draft, url: event.target.value })}
        />
      </label>
      <label>
        <span>Repo Path</span>
        <input
          data-testid={`bind-repo-path-${skillId}`}
          value={draft.repo_path}
          placeholder="skills/example"
          onChange={(event) => onChange({ ...draft, repo_path: event.target.value })}
        />
      </label>
      <label>
        <span>Ref</span>
        <input
          data-testid={`bind-ref-${skillId}`}
          value={draft.ref_}
          placeholder="main"
          onChange={(event) => onChange({ ...draft, ref_: event.target.value })}
        />
      </label>
      <label>
        <span>Credential Ref</span>
        <input
          data-testid={`bind-credential-ref-${skillId}`}
          value={draft.credential_ref}
          placeholder="github-main"
          onChange={(event) => onChange({ ...draft, credential_ref: event.target.value })}
        />
      </label>
      <label className="check-label">
        <input
          data-testid={`bind-trusted-${skillId}`}
          checked={draft.trusted}
          type="checkbox"
          onChange={(event) => onChange({ ...draft, trusted: event.target.checked })}
        />
        <span>Trusted</span>
      </label>
      <label className="check-label">
        <input
          data-testid={`bind-auto-update-${skillId}`}
          checked={draft.auto_update}
          type="checkbox"
          onChange={(event) => onChange({ ...draft, auto_update: event.target.checked })}
        />
        <span>Auto update</span>
      </label>
      <div className="form-actions">
        <button className="ghost-button compact" onClick={onCancel}>
          取消
        </button>
        <button className="compact" disabled={disabled} onClick={onSubmit}>
          <span data-testid={`submit-bind-source-${skillId}`}>
            {busy ? "保存中" : "保存来源"}
          </span>
        </button>
      </div>
    </div>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "good" | "danger" | "muted";
}) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

export function InlineError({ error }: { error: DesktopError }) {
  return (
    <div className="inline-error" data-error-category={error.category}>
      <div className="error-heading">
        <strong>{error.title}</strong>
        <span>{error.category}</span>
      </div>
      <p>{error.message}</p>
      <p className="error-suggestion">{error.suggestion}</p>
      {error.debug_detail && (
        <details>
          <summary>调试详情</summary>
          <code>{error.debug_detail}</code>
        </details>
      )}
    </div>
  );
}

function metadataTone(status: string) {
  return status === "found" ? "good" : "danger";
}

function metadataLabel(status: string) {
  if (status === "found") {
    return "found";
  }
  if (status === "parse_error") {
    return "parse error";
  }
  return status;
}

function localModifiedLabel(value: boolean | null | undefined) {
  if (value === true) {
    return "本地已修改";
  }
  if (value === false) {
    return "未发现修改";
  }
  return "未检测修改";
}

function updateTone(
  result: DesktopUpdateCheckResult | undefined,
  skill: DesktopSkill,
): "good" | "danger" | "muted" {
  if (result?.local_modified || result?.status === "CheckFailed") {
    return "danger";
  }
  if (result?.status === "UpToDate") {
    return "good";
  }
  if (result?.status === "UpdateAvailable") {
    return "danger";
  }
  if (!skill.source) {
    return "muted";
  }
  return "muted";
}

function updateLabel(result: DesktopUpdateCheckResult | undefined, skill: DesktopSkill) {
  if (result?.local_modified) {
    return "本地修改，先处理";
  }
  if (result?.status === "UpToDate") {
    return "已最新";
  }
  if (result?.status === "UpdateAvailable") {
    return "有更新";
  }
  if (result?.status === "CheckFailed") {
    return `检查失败${result.failure_reason ? `: ${result.failure_reason}` : ""}`;
  }
  if (result?.status === "NoSource" || !skill.source) {
    return "未绑定来源";
  }
  return "未检查更新";
}

function shortCommit(commit: string) {
  return commit.length > 10 ? commit.slice(0, 10) : commit;
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
