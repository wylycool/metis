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
  DesktopBackupSummary,
  DesktopDiffDetail,
  DesktopError,
  DesktopInstallRemoteSkillResult,
  DesktopSkill,
  DesktopSkillTarget,
  DesktopSourceConnectionTestResult,
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
  sourceConnectionError,
  sourceConnectionResult,
  agentMemberships,
  selectedDetailTargetIds,
  skill,
  updateResult,
  updateResults,
  onBack,
  onBind,
  onCancelBind,
  onCheck,
  onDraftChange,
  onTestSourceConnection,
  onInstallDetailTargets,
  onApplyUpdate,
  onApplyNeededAgentUpdates,
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
  sourceConnectionError?: DesktopError;
  sourceConnectionResult?: DesktopSourceConnectionTestResult;
  agentMemberships: Pick<
    DesktopSkill,
    "agent_id" | "agent_name" | "id" | "install_path" | "local_modified"
    | "source_id"
  >[];
  selectedDetailTargetIds: string[];
  skill: DesktopSkill;
  updateResult?: DesktopUpdateCheckResult;
  updateResults: Record<string, DesktopUpdateCheckResult>;
  onBack: () => void;
  onBind: () => void;
  onCancelBind: () => void;
  onCheck: () => void;
  onDraftChange: (draft: BindDraft) => void;
  onTestSourceConnection: () => void;
  onInstallDetailTargets: () => void;
  onApplyUpdate: (skillId: string, mode?: "overwrite-local") => void;
  onApplyNeededAgentUpdates: (skillIds: string[]) => void;
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
  const testSourceBusy = actionBusy === `test-source:${skill.id}`;
  const unbindBusy = actionBusy === `unbind:${skill.id}`;
  const diffBusy = actionBusy === `diff:${skill.id}`;
  const backupBusy = actionBusy === `backups:${skill.id}`;
  const installedAgentRows = useMemo(
    () => detailInstalledAgentRows(skill, agentMemberships, detailTargets, updateResults),
    [agentMemberships, detailTargets, skill, updateResults],
  );
  const detailSummary = detailAggregateSummary(installedAgentRows);
  const outdatedAgentRows = installedAgentRows.filter((row) => row.statusKind === "update");
  const applyNeededBusy = actionBusy === "apply-needed-agent-updates";
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
          <p className="redesign-detail-summary-message">{detailSummary.message}</p>
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
              disabled={installedAgentRows.length === 0 || checkBusy}
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
            {outdatedAgentRows.length > 0 && (
              <button
                className="operation-button compact"
                data-testid={`apply-needed-agent-updates-${skill.id}`}
                disabled={applyNeededBusy}
                onClick={() => onApplyNeededAgentUpdates(outdatedAgentRows.map((row) => row.skillId))}
              >
                {applyNeededBusy ? "更新中" : "更新需要更新的 Agent"}
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
  detailTargets: DesktopSkillTarget[],
  updateResults: Record<string, DesktopUpdateCheckResult>,
) {
  const rows: DetailAgentInstallRow[] = [];
  const seen = new Set<string>();

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
      Boolean(membership.source_id),
    );
  }

  addRow(
    { agent_id: skill.agent_id, agent_name: skill.agent_name },
    skill.install_path,
    skill.id,
    skill.local_modified === true,
    Boolean(skill.source_id),
  );

  for (const target of detailTargets) {
    if (!isInstalledDetailTarget(target)) {
      continue;
    }
    addRow(
      { agent_id: target.agent_id, agent_name: target.agent_name },
      target.install_path,
      target.skill_id ?? skill.id,
      target.local_modified,
      Boolean(target.source_id),
    );
  }

  return rows;
}

function isInstalledDetailTarget(target: DesktopSkillTarget) {
  return target.status !== "NotInstalled" && Boolean(target.skill_id);
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
      message: "展开安装位置查看哪些 Agent 被改过；如果是误修改，可在对应行点击覆盖更新。",
      tone: "warning",
    };
  }
  if (rows.some((row) => row.statusKind === "update")) {
    return {
      label: "有 Agent 需要更新",
      message: "展开安装位置查看哪些 Agent 需要更新，并可一键更新需要处理的项。",
      tone: "warning",
    };
  }
  if (rows.length > 0 && rows.every((row) => row.statusKind === "latest")) {
    return {
      label: "所有 Agent 均无需更新",
      message: "已安装此 skill 的 Agent 都与来源版本一致。",
      tone: "good",
    };
  }
  if (rows.some((row) => row.statusKind === "failed" || row.statusKind === "no-source")) {
    return {
      label: "部分 Agent 暂无法判断",
      message: "展开安装位置查看原因，例如来源未绑定、Git 访问失败或路径不可访问。",
      tone: "muted",
    };
  }
  return {
    label: "尚未检查 Agent 状态",
    message: "点击检查更新后，Metis 会分别检查每个已安装 Agent 的版本和来源状态。",
    tone: "muted",
  };
}
