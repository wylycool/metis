import { useMemo, useState } from "react";
import { AgentBadge, normalizeAgentId, type AgentIdentity } from "./AgentBadge";
import { shortCommit } from "./commitDisplay";
import {
  BackupPanel,
  BindSourceForm,
  DiffPanel,
  InlineError,
  StatusBadge,
  skillAccentStyle,
  type BindDraft,
  type StatusBadgeTone,
} from "./SkillRow";
import type {
  DesktopAuditEvent,
  DesktopBackupSummary,
  DesktopDiffDetail,
  DesktopError,
  DesktopSkill,
  DesktopSourceConnectionTestResult,
  DesktopUpdateCheckResult,
} from "./types";

export function SkillDetailPage({
  actionBusy,
  backupError,
  backupOpen,
  backups,
  bindDraft,
  diffDetail,
  diffError,
  isBinding,
  sourceConnectionError,
  sourceConnectionResult,
  agentMemberships,
  skill,
  skillAuditEvents,
  updateResult,
  updateResults,
  onBack,
  onBind,
  onCancelBind,
  onCheck,
  onDraftChange,
  onTestSourceConnection,
  onApplyUpdate,
  onApplyNeededAgentUpdates,
  onOpenBind,
  onRestoreBackup,
  onToggleBackups,
  onToggleDiff,
  onUnbind,
}: {
  actionBusy: string | null;
  backupError?: DesktopError;
  backupOpen: boolean;
  backups: DesktopBackupSummary[];
  bindDraft: BindDraft;
  diffDetail?: DesktopDiffDetail;
  diffError?: DesktopError;
  isBinding: boolean;
  sourceConnectionError?: DesktopError;
  sourceConnectionResult?: DesktopSourceConnectionTestResult;
  agentMemberships: Pick<
    DesktopSkill,
    "agent_id" | "agent_name" | "id" | "install_path" | "local_modified"
    | "source_id"
  >[];
  skill: DesktopSkill;
  skillAuditEvents: DesktopAuditEvent[];
  updateResult?: DesktopUpdateCheckResult;
  updateResults: Record<string, DesktopUpdateCheckResult>;
  onBack: () => void;
  onBind: () => void;
  onCancelBind: () => void;
  onCheck: () => void;
  onDraftChange: (draft: BindDraft) => void;
  onTestSourceConnection: () => void;
  onApplyUpdate: (skillId: string, mode?: "overwrite-local") => void;
  onApplyNeededAgentUpdates: (skillIds: string[]) => void;
  onOpenBind: () => void;
  onRestoreBackup: (backupId: string) => void;
  onToggleBackups: () => void;
  onToggleDiff: () => void;
  onUnbind: () => void;
}) {
  const source = skill.source;
  const checkBusy = actionBusy === "check-updates";
  const bindBusy = actionBusy === `bind:${skill.id}`;
  const testSourceBusy = actionBusy === `test-source:${skill.id}`;
  const unbindBusy = actionBusy === `unbind:${skill.id}`;
  const diffBusy = actionBusy === `diff:${skill.id}`;
  const backupBusy = actionBusy === `backups:${skill.id}`;
  const installedAgentRows = useMemo(
    () => detailInstalledAgentRows(skill, agentMemberships, updateResults),
    [agentMemberships, skill, updateResults],
  );
  const detailSummary = detailAggregateSummary(installedAgentRows);
  const outdatedAgentRows = installedAgentRows.filter((row) => row.statusKind === "update");
  const applyNeededBusy = actionBusy === "apply-needed-agent-updates";
  const canViewDiff = canViewUpdateDiff(updateResult);

  return (
    <section
      className="skill-panel skill-detail-page redesign-detail"
      data-testid={`skill-detail-${skill.id}`}
    >
      <button className="breadcrumb-button redesign-back-button" onClick={onBack}>
        返回
      </button>

      <header
        className="skill-detail-card skill-intro-card redesign-detail-summary"
        data-testid={`skill-intro-card-${skill.id}`}
        style={skillAccentStyle(skill)}
      >
        <div
          className="skill-intro-heading"
          data-testid={`skill-detail-reference-summary-${skill.id}`}
        >
          <span className="redesign-detail-kicker">Skill detail</span>
          <h1>{skill.name}</h1>
          <p>{skill.description || "暂无描述"}</p>
          {detailSummary.message && (
            <p className="redesign-detail-summary-message">{detailSummary.message}</p>
          )}
        </div>
        <div
          className="intro-source-corner redesign-source-summary"
          data-testid={`skill-source-summary-${skill.id}`}
        >
          <span>来源</span>
          <strong>{source?.url || "未绑定来源"}</strong>
          <small>{source?.repo_path ? `${source.repo_path} · ${source.ref_ || "main"}` : ""}</small>
          <button
            className={`redesign-source-action ${source ? "bound" : "unbound"}`}
            data-testid={`open-bind-source-${skill.id}`}
            onClick={onOpenBind}
          >
            {source ? "修改来源" : "添加来源"}
          </button>
        </div>
        <div className="detail-status-strip">
          <span className="detail-skill-size" data-testid={`skill-size-${skill.id}`}>
            {skill.total_size_bytes == null ? "计算中" : formatBytes(skill.total_size_bytes)}
          </span>
          <StatusBadge tone={detailSummary.tone}>{detailSummary.label}</StatusBadge>
        </div>
      </header>

      <FormalDetailAgentPaths
        actionBusy={actionBusy}
        onApplyUpdate={onApplyUpdate}
        skill={skill}
        rows={installedAgentRows}
      />

      <div className="skill-detail-grid">
        <section
          className="skill-detail-card local-operations-card redesign-update-workbench"
          data-testid={`skill-operations-card-${skill.id}`}
        >
          <div className="detail-action-row local-action-row redesign-operation-tabs">
            <button
              className="operation-button compact"
              data-testid={`check-updates-${skill.id}`}
              disabled={installedAgentRows.length === 0 || checkBusy}
              onClick={onCheck}
            >
              {checkBusy ? "检查中" : "检查更新"}
            </button>
            <button
              className={`operation-button compact ${diffDetail ? "active" : ""}`}
              data-testid={`toggle-diff-${skill.id}`}
              disabled={!source || diffBusy || (!diffDetail && !canViewDiff)}
              onClick={onToggleDiff}
              title={!source || canViewDiff || diffDetail ? undefined : "先检查更新后查看 diff"}
            >
              {diffBusy ? "加载 diff" : diffDetail ? "隐藏 diff" : "查看 diff"}
            </button>
            <button
              className={`operation-button compact ${backupOpen ? "active" : ""}`}
              data-testid={`toggle-backups-${skill.id}`}
              disabled={!source || backupBusy}
              onClick={onToggleBackups}
            >
              {backupBusy ? "读取备份" : backupOpen ? "隐藏备份" : "备份/回滚"}
            </button>
            {outdatedAgentRows.length > 0 && (
              <button
                className="operation-button compact pending"
                data-testid={`apply-needed-agent-updates-${skill.id}`}
                disabled={applyNeededBusy}
                onClick={() =>
                  onApplyNeededAgentUpdates(outdatedAgentRows.map((row) => row.skillId))
                }
              >
                {applyNeededBusy ? "更新中" : "更新需要更新的 Agent"}
              </button>
            )}
          </div>

          {diffError && <InlineError error={diffError} />}
          {!diffDetail && !backupOpen && (
            <FormalCheckPanel skill={skill} source={source} updateResult={updateResult} />
          )}
          {diffDetail && <DiffPanel detail={diffDetail} repoPath={source?.repo_path} />}

          {backupError && <InlineError error={backupError} />}
          {backupOpen && (
            <BackupPanel
              backups={backups}
              busyKey={actionBusy}
              skillId={skill.id}
              onRestoreBackup={onRestoreBackup}
            />
          )}
        </section>

        <SkillHistoryPanel events={skillAuditEvents} skillId={skill.id} />
      </div>

      {isBinding && (
        <div className="source-drawer-backdrop redesign-drawer-scrim" role="presentation" onClick={onCancelBind}>
          <aside
            aria-label="修改来源信息"
            className="source-drawer redesign-source-drawer"
            data-testid={`source-drawer-${skill.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="source-drawer-heading">
              <div>
                <p className="detail-kicker">Source</p>
                <h3>修改来源信息</h3>
              </div>
              {source && (
                <button className="danger-button compact" disabled={unbindBusy} onClick={onUnbind}>
                  {unbindBusy ? "解绑中" : "解绑"}
                </button>
              )}
            </div>
            <BindSourceForm
              busy={bindBusy}
              draft={bindDraft}
              skillId={skill.id}
              testBusy={testSourceBusy}
              testError={sourceConnectionError}
              testResult={sourceConnectionResult}
              onCancel={onCancelBind}
              onChange={onDraftChange}
              onSubmit={onBind}
              onTestConnection={onTestSourceConnection}
            />
          </aside>
        </div>
      )}

    </section>
  );
}

function SkillHistoryPanel({
  events,
  skillId,
}: {
  events: DesktopAuditEvent[];
  skillId: string;
}) {
  return (
    <section
      className="skill-detail-card skill-history-card"
      data-testid={`skill-history-${skillId}`}
    >
      <div className="skill-history-heading">
        <h2>历史记录</h2>
        <span>{events.length} 条</span>
      </div>
      {events.length === 0 ? (
        <p className="skill-history-empty">暂无历史记录</p>
      ) : (
        <div className="skill-history-list">
          {events.map((event) => (
            <article className={`skill-history-row ${event.status}`} key={event.id}>
              <div>
                <strong>{auditActionLabel(event.action)}</strong>
                <span>{event.created_at ? compactDateTime(event.created_at) : "时间未知"}</span>
              </div>
              <p>{auditCommitSummary(event)}</p>
              {securityRiskCount(event.risk_summary) > 0 && (
                <small>包含需要留意的脚本或配置字段</small>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function FormalDetailAgentPaths({
  actionBusy,
  onApplyUpdate,
  rows,
  skill,
}: {
  actionBusy: string | null;
  onApplyUpdate: (skillId: string, mode?: "overwrite-local") => void;
  rows: DetailAgentInstallRow[];
  skill: DesktopSkill;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <section
      className="redesign-detail-agent-panel"
      data-testid={`skill-detail-agent-panel-${skill.id}`}
    >
      <button
        aria-controls={`skill-detail-agent-paths-${skill.id}`}
        aria-expanded={isExpanded}
        className="redesign-detail-agent-toggle"
        data-testid={`skill-detail-agent-toggle-${skill.id}`}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span>
          <small>安装位置</small>
          <strong>{rows.length} 个 Agent 已安装此 skill</strong>
        </span>
        <span className="redesign-detail-agent-toggle-action">
          {isExpanded ? "收起" : "展开"}
          <span aria-hidden="true">{isExpanded ? "↑" : "↓"}</span>
        </span>
      </button>
      {isExpanded && (
        <div
          className="redesign-detail-agent-paths"
          data-testid={`skill-detail-agent-paths-${skill.id}`}
          id={`skill-detail-agent-paths-${skill.id}`}
        >
          {rows.map((row) => (
            <div
              className={`redesign-detail-agent-path-row ${row.statusKind}`}
              data-testid={`skill-detail-agent-path-${skill.id}-${row.agentId}`}
              key={row.agentId}
            >
              <AgentBadge agent={row.agent} />
              <span>{row.agent.agent_name}</span>
              <code>{row.installPath}</code>
              <small>{row.statusLabel}</small>
              {row.statusKind === "local-modified" && row.hasSource && (
                <button
                  aria-label={`用来源版本覆盖 ${row.agent.agent_name} 中的本地修改`}
                  className="redesign-detail-agent-row-action"
                  data-testid={`overwrite-local-agent-${row.skillId}`}
                  disabled={actionBusy === `apply:${row.skillId}`}
                  onClick={() => onApplyUpdate(row.skillId, "overwrite-local")}
                  title="会先创建备份，再用来源版本覆盖这个安装目录"
                >
                  {actionBusy === `apply:${row.skillId}` ? "覆盖中" : "覆盖更新"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FormalCheckPanel({
  skill,
  source,
  updateResult,
}: {
  skill: DesktopSkill;
  source: DesktopSkill["source"];
  updateResult?: DesktopUpdateCheckResult;
}) {
  const currentCommit = updateResult?.source?.current_commit ?? source?.current_commit;
  const localVersion = currentCommit ? shortCommit(currentCommit) : "未绑定来源";
  const targetCommit = updateResult?.source?.remote_commit
    ? shortCommit(updateResult.source.remote_commit)
    : "等待检查";
  const summary = updateResult?.diff_summary
    ? diffSummaryParts(updateResult.diff_summary)
    : updateResult?.status === "UpToDate"
      ? [{ className: "empty", label: "没有文件变化" }]
      : [{ className: "empty", label: "等待检查" }];

  return (
    <div className="redesign-check-panel" data-testid={`check-panel-${skill.id}`}>
      <div>
        <span>本地版本</span>
        <strong>{localVersion}</strong>
      </div>
      <div>
        <span>远端版本</span>
        <strong>{targetCommit}</strong>
      </div>
      <div className="redesign-check-diff-summary">
        <span>差异</span>
        <div className="redesign-diff-summary-chips">
          {summary.map((part) => (
            <b className={part.className} key={part.label}>
              {part.label}
            </b>
          ))}
        </div>
      </div>
    </div>
  );
}

function diffSummaryParts(summary: DesktopUpdateCheckResult["diff_summary"]) {
  if (!summary) {
    return [{ className: "empty", label: "等待检查" }];
  }
  const parts = [
    summary.files_added > 0
      ? { className: "added", label: `新增 ${summary.files_added} 个文件` }
      : null,
    summary.files_modified > 0
      ? { className: "modified", label: `修改 ${summary.files_modified} 个文件` }
      : null,
    summary.files_deleted > 0
      ? { className: "deleted", label: `删除 ${summary.files_deleted} 个文件` }
      : null,
  ].filter((part): part is { className: string; label: string } => part !== null);
  if (parts.length > 0) {
    return parts;
  }
  return [{ className: "empty", label: "没有文件变化" }];
}

function auditActionLabel(action: string) {
  switch (action) {
    case "UpdateApplied":
      return "已应用更新";
    case "UpdateChecked":
      return "检查过更新";
    case "RollbackApplied":
      return "已回滚";
    case "RollbackFailed":
      return "回滚失败";
    case "UpdateFailed":
      return "更新失败";
    case "UpdateBlocked":
      return "更新已提示";
    case "SourceBound":
      return "已绑定来源";
    case "SourceUnbound":
      return "已解绑来源";
    case "BackupDeleted":
      return "已删除备份";
    default:
      return "记录";
  }
}

function auditCommitSummary(event: DesktopAuditEvent) {
  const before = event.commit_before ? shortCommit(event.commit_before) : null;
  const after = event.commit_after ? shortCommit(event.commit_after) : null;
  if (before && after) {
    return `${before} -> ${after}`;
  }
  if (after) {
    return `版本 ${after}`;
  }
  if (before) {
    return `原版本 ${before}`;
  }
  return event.detail || event.status;
}

function compactDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const formatted = unitIndex === 0 ? Math.round(size).toString() : size.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}

function securityRiskCount(riskSummary?: string | null) {
  if (!riskSummary) {
    return 0;
  }
  try {
    const parsed = JSON.parse(riskSummary);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function canViewUpdateDiff(updateResult?: DesktopUpdateCheckResult) {
  return (
    updateResult?.status === "UpdateAvailable" &&
    (updateResult.diff_summary?.total_changes ?? 0) > 0
  );
}

type DetailAgentInstallRow = {
  agent: AgentIdentity;
  agentId: string;
  hasSource: boolean;
  installPath: string;
  localModified: boolean;
  statusKind: DetailAgentStatusKind;
  statusLabel: string;
  skillId: string;
  updateResult?: DesktopUpdateCheckResult;
};

function detailInstalledAgentRows(
  skill: DesktopSkill,
  agentMemberships: Pick<
    DesktopSkill,
    "agent_id" | "agent_name" | "id" | "install_path" | "local_modified" | "source_id"
  >[],
  updateResults: Record<string, DesktopUpdateCheckResult>,
) {
  const rows: DetailAgentInstallRow[] = [];
  const seen = new Set<string>();
  const groupHasSource = Boolean(skill.source_id || skill.source);

  function addRow(
    agent: AgentIdentity,
    installPath: string,
    skillId: string,
    localModified: boolean,
    hasSource: boolean,
  ) {
    const agentId = normalizeAgentId(agent.agent_id || agent.agent_name);
    if (!agentId || seen.has(agentId)) {
      return;
    }
    seen.add(agentId);
    const updateResult = updateResults[skillId];
    const status = detailAgentStatus({ hasSource, localModified, updateResult });
    rows.push({
      agent,
      agentId,
      hasSource,
      installPath,
      localModified,
      skillId,
      updateResult,
      ...status,
    });
  }

  for (const membership of agentMemberships) {
    addRow(
      { agent_id: membership.agent_id, agent_name: membership.agent_name },
      membership.install_path,
      membership.id,
      membership.local_modified === true,
      Boolean(membership.source_id) || groupHasSource,
    );
  }

  addRow(
    { agent_id: skill.agent_id, agent_name: skill.agent_name },
    skill.install_path,
    skill.id,
    skill.local_modified === true,
    groupHasSource,
  );

  return rows;
}

type DetailAgentStatusKind =
  | "unknown"
  | "latest"
  | "update"
  | "local-modified"
  | "no-source"
  | "failed";

function detailAgentStatus({
  hasSource,
  localModified,
  updateResult,
}: {
  hasSource: boolean;
  localModified: boolean;
  updateResult?: DesktopUpdateCheckResult;
}): Pick<DetailAgentInstallRow, "statusKind" | "statusLabel"> {
  const effectiveLocalModified = updateResult ? updateResult.local_modified : localModified;
  if (effectiveLocalModified) {
    return { statusKind: "local-modified", statusLabel: "本地已修改" };
  }
  if (!hasSource || updateResult?.status === "NoSource") {
    return { statusKind: "no-source", statusLabel: "来源未绑定" };
  }
  if (!updateResult) {
    return { statusKind: "unknown", statusLabel: "未检查" };
  }
  if (updateResult.status === "UpdateAvailable") {
    return { statusKind: "update", statusLabel: "需要更新" };
  }
  if (updateResult.status === "UpToDate") {
    return { statusKind: "latest", statusLabel: "无需更新" };
  }
  if (updateResult.status === "CheckFailed") {
    return { statusKind: "failed", statusLabel: "检查失败" };
  }
  return { statusKind: "unknown", statusLabel: "未检查" };
}

function detailAggregateSummary(rows: DetailAgentInstallRow[]): {
  label: string;
  message: string;
  tone: StatusBadgeTone;
} {
  if (rows.some((row) => row.statusKind === "local-modified")) {
    return {
      label: "有 Agent 存在本地修改",
      message: "",
      tone: "warning",
    };
  }
  if (rows.some((row) => row.statusKind === "update")) {
    return {
      label: "有 Agent 需要更新",
      message: "",
      tone: "warning",
    };
  }
  if (rows.length > 0 && rows.every((row) => row.statusKind === "latest")) {
    return {
      label: "所有 Agent 均无需更新",
      message: "",
      tone: "good",
    };
  }
  if (rows.some((row) => row.statusKind === "failed" || row.statusKind === "no-source")) {
    return {
      label: "部分 Agent 暂无法判断",
      message: "",
      tone: "muted",
    };
  }
  return {
    label: "尚未检查 Agent 状态",
    message: "",
    tone: "muted",
  };
}
