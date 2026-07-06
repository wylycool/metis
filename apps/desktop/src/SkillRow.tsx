import type {
  DesktopBackupSummary,
  DesktopDiffSummary,
  DesktopDiffDetail,
  DesktopError,
  DesktopFileDiff,
  DesktopSkill,
  DesktopSourceConnectionTestResult,
  DesktopUpdateCheckResult,
} from "./types";
import { useMemo, useState, type CSSProperties } from "react";
import { AgentBadgeStack } from "./AgentBadge";
import { shortCommit } from "./commitDisplay";

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
  agentMemberships = [skill],
  onOpenDetail,
}: {
  skill: DesktopSkill;
  agentMemberships?: Pick<DesktopSkill, "agent_id" | "agent_name">[];
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
      className="skill-row redesign-skill-card"
      data-testid={`skill-row-${skill.id}`}
      style={skillAccentStyle(skill)}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button, input, textarea, label, a")) {
          return;
        }
        onOpenDetail?.();
      }}
    >
      <span className="skill-card-anchor" data-testid={`skill-card-${skill.id}`} aria-hidden="true" />
      <span className="skill-row-marker redesign-card-accent" aria-hidden="true" />
      <span className={`redesign-card-status ${cardStatusTone(updateResult, skill)}`}>
        {cardStatusLabel(updateResult, skill)}
      </span>
      <strong>{skill.name}</strong>
      <div className="skill-row-main">
        <div className="skill-main">
          <p>{skill.description || "暂无简介。打开详情页后可以补充来源、检查更新并查看 diff。"}</p>
        </div>
      </div>

      <span className="redesign-card-footer">
        <span>{skill.source ? "已绑定来源" : "未绑定来源"}</span>
        <AgentBadgeStack agents={agentMemberships} testId={`skill-agent-stack-${skill.id}`} />
      </span>

      {updateResult?.diff_summary && (
        <UpdateSummary summary={updateResult.diff_summary} />
      )}
    </article>
  );
}

export function UpdateSummary({ summary }: { summary: DesktopDiffSummary }) {
  return (
    <div className="update-summary">
      <strong>{summary.total_changes} 个文件有更新</strong>
      <span>新增 {summary.files_added} 个文件</span>
      <span>修改 {summary.files_modified} 个文件</span>
      <span>删除 {summary.files_deleted} 个文件</span>
    </div>
  );
}

function cardStatusLabel(updateResult: DesktopUpdateCheckResult | undefined, skill: DesktopSkill) {
  if (skill.local_modified) {
    return "已修改";
  }
  if (updateResult?.status === "UpdateAvailable") {
    return "待更新";
  }
  if (updateResult?.status === "UpToDate") {
    return "已最新";
  }
  return "未检查";
}

function cardStatusTone(updateResult: DesktopUpdateCheckResult | undefined, skill: DesktopSkill) {
  if (skill.local_modified || updateResult?.status === "UpdateAvailable") {
    return "update";
  }
  return "latest";
}

export function skillAccentStyle(skill: DesktopSkill): CSSProperties {
  const palette = [
    ["#496ee8", "#7f5be8"],
    ["#f06498", "#c94f7d"],
    ["#2db8a0", "#159a86"],
    ["#f0ad47", "#d98225"],
    ["#4c9fdb", "#2f75bf"],
    ["#41bf80", "#1e9667"],
    ["#6f72e8", "#4f46c8"],
    ["#e35d6a", "#b9465a"],
    ["#21a6c8", "#167da0"],
    ["#c47a2c", "#9a5f1f"],
    ["#8f5bd8", "#6843b8"],
    ["#22a66f", "#157a58"],
    ["#d95f9f", "#a84b86"],
    ["#5b8be8", "#3466c8"],
    ["#7aa33a", "#587d2b"],
    ["#5f6f86", "#405166"],
  ];
  const index = Math.abs(hashText(`${skill.agent_id}:${skill.name}`)) % palette.length;
  return {
    "--redesign-accent-start": palette[index][0],
    "--redesign-accent-end": palette[index][1],
  } as CSSProperties;
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
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
    <div className="backup-panel redesign-backup-panel" data-testid={`backup-panel-${skillId}`}>
      {backups.length === 0 ? (
        <p className="empty-backups">暂无备份。应用更新或手动备份后会出现在这里。</p>
      ) : (
        <div className="backup-list">
          {backups.map((backup) => {
            const restoring = busyKey === `restore:${backup.backup_id}`;
            return (
              <article className="backup-row" key={backup.backup_id}>
                <div className="backup-main">
                  <div className="backup-title-line">
                    <strong>{backupReasonLabel(backup.reason)}</strong>
                    <span className="backup-version">
                      {backup.source_commit ? shortCommit(backup.source_commit) : "版本未知"}
                    </span>
                  </div>
                  <div className="backup-details">
                    <span>{formatBackupTime(backup.created_at)}</span>
                    <span>{formatBytes(backup.total_size_bytes)}</span>
                  </div>
                </div>
                <button
                  className="danger-button compact"
                  data-testid={`restore-backup-${skillId}-${backup.backup_id}`}
                  disabled={restoring}
                  onClick={() => onRestoreBackup(backup.backup_id)}
                >
                  {restoring ? "回退中" : "回退"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function backupReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    "pre-update": "上一个版本",
    "pre-rollback": "回退前版本",
    "pre-sync": "同步前版本",
    manual: "手动版本",
  };
  return labels[reason] ?? "可回退版本";
}

function formatBackupTime(value?: string | null) {
  if (!value) {
    return "时间未知";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(parsed).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function DiffPanel({ detail, repoPath }: { detail: DesktopDiffDetail; repoPath?: string }) {
  const files = useMemo(
    () => diffFilesWithDisplayPaths(detail.files, repoPath),
    [detail.files, repoPath],
  );
  const [activePath, setActivePath] = useState(files[0]?.path ?? "");
  const activeFile = files.find((file) => file.path === activePath) ?? files[0] ?? null;
  const patchLines = activeFile ? sanitizedPatchLines(activeFile) : [];

  return (
    <div className="diff-panel redesign-diff-viewer" data-testid="redesign-diff-viewer">
      <div className="diff-heading redesign-diff-files">
        {files.map((file) => (
          <button
            className={file.path === activeFile?.path ? "active" : ""}
            data-testid={`diff-file-${file.displayPath}`}
            key={`${file.status}:${file.path}`}
            onClick={() => setActivePath(file.path)}
          >
            {file.displayPath}
          </button>
        ))}
      </div>
      <div className="simple-diff redesign-diff-code">
        <div className="redesign-diff-line muted">
          {shortCommit(detail.current_commit)} -&gt; {shortCommit(detail.target_commit)} ·{" "}
          {activeFile?.displayPath ?? "无文件"}
        </div>
        {patchLines.length > 0 ? (
          patchLines.map((line, index) => (
            <div className={`redesign-diff-line ${diffLineTone(line)}`} key={`${index}:${line}`}>
              {line || " "}
            </div>
          ))
        ) : (
          <div className="redesign-diff-line muted">暂无可展示的 diff 文本。</div>
        )}
      </div>
    </div>
  );
}

type DisplayFileDiff = DesktopFileDiff & { displayPath: string };

function diffFilesWithDisplayPaths(
  files: DesktopFileDiff[],
  repoPath?: string,
): DisplayFileDiff[] {
  const normalized = files.map((file) => normalizeDiffPath(file.path));
  const sourcePrefix = repoPath ? normalizeDiffPath(repoPath) : "";
  const commonPrefix =
    sourcePrefix && normalized.some((path) => path === sourcePrefix || path.startsWith(`${sourcePrefix}/`))
      ? sourcePrefix
      : commonDirectoryPrefix(normalized);
  return files.map((file, index) => {
    const normalizedPath = normalized[index];
    return {
      ...file,
      displayPath: trimDiffPrefix(normalizedPath, commonPrefix),
    };
  });
}

function normalizeDiffPath(path: string) {
  return path.replace(/^\/+/, "");
}

function commonDirectoryPrefix(paths: string[]) {
  if (paths.length < 2) {
    return "";
  }
  const splitPaths = paths.map((path) => path.split("/").slice(0, -1));
  const first = splitPaths[0] ?? [];
  const prefix: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index];
    if (splitPaths.every((parts) => parts[index] === segment)) {
      prefix.push(segment);
    } else {
      break;
    }
  }
  return prefix.join("/");
}

function trimDiffPrefix(path: string, prefix: string) {
  if (!prefix || !path.startsWith(`${prefix}/`)) {
    return path;
  }
  return path.slice(prefix.length + 1);
}

function sanitizedPatchLines(file: DesktopFileDiff) {
  const fallback = `${file.status}: ${file.old_path ? `${file.old_path} -> ` : ""}${file.path}`;
  return (file.patch || fallback)
    .split("\n")
    .filter((line) => !isGitPatchHeaderLine(line));
}

function isGitPatchHeaderLine(line: string) {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ")
  );
}

function diffLineTone(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "added";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "removed";
  }
  if (line.startsWith("@@")) {
    return "muted";
  }
  return "";
}

export function BindSourceForm({
  skillId,
  draft,
  busy,
  testBusy,
  testError,
  testResult,
  onChange,
  onCancel,
  onSubmit,
  onTestConnection,
}: {
  skillId: string;
  draft: BindDraft;
  busy: boolean;
  testBusy: boolean;
  testError?: DesktopError;
  testResult?: DesktopSourceConnectionTestResult;
  onChange: (draft: BindDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onTestConnection: () => void;
}) {
  const [sourceHelpOpen, setSourceHelpOpen] = useState(false);
  const disabled = busy || !draft.url.trim() || !draft.repo_path.trim();
  const testDisabled = busy || testBusy || !draft.url.trim();

  return (
    <div className="source-form">
      <div className="source-form-body" data-testid={`source-form-body-${skillId}`}>
        <div className="source-field-stack">
          <div className="source-form-field">
            <div className="source-field-label-row">
              <span>仓库 Clone 地址</span>
              <span
                className="source-help"
                data-testid={`source-url-help-${skillId}`}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setSourceHelpOpen(false);
                  }
                }}
              >
                <button
                  aria-expanded={sourceHelpOpen}
                  aria-label="仓库地址填写说明"
                  className="source-help-button"
                  onClick={() => setSourceHelpOpen((current) => !current)}
                  type="button"
                >
                  <span aria-hidden="true">?</span>
                </button>
                {sourceHelpOpen && (
                  <span className="source-help-popover" role="tooltip">
                    <span className="source-help-heading">
                      <strong>仓库地址怎么填</strong>
                      <span>只需要填 Git 的 clone 地址，Metis 会用只读方式测试可访问性。</span>
                    </span>
                    <span className="source-help-card">
                      <span>
                        <strong>HTTPS</strong>
                        <small>公开仓库通常可直接访问；私有仓库需要本机 Git 已登录或配置 token。</small>
                      </span>
                      <code>https://github.com/xx/xx.git</code>
                    </span>
                    <span className="source-help-card">
                      <span>
                        <strong>git@</strong>
                        <small>如果你已经在本机配置好 SSH key，也可以使用这个地址。</small>
                      </span>
                      <code>git@github.com:xx/xx.git</code>
                    </span>
                  </span>
                )}
              </span>
            </div>
            <input
              aria-label="仓库 Clone 地址"
              data-testid={`bind-url-${skillId}`}
              value={draft.url}
              placeholder="https://github.com/xx/xx.git"
              onChange={(event) => onChange({ ...draft, url: event.target.value })}
            />
          </div>
          <div className="source-form-field">
            <span>Skill 在仓库内的路径</span>
            <input
              aria-label="Skill 在仓库内的路径"
              data-testid={`bind-repo-path-${skillId}`}
              value={draft.repo_path}
              placeholder="skills/example；根目录填 ."
              onChange={(event) => onChange({ ...draft, repo_path: event.target.value })}
            />
          </div>
          <div className="source-form-field">
            <span>主分支名</span>
            <input
              aria-label="主分支名"
              data-testid={`bind-ref-${skillId}`}
              value={draft.ref_}
              placeholder="main 或 master"
              onChange={(event) => onChange({ ...draft, ref_: event.target.value })}
            />
          </div>
        </div>

        <div className="source-settings-grid" data-testid={`source-settings-grid-${skillId}`}>
          <label className="source-setting-row check-label">
            <input
              data-testid={`bind-auto-update-${skillId}`}
              checked={draft.trusted && draft.auto_update}
              type="checkbox"
              onChange={(event) =>
                onChange({
                  ...draft,
                  trusted: event.target.checked,
                  auto_update: event.target.checked,
                })
              }
            />
            <span>
              <strong>信任此来源并加入自动更新列表</strong>
            </span>
          </label>
        </div>

        <div
          className="source-verification-panel"
          data-testid={`source-verification-panel-${skillId}`}
        >
          <div className="source-connection-check">
            <button
              className="source-test-button"
              data-testid={`test-source-connection-${skillId}`}
              disabled={testDisabled}
              onClick={onTestConnection}
            >
              {testBusy ? "测试中" : "测试连接"}
            </button>
            <p>检测当前 URL、主分支名、仓库内路径和 SKILL.md 是否可访问。不会安装、更新或修改任何文件。</p>
          </div>
          {testResult && (
            <div
              className="source-connection-result success"
              data-testid={`source-connection-result-${skillId}`}
            >
              <strong>{testResult.message}</strong>
              <span>已找到 {testResult.skill_name}</span>
            </div>
          )}
          {testError && (
            <div
              className="source-connection-result failure"
              data-testid={`source-connection-error-${skillId}`}
            >
              <InlineError error={testError} />
            </div>
          )}
        </div>
      </div>
      <div className="form-actions" data-testid={`source-form-actions-${skillId}`}>
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

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
