import { useEffect, useMemo, useState } from "react";
import { AgentBadge, normalizeAgentId, type AgentIdentity } from "./AgentBadge";
import { CrossAgentTargetMatrix } from "./CrossAgentTargetMatrix";
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
  DesktopCopyLocalSkillResult,
  DesktopDiffDetail,
  DesktopError,
  DesktopLocalSkillTarget,
  DesktopSkill,
  DesktopSourceConnectionTestResult,
  DesktopUpdateCheckResult,
} from "./types";

export interface DetailLocalInstallState {
  targets: DesktopLocalSkillTarget[];
  selectedTargetIds: string[];
  targetError: DesktopError | null;
  refreshError: DesktopError | null;
  installError: DesktopError | null;
  installResult: DesktopCopyLocalSkillResult | null;
  loaded: boolean;
  targetLoading: boolean;
  installing: boolean;
}

export function emptyDetailLocalInstallState(): DetailLocalInstallState {
  return {
    targets: [],
    selectedTargetIds: [],
    targetError: null,
    refreshError: null,
    installError: null,
    installResult: null,
    loaded: false,
    targetLoading: false,
    installing: false,
  };
}

export function SkillDetailPage({
  actionBusy,
  backupError,
  backupOpen,
  backups,
  bindDraft,
  detailLocalInstallState,
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
  onInstallDetailTargets,
  onLoadDetailTargets,
  onSelectAllDetailTargets,
  onTestSourceConnection,
  onToggleDetailTarget,
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
  detailLocalInstallState: DetailLocalInstallState;
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
  onInstallDetailTargets: () => void;
  onLoadDetailTargets: () => void;
  onSelectAllDetailTargets: () => void;
  onTestSourceConnection: () => void;
  onToggleDetailTarget: (target: DesktopLocalSkillTarget) => void;
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
  const [sourceDrawerMounted, setSourceDrawerMounted] = useState(isBinding);
  const [sourceDrawerClosing, setSourceDrawerClosing] = useState(false);

  useEffect(() => {
    if (isBinding) {
      setSourceDrawerMounted(true);
      setSourceDrawerClosing(false);
      return undefined;
    }

    if (!sourceDrawerMounted) {
      return undefined;
    }

    setSourceDrawerClosing(true);
    const timeout = window.setTimeout(() => {
      setSourceDrawerMounted(false);
      setSourceDrawerClosing(false);
    }, 160);

    return () => window.clearTimeout(timeout);
  }, [isBinding, sourceDrawerMounted]);

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
        detailLocalInstallState={detailLocalInstallState}
        onApplyUpdate={onApplyUpdate}
        onInstallTargets={onInstallDetailTargets}
        onLoadTargets={onLoadDetailTargets}
        onSelectAllTargets={onSelectAllDetailTargets}
        onToggleTarget={onToggleDetailTarget}
        skill={skill}
        rows={installedAgentRows}
      />

      <div className="skill-detail-grid">
        <section
          className="skill-detail-card local-operations-card redesign-update-workbench"
          data-testid={`skill-operations-card-${skill.id}`}
        >
          <div
            aria-label="Skill 版本操作"
            className="detail-action-row local-action-row redesign-operation-tabs"
            role="group"
          >
            <button
              aria-busy={checkBusy}
              className="operation-button compact operation-button--check"
              data-testid={`check-updates-${skill.id}`}
              disabled={installedAgentRows.length === 0 || checkBusy}
              onClick={onCheck}
              type="button"
            >
              {checkBusy ? "检查中" : "检查更新"}
            </button>
            <button
              aria-busy={diffBusy}
              aria-controls={`detail-diff-panel-${skill.id}`}
              aria-expanded={Boolean(diffDetail)}
              className={`operation-button compact operation-button--diff ${
                diffDetail ? "active" : ""
              }`}
              data-testid={`toggle-diff-${skill.id}`}
              disabled={!source || diffBusy || backupBusy || (!diffDetail && !canViewDiff)}
              onClick={onToggleDiff}
              title={!source || canViewDiff || diffDetail ? undefined : "先检查更新后查看 diff"}
              type="button"
            >
              {diffBusy ? "加载 diff" : diffDetail ? "隐藏 diff" : "查看 diff"}
            </button>
            <button
              aria-busy={backupBusy}
              aria-controls={`detail-backup-panel-${skill.id}`}
              aria-expanded={backupOpen}
              className={`operation-button compact operation-button--backup ${
                backupOpen ? "active" : ""
              }`}
              data-testid={`toggle-backups-${skill.id}`}
              disabled={!source || backupBusy || diffBusy}
              onClick={onToggleBackups}
              type="button"
            >
              {backupBusy ? "读取备份" : backupOpen ? "隐藏备份" : "备份/回滚"}
            </button>
            {outdatedAgentRows.length > 0 && (
              <button
                aria-busy={applyNeededBusy}
                className="operation-button compact operation-button--update pending"
                data-testid={`apply-needed-agent-updates-${skill.id}`}
                disabled={applyNeededBusy}
                onClick={() =>
                  onApplyNeededAgentUpdates(outdatedAgentRows.map((row) => row.skillId))
                }
                type="button"
              >
                {applyNeededBusy ? "更新中" : "更新需要更新的 Agent"}
              </button>
            )}
          </div>

          {diffError && !backupOpen && <InlineError error={diffError} />}
          {!diffDetail && !backupOpen && (
            <FormalCheckPanel skill={skill} updateResult={updateResult} />
          )}
          {diffDetail && (
            <DiffPanel
              detail={diffDetail}
              id={`detail-diff-panel-${skill.id}`}
              repoPath={source?.repo_path}
            />
          )}

          {backupOpen && backupError && <InlineError error={backupError} />}
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

      {sourceDrawerMounted && (
        <div
          className={`source-drawer-backdrop redesign-drawer-scrim ${
            sourceDrawerClosing ? "is-closing" : ""
          }`}
          role="presentation"
          onClick={onCancelBind}
        >
          <aside
            aria-label="修改来源信息"
            className={`source-drawer redesign-source-drawer ${
              sourceDrawerClosing ? "is-closing" : ""
            }`}
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
              <p>{auditEventSummary(event)}</p>
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
  detailLocalInstallState,
  onApplyUpdate,
  onInstallTargets,
  onLoadTargets,
  onSelectAllTargets,
  onToggleTarget,
  rows,
  skill,
}: {
  actionBusy: string | null;
  detailLocalInstallState: DetailLocalInstallState;
  onApplyUpdate: (skillId: string, mode?: "overwrite-local") => void;
  onInstallTargets: () => void;
  onLoadTargets: () => void;
  onSelectAllTargets: () => void;
  onToggleTarget: (target: DesktopLocalSkillTarget) => void;
  rows: DetailAgentInstallRow[];
  skill: DesktopSkill;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const targetLoading = detailLocalInstallState.targetLoading;
  const installing = detailLocalInstallState.installing;
  const notInstalledTargets = detailLocalInstallState.targets.filter(
    (target) => target.status === "NotInstalled" && target.root_available,
  );
  const unavailableCount = detailLocalInstallState.targets.filter(
    (target) => target.status === "AgentRootUnavailable",
  ).length;
  const showInstallTargets =
    targetLoading ||
    installing ||
    detailLocalInstallState.loaded ||
    Boolean(detailLocalInstallState.installResult) ||
    Boolean(detailLocalInstallState.targetError || detailLocalInstallState.installError);

  return (
    <section
      className="redesign-detail-agent-panel"
      data-testid={`skill-detail-agent-panel-${skill.id}`}
    >
      <div className="redesign-detail-agent-header">
        <button
          aria-controls={`skill-detail-agent-paths-${skill.id}`}
          aria-expanded={isExpanded}
          className="redesign-detail-agent-toggle"
          data-testid={`skill-detail-agent-toggle-${skill.id}`}
          onClick={() => {
            const nextExpanded = !isExpanded;
            setIsExpanded(nextExpanded);
            if (
              nextExpanded &&
              !targetLoading &&
              (!detailLocalInstallState.loaded || detailLocalInstallState.targetError)
            ) {
              onLoadTargets();
            }
          }}
          type="button"
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
      </div>
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
                  onClick={() => {
                    const confirmed = window.confirm(
                      "覆盖更新会先创建备份，然后用来源版本覆盖这个 Agent 中的本地修改。确定继续吗？",
                    );
                    if (confirmed) {
                      onApplyUpdate(row.skillId, "overwrite-local");
                    }
                  }}
                  title="会先创建备份，再用来源版本覆盖这个安装目录"
                  type="button"
                >
                  {actionBusy === `apply:${row.skillId}` ? "覆盖中" : "覆盖更新"}
                </button>
              )}
            </div>
          ))}
          {showInstallTargets && (
            <div className="detail-install-targets">
              <CrossAgentTargetMatrix
                currentAgentId={skill.agent_id}
                error={
                  detailLocalInstallState.installError ??
                  detailLocalInstallState.refreshError ??
                  detailLocalInstallState.targetError ??
                  undefined
                }
                description="复制当前本地 Skill 到选中位置，不检查远端更新。"
                installResult={detailLocalInstallState.installResult ?? undefined}
                installing={installing}
                loading={targetLoading}
                mode="local-copy"
                resultTargets={detailLocalInstallState.targets}
                selectedTargetIds={detailLocalInstallState.selectedTargetIds}
                targets={notInstalledTargets}
                title="可安装位置"
                onInstall={onInstallTargets}
                onSelectAllValid={onSelectAllTargets}
                onToggleTarget={onToggleTarget}
              />
              {(detailLocalInstallState.targetError || detailLocalInstallState.refreshError) &&
                !targetLoading &&
                !installing && (
                <button
                  className="ghost-button compact detail-install-retry"
                  data-testid={`retry-detail-targets-${skill.id}`}
                  onClick={onLoadTargets}
                  type="button"
                >
                  {detailLocalInstallState.refreshError ? "重新刷新" : "重新读取"}
                </button>
                )}
              {unavailableCount > 0 && (
                <p className="detail-install-unavailable-note">
                  另有 {unavailableCount} 个路径不可用，请到 Settings 检查路径配置。
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function FormalCheckPanel({
  skill,
  updateResult,
}: {
  skill: DesktopSkill;
  updateResult?: DesktopUpdateCheckResult;
}) {
  const diffPending = !updateResult?.diff_summary && updateResult?.status !== "UpToDate";
  const statusLabel = checkPanelStatusLabel(updateResult);
  const summary = updateResult?.diff_summary
    ? diffSummaryParts(updateResult.diff_summary)
    : updateResult?.status === "UpToDate"
      ? [{ className: "empty", label: "没有文件变化" }]
      : [{ className: "empty", label: "等待检查" }];

  return (
    <div className="redesign-check-panel" data-testid={`check-panel-${skill.id}`}>
      <div>
        <span>检查结果</span>
        <strong>{statusLabel}</strong>
      </div>
      <div className="redesign-check-diff-summary">
        <span>差异</span>
        {diffPending ? (
          <strong>等待检查</strong>
        ) : (
          <div className="redesign-diff-summary-chips">
            {summary.map((part) => (
              <b className={part.className} key={part.label}>
                {part.label}
              </b>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function checkPanelStatusLabel(updateResult?: DesktopUpdateCheckResult) {
  if (!updateResult) {
    return "等待检查";
  }
  if (updateResult.local_modified) {
    return "本地已修改";
  }
  switch (updateResult.status) {
    case "UpdateAvailable":
      return "需要更新";
    case "UpToDate":
      return "无需更新";
    case "CheckFailed":
      return "检查失败";
    case "NoSource":
      return "来源未绑定";
    default:
      return "等待检查";
  }
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
    case "LockFileExported":
      return "已导出团队清单";
    case "LockFileImported":
      return "已导入团队清单";
    default:
      return "记录";
  }
}

function auditEventSummary(event: DesktopAuditEvent) {
  switch (event.action) {
    case "SourceBound": {
      const sourceUrl = extractAuditSourceUrl(event.detail);
      return sourceUrl || "来源已绑定";
    }
    case "SourceUnbound":
      return "来源已移除";
    case "UpdateChecked":
      return "已检查来源状态";
    case "UpdateApplied":
      return "已更新到来源版本";
    case "UpdateBlocked":
      return "已提示需要确认后再更新";
    case "UpdateFailed":
      return "更新没有完成";
    case "RollbackApplied":
      return "已恢复到备份版本";
    case "RollbackFailed":
      return "回滚没有完成";
    case "BackupDeleted":
      return "备份已删除";
    case "LockFileExported":
      return "团队清单已导出";
    case "LockFileImported":
      return "团队清单已导入";
    default:
      return event.status === "success" ? "操作已完成" : "操作未完成";
  }
}

function extractAuditSourceUrl(detail?: string | null) {
  const normalized = detail?.trim();
  if (!normalized) {
    return null;
  }
  const boundSourceMatch = normalized.match(/^bound git source\s+(.+)$/i);
  if (boundSourceMatch?.[1]) {
    return boundSourceMatch[1].trim();
  }
  if (/^(?:file:\/\/|https?:\/\/|ssh:\/\/|git@)/.test(normalized)) {
    return normalized;
  }
  return null;
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
