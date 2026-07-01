import { useMemo, useState } from "react";
import { AgentBadge, normalizeAgentId, type AgentIdentity } from "./AgentBadge";
import {
  BackupPanel,
  BindSourceForm,
  DiffPanel,
  InlineError,
  StatusBadge,
  localModifiedLabel,
  skillAccentStyle,
  updateLabel,
  updateTone,
  type BindDraft,
} from "./SkillRow";
import type {
  DesktopBackupSummary,
  DesktopDiffDetail,
  DesktopError,
  DesktopInstallRemoteSkillResult,
  DesktopSkill,
  DesktopSkillTarget,
  DesktopUpdateCheckResult,
} from "./types";

export function SkillDetailPage({
  actionBusy,
  backupError,
  backupOpen,
  backups,
  bindDraft,
  detailInstallResult,
  detailTargetError,
  detailTargets,
  diffDetail,
  diffError,
  isBinding,
  agentMemberships,
  selectedDetailTargetIds,
  skill,
  updateResult,
  onBack,
  onBind,
  onCancelBind,
  onCheck,
  onDraftChange,
  onInstallDetailTargets,
  onApplyUpdate,
  onOpenBind,
  onRestoreBackup,
  onToggleBackups,
  onToggleDetailTarget,
  onToggleDiff,
  onUnbind,
  onRefreshDetailTargets,
}: {
  actionBusy: string | null;
  backupError?: DesktopError;
  backupOpen: boolean;
  backups: DesktopBackupSummary[];
  bindDraft: BindDraft;
  detailInstallResult?: DesktopInstallRemoteSkillResult;
  detailTargetError?: DesktopError;
  detailTargets: DesktopSkillTarget[];
  diffDetail?: DesktopDiffDetail;
  diffError?: DesktopError;
  isBinding: boolean;
  agentMemberships: Pick<DesktopSkill, "agent_id" | "agent_name" | "install_path">[];
  selectedDetailTargetIds: string[];
  skill: DesktopSkill;
  updateResult?: DesktopUpdateCheckResult;
  onBack: () => void;
  onBind: () => void;
  onCancelBind: () => void;
  onCheck: () => void;
  onDraftChange: (draft: BindDraft) => void;
  onInstallDetailTargets: () => void;
  onApplyUpdate: () => void;
  onOpenBind: () => void;
  onRestoreBackup: (backupId: string) => void;
  onToggleBackups: () => void;
  onToggleDetailTarget: (target: DesktopSkillTarget) => void;
  onToggleDiff: () => void;
  onUnbind: () => void;
  onRefreshDetailTargets: () => void;
}) {
  const source = skill.source;
  const checkBusy = actionBusy === "check-updates";
  const bindBusy = actionBusy === `bind:${skill.id}`;
  const unbindBusy = actionBusy === `unbind:${skill.id}`;
  const diffBusy = actionBusy === `diff:${skill.id}`;
  const backupBusy = actionBusy === `backups:${skill.id}`;
  const applyBusy = actionBusy === `apply:${skill.id}`;
  const canApplyUpdate =
    source &&
    (updateResult?.status === "UpdateAvailable" || updateResult?.local_modified === true);
  const showLocalModifiedStatus = skill.local_modified === true || updateResult?.local_modified;
  const showUpdateStatus =
    updateResult?.status === "UpToDate" ||
    updateResult?.status === "UpdateAvailable" ||
    updateResult?.status === "CheckFailed";
  const installedAgentRows = useMemo(
    () => detailInstalledAgentRows(skill, agentMemberships, detailTargets),
    [agentMemberships, detailTargets, skill],
  );
  void detailInstallResult;
  void detailTargetError;
  void selectedDetailTargetIds;
  void onInstallDetailTargets;
  void onRefreshDetailTargets;
  void onToggleDetailTarget;

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
        {(showLocalModifiedStatus || showUpdateStatus) && (
          <div className="detail-status-strip">
            {showLocalModifiedStatus && (
              <StatusBadge tone="warning">{localModifiedLabel(true)}</StatusBadge>
            )}
            {showUpdateStatus && (
              <StatusBadge tone={updateTone(updateResult, skill)}>
                {updateLabel(updateResult, skill)}
              </StatusBadge>
            )}
          </div>
        )}
      </header>

      <FormalDetailAgentPaths skill={skill} rows={installedAgentRows} />

      <div className="skill-detail-grid">
        <section
          className="skill-detail-card local-operations-card redesign-update-workbench"
          data-testid={`skill-operations-card-${skill.id}`}
        >
          {updateResult?.diff_summary && (
            <div className="update-summary detail-update-summary">
              <span>+{updateResult.diff_summary.files_added}</span>
              <span>~{updateResult.diff_summary.files_modified}</span>
              <span>-{updateResult.diff_summary.files_deleted}</span>
              {updateResult.commits_behind !== null &&
                updateResult.commits_behind !== undefined && (
                  <strong>{updateResult.commits_behind} commits behind</strong>
                )}
            </div>
          )}

          <div className="detail-action-row local-action-row redesign-operation-tabs">
            <button
              className={`operation-button compact ${!diffDetail && !backupOpen ? "active" : ""}`}
              data-testid={`check-updates-${skill.id}`}
              disabled={!source || checkBusy}
              onClick={onCheck}
            >
              {checkBusy ? "检查中" : "检查更新"}
            </button>
            <button
              className={`operation-button compact ${diffDetail ? "active" : ""}`}
              data-testid={`toggle-diff-${skill.id}`}
              disabled={!source || diffBusy}
              onClick={onToggleDiff}
            >
              {diffBusy ? "加载 diff" : diffDetail ? "隐藏 diff" : "查看 diff"}
            </button>
            {canApplyUpdate && (
              <button
                className="operation-button compact"
                data-testid={`apply-update-${skill.id}`}
                disabled={!canApplyUpdate || applyBusy}
                onClick={onApplyUpdate}
              >
                {applyBusy ? "更新中" : "应用更新"}
              </button>
            )}
            <button
              className={`operation-button compact ${backupOpen ? "active" : ""}`}
              data-testid={`toggle-backups-${skill.id}`}
              disabled={!source || backupBusy}
              onClick={onToggleBackups}
            >
              {backupBusy ? "读取备份" : backupOpen ? "隐藏备份" : "备份/回滚"}
            </button>
          </div>

          {diffError && <InlineError error={diffError} />}
          {!diffDetail && !backupOpen && (
            <FormalCheckPanel skill={skill} source={source} updateResult={updateResult} />
          )}
          {diffDetail && <DiffPanel detail={diffDetail} />}

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
              onCancel={onCancelBind}
              onChange={onDraftChange}
              onSubmit={onBind}
            />
          </aside>
        </div>
      )}

    </section>
  );
}

function FormalDetailAgentPaths({
  rows,
  skill,
}: {
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
              className="redesign-detail-agent-path-row"
              data-testid={`skill-detail-agent-path-${skill.id}-${row.agentId}`}
              key={row.agentId}
            >
              <AgentBadge agent={row.agent} />
              <span>{row.agent.agent_name}</span>
              <code>{row.installPath}</code>
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
  const currentCommit = updateResult?.source?.current_commit ?? source?.current_commit ?? "local";
  const targetCommit =
    updateResult?.source?.remote_commit ?? source?.remote_commit ?? source?.ref_ ?? "unknown";
  const summary = updateResult?.diff_summary
    ? `+${updateResult.diff_summary.files_added} ~${updateResult.diff_summary.files_modified} -${updateResult.diff_summary.files_deleted}`
    : updateResult?.status === "UpToDate"
      ? "no changes"
      : "等待检查";
  const safeMessage = skill.local_modified
    ? "检测到本地修改，建议先查看 diff 或备份后再更新。"
    : "安全检查通过，建议先查看 diff；本地没有未提交修改。";

  return (
    <div className="redesign-check-panel" data-testid={`check-panel-${skill.id}`}>
      <div>
        <span>Local</span>
        <strong>{shortCommit(currentCommit)}</strong>
      </div>
      <div>
        <span>Remote</span>
        <strong>{shortCommit(targetCommit)}</strong>
      </div>
      <div>
        <span>Diff summary</span>
        <strong>{summary}</strong>
      </div>
      <p>{safeMessage}</p>
    </div>
  );
}

function shortCommit(value: string) {
  return value.length > 7 ? value.slice(0, 7) : value;
}

type DetailAgentInstallRow = {
  agent: AgentIdentity;
  agentId: string;
  installPath: string;
};

function detailInstalledAgentRows(
  skill: DesktopSkill,
  agentMemberships: Pick<DesktopSkill, "agent_id" | "agent_name" | "install_path">[],
  detailTargets: DesktopSkillTarget[],
) {
  const rows: DetailAgentInstallRow[] = [];
  const seen = new Set<string>();

  function addRow(agent: AgentIdentity, installPath: string) {
    const agentId = normalizeAgentId(agent.agent_id || agent.agent_name);
    if (!agentId || seen.has(agentId)) {
      return;
    }
    seen.add(agentId);
    rows.push({ agent, agentId, installPath });
  }

  for (const membership of agentMemberships) {
    addRow(
      { agent_id: membership.agent_id, agent_name: membership.agent_name },
      membership.install_path,
    );
  }

  addRow(
    { agent_id: skill.agent_id, agent_name: skill.agent_name },
    skill.install_path,
  );

  for (const target of detailTargets) {
    if (!isInstalledDetailTarget(target)) {
      continue;
    }
    addRow(
      { agent_id: target.agent_id, agent_name: target.agent_name },
      target.install_path,
    );
  }

  return rows;
}

function isInstalledDetailTarget(target: DesktopSkillTarget) {
  return target.status !== "NotInstalled" && Boolean(target.skill_id);
}
