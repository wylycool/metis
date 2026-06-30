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
  onOpenDetail,
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
      <span className="skill-card-anchor" data-testid={`skill-card-${skill.id}`} aria-hidden="true" />
      <span className="skill-row-marker" aria-hidden="true" />
      <div className="skill-row-main">
        <div className="skill-main">
          <div className="skill-title">
            <h3>{skill.name}</h3>
          </div>
          <p>{skill.description || "暂无简介。打开详情页后可以补充来源、检查更新并查看 diff。"}</p>
          <div className="source-line">
            <strong>{skill.source ? "来源" : "来源"}</strong>
            <span>{skill.source ? sourceSummary(skill.source) : "暂无来源"}</span>
            {skill.source?.repo_path && <em>{skill.source.repo_path}</em>}
            <span className="source-policy">
              {skill.source?.trusted && <small>Trusted</small>}
              {skill.source?.auto_update && <small>Auto update</small>}
            </span>
          </div>
        </div>

        <div className="skill-status">
          <StatusBadge tone={skill.local_modified ? "danger" : "muted"}>
            {localModifiedLabel(skill.local_modified)}
          </StatusBadge>
          <StatusBadge tone={updateTone(updateResult, skill)}>
            {updateLabel(updateResult, skill)}
          </StatusBadge>
          <div
            className="skill-agent-stack"
            data-testid={`skill-agent-stack-${skill.id}`}
            aria-label={`存在于 ${skill.agent_name}`}
          >
            <span>{agentInitial(skill.agent_name)}</span>
            <span>{skill.name.slice(0, 1).toUpperCase()}</span>
          </div>
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
    </article>
  );
}

function sourceSummary(source: DesktopSkill["source"]) {
  if (!source) {
    return "未绑定来源";
  }
  const cleanUrl = source.url.replace(/^https?:\/\//, "").replace(/^file:\/\//, "");
  return `${cleanUrl}${source.ref_ ? ` @ ${source.ref_}` : ""}`;
}

function agentInitial(agentName: string) {
  return (agentName.trim()[0] ?? "A").toUpperCase();
}

export function BackupPanel({
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

export function DiffPanel({ detail }: { detail: DesktopDiffDetail }) {
  const patches = detail.files
    .map((file) => file.patch || `${file.status}: ${file.old_path ? `${file.old_path} -> ` : ""}${file.path}`)
    .join("\n\n");

  return (
    <div className="diff-panel">
      <div className="diff-heading">
        <span>{shortCommit(detail.current_commit)}</span>
        <strong>→</strong>
        <span>{shortCommit(detail.target_commit)}</span>
        <b>{detail.files.length} files</b>
      </div>
      <pre className="simple-diff">{patches || "暂无可展示的 diff 文本。"}</pre>
    </div>
  );
}

export function BindSourceForm({
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

export type StatusBadgeTone = "good" | "danger" | "warning" | "muted";

export function StatusBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: StatusBadgeTone;
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

export function metadataTone(status: string): StatusBadgeTone {
  return status === "found" ? "good" : "danger";
}

export function metadataLabel(status: string) {
  if (status === "found") {
    return "found";
  }
  if (status === "parse_error") {
    return "parse error";
  }
  return status;
}

export function localModifiedLabel(value: boolean | null | undefined) {
  if (value === true) {
    return "本地已修改";
  }
  if (value === false) {
    return "未发现修改";
  }
  return "未检测修改";
}

export function updateTone(
  result: DesktopUpdateCheckResult | undefined,
  skill: DesktopSkill,
): StatusBadgeTone {
  if (result?.status === "CheckFailed") {
    return "danger";
  }
  if (result?.local_modified || result?.status === "UpdateAvailable") {
    return "warning";
  }
  if (result?.status === "UpToDate") {
    return "good";
  }
  if (!skill.source) {
    return "muted";
  }
  return "muted";
}

export function updateLabel(result: DesktopUpdateCheckResult | undefined, skill: DesktopSkill) {
  if (result?.local_modified) {
    return "本地修改，可手动覆盖";
  }
  if (result?.status === "UpToDate") {
    return "无需更新";
  }
  if (result?.status === "UpdateAvailable") {
    return "待更新";
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
