import { useEffect, useMemo, useState } from "react";
import { AddSkillPage, type RemoteSyncDraft } from "./AddSkillPage";
import { remoteTargetId } from "./CrossAgentTargetMatrix";
import { SkillDetailPage } from "./SkillDetailPage";
import { InlineError, SkillRow, type BindDraft } from "./SkillRow";
import type {
  DesktopAgentStatus,
  DesktopBackupSummary,
  DesktopDiffDetail,
  DesktopError,
  DesktopInstallRemoteSkillResult,
  DesktopRemoteSkillPreview,
  DesktopScanWarning,
  DesktopSkill,
  DesktopSkillTarget,
  DesktopUpdateCheckResult,
  LoadState,
} from "./types";

type SkillsRoute = { kind: "list" } | { kind: "detail"; skillId: string } | { kind: "add" };

export function SkillsWorkspace({
  actionBusy,
  agents,
  backupError,
  backupPanels,
  backups,
  bindDraft,
  bindingSkillId,
  detailInstallResults,
  detailTargetErrors,
  detailTargets,
  diffDetails,
  diffError,
  error,
  remoteInstallResult,
  remotePreview,
  remoteSyncDraft,
  remoteTargets,
  selectedAgentId,
  selectedDetailTargetIds,
  selectedRemoteTargetIds,
  skillSearchQuery,
  skills,
  state,
  updateResults,
  warnings,
  onApplyUpdate,
  onBackupsToggle,
  onBind,
  onCancelBind,
  onCheckAgentUpdates,
  onCheckUpdates,
  onDraftChange,
  onInstallDetailTargets,
  onInstallRemoteTargets,
  onLoadDetailTargets,
  onOpenBind,
  onOpenSettings,
  onPreviewRemoteSync,
  onRestoreBackup,
  onScan,
  onSearchChange,
  onSelectAgent,
  onSetRemoteSyncDraft,
  onToggleDetailTarget,
  onToggleDiff,
  onToggleRemoteTarget,
  onUnbind,
}: {
  actionBusy: string | null;
  agents: DesktopAgentStatus[];
  backupError: Record<string, DesktopError>;
  backupPanels: Record<string, boolean>;
  backups: Record<string, DesktopBackupSummary[]>;
  bindDraft: BindDraft;
  bindingSkillId: string | null;
  detailInstallResults: Record<string, DesktopInstallRemoteSkillResult>;
  detailTargetErrors: Record<string, DesktopError>;
  detailTargets: Record<string, DesktopSkillTarget[]>;
  diffDetails: Record<string, DesktopDiffDetail>;
  diffError: Record<string, DesktopError>;
  error: DesktopError | null;
  remoteInstallResult: DesktopInstallRemoteSkillResult | null;
  remotePreview: DesktopRemoteSkillPreview | null;
  remoteSyncDraft: RemoteSyncDraft;
  remoteTargets: DesktopSkillTarget[];
  selectedAgentId: string | null;
  selectedDetailTargetIds: Record<string, string[]>;
  selectedRemoteTargetIds: string[];
  skillSearchQuery: string;
  skills: DesktopSkill[];
  state: LoadState;
  updateResults: Record<string, DesktopUpdateCheckResult>;
  warnings: DesktopScanWarning[];
  onApplyUpdate: (skillId: string) => void;
  onBackupsToggle: (skillId: string) => void;
  onBind: (skillId: string) => void;
  onCancelBind: () => void;
  onCheckAgentUpdates: (agentId: string) => void;
  onCheckUpdates: (skillIds: string[]) => void;
  onDraftChange: (draft: BindDraft) => void;
  onInstallDetailTargets: (skill: DesktopSkill) => void;
  onInstallRemoteTargets: () => void;
  onLoadDetailTargets: (skill: DesktopSkill) => void;
  onOpenBind: (skill: DesktopSkill) => void;
  onOpenSettings: () => void;
  onPreviewRemoteSync: () => void;
  onRestoreBackup: (skillId: string, backupId: string) => void;
  onScan: () => void;
  onSearchChange: (query: string) => void;
  onSelectAgent: (agentId: string | null) => void;
  onSetRemoteSyncDraft: (draft: RemoteSyncDraft) => void;
  onToggleDetailTarget: (skillId: string, target: DesktopSkillTarget) => void;
  onToggleDiff: (skillId: string) => void;
  onToggleRemoteTarget: (target: DesktopSkillTarget) => void;
  onUnbind: (skillId: string) => void;
}) {
  const [route, setRoute] = useState<SkillsRoute>({ kind: "list" });
  const groupedSkills = useMemo(() => {
    return agents.map((agent) => ({
      ...agent,
      skills: skills.filter((skill) => skill.agent_id === agent.agent_id),
    }));
  }, [agents, skills]);
  const selectedAgent = useMemo(
    () => groupedSkills.find((agent) => agent.agent_id === selectedAgentId) ?? null,
    [groupedSkills, selectedAgentId],
  );
  const normalizedSearchQuery = skillSearchQuery.trim().toLocaleLowerCase();
  const visibleSkills = useMemo(() => {
    if (normalizedSearchQuery) {
      return skills.filter((skill) => skillMatchesSearch(skill, normalizedSearchQuery));
    }
    if (selectedAgent) {
      return selectedAgent.skills;
    }
    return skills;
  }, [normalizedSearchQuery, selectedAgent, skills]);
  const routedSkill = useMemo(
    () =>
      route.kind === "detail" ? skills.find((skill) => skill.id === route.skillId) ?? null : null,
    [route, skills],
  );
  const visibleBoundCount = visibleSkills.filter((skill) => skill.source).length;
  const visibleModifiedCount = visibleSkills.filter((skill) => skill.local_modified).length;
  const visibleUpdateAvailableCount = visibleSkills.filter(
    (skill) => updateResults[skill.id]?.status === "UpdateAvailable",
  ).length;
  const detailTargetsLoaded = routedSkill ? Boolean(detailTargets[routedSkill.id]) : false;
  const detailTargetsFailed = routedSkill ? Boolean(detailTargetErrors[routedSkill.id]) : false;

  useEffect(() => {
    if (route.kind !== "detail" || !routedSkill?.source) {
      return;
    }
    if (detailTargetsLoaded || detailTargetsFailed) {
      return;
    }
    onLoadDetailTargets(routedSkill);
  }, [
    detailTargetsFailed,
    detailTargetsLoaded,
    routedSkill?.id,
    routedSkill?.source?.ref_,
    routedSkill?.source?.repo_path,
    routedSkill?.source?.url,
    route.kind,
  ]);

  return (
    <main className="workspace workspace-pane phase6-workspace" data-testid="workspace-skills">
      {route.kind === "detail" && routedSkill && (
        <SkillDetailPage
          actionBusy={actionBusy}
          backupError={backupError[routedSkill.id]}
          backupOpen={backupPanels[routedSkill.id] ?? false}
          backups={backups[routedSkill.id] ?? []}
          bindDraft={bindDraft}
          detailInstallResult={detailInstallResults[routedSkill.id]}
          detailTargetError={detailTargetErrors[routedSkill.id]}
          detailTargets={detailTargets[routedSkill.id] ?? []}
          diffDetail={diffDetails[routedSkill.id]}
          diffError={diffError[routedSkill.id]}
          isBinding={bindingSkillId === routedSkill.id}
          selectedDetailTargetIds={selectedDetailTargetIds[routedSkill.id] ?? []}
          skill={routedSkill}
          updateResult={updateResults[routedSkill.id]}
          onApplyUpdate={() => onApplyUpdate(routedSkill.id)}
          onBack={() => setRoute({ kind: "list" })}
          onBind={() => onBind(routedSkill.id)}
          onCancelBind={onCancelBind}
          onCheck={() => onCheckUpdates([routedSkill.id])}
          onDraftChange={onDraftChange}
          onInstallDetailTargets={() => onInstallDetailTargets(routedSkill)}
          onOpenBind={() => onOpenBind(routedSkill)}
          onRefreshDetailTargets={() => onLoadDetailTargets(routedSkill)}
          onRestoreBackup={(backupId) => onRestoreBackup(routedSkill.id, backupId)}
          onToggleBackups={() => onBackupsToggle(routedSkill.id)}
          onToggleDetailTarget={(target) => onToggleDetailTarget(routedSkill.id, target)}
          onToggleDiff={() => onToggleDiff(routedSkill.id)}
          onUnbind={() => onUnbind(routedSkill.id)}
        />
      )}

      {route.kind === "add" && (
        <AddSkillPage
          actionBusy={actionBusy}
          draft={remoteSyncDraft}
          installResult={remoteInstallResult}
          preview={remotePreview}
          selectedTargetIds={selectedRemoteTargetIds}
          targets={remoteTargets}
          onBack={() => setRoute({ kind: "list" })}
          onDraftChange={onSetRemoteSyncDraft}
          onInstallTargets={onInstallRemoteTargets}
          onPreview={onPreviewRemoteSync}
          onToggleTarget={onToggleRemoteTarget}
        />
      )}

      {route.kind === "list" && (
        <section className="skill-panel">
          <div className="panel-heading">
            <div>
              <h2>{panelTitle(selectedAgent, normalizedSearchQuery)}</h2>
              <p>{panelSubtitle(state, visibleSkills.length, normalizedSearchQuery)}</p>
            </div>
            <div className="phase6-list-actions">
              {selectedAgent && !normalizedSearchQuery && (
                <button
                  className="ghost-button compact"
                  data-testid={`check-agent-updates-${selectedAgent.agent_id}`}
                  disabled={actionBusy === `agent-check:${selectedAgent.agent_id}`}
                  onClick={() => onCheckAgentUpdates(selectedAgent.agent_id)}
                >
                  {actionBusy === `agent-check:${selectedAgent.agent_id}`
                    ? "检查中"
                    : `检查 ${selectedAgent.agent_name} 全部更新`}
                </button>
              )}
              <button className="compact" data-testid="open-add-skill" onClick={() => setRoute({ kind: "add" })}>
                + 添加 Skill
              </button>
              {warnings.length > 0 && (
                <span className="warning-pill">{warnings.length} 条 warning</span>
              )}
            </div>
          </div>
          <div className="agent-filter-bar" aria-label="Agent 筛选">
            <button
              aria-pressed={!selectedAgentId}
              className={`agent-filter-pill ${!selectedAgentId ? "active" : ""}`}
              data-testid="agent-filter-all"
              onClick={() => onSelectAgent(null)}
            >
              全部 <span>{skills.length}</span>
            </button>
            {groupedSkills.map((agent) => (
              <button
                aria-label={`查看 Agent ${agent.agent_id}`}
                aria-pressed={selectedAgentId === agent.agent_id}
                className={`agent-filter-pill ${selectedAgentId === agent.agent_id ? "active" : ""} ${
                  agent.skills.length === 0 ? "empty" : ""
                }`}
                data-testid={`agent-filter-${agent.agent_id}`}
                key={agent.agent_id}
                onClick={() => onSelectAgent(agent.agent_id)}
              >
                {agent.agent_name} <span>{agent.skills.length}</span>
              </button>
            ))}
          </div>
          <div className="skill-search-bar">
            <input
              data-testid="skill-search-input"
              placeholder="搜索本机 skill、Agent、路径或来源"
              value={skillSearchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
            />
            {skillSearchQuery && (
              <button className="ghost-button compact" onClick={() => onSearchChange("")}>
                清空
              </button>
            )}
          </div>
          <div className="agent-detail-summary">
            <SummaryMetric label="全部" value={visibleSkills.length.toString()} />
            <SummaryMetric
              label="已最新"
              value={visibleSkills
                .filter((skill) => updateResults[skill.id]?.status === "UpToDate")
                .length.toString()}
            />
            <SummaryMetric label="待更新" value={visibleUpdateAvailableCount.toString()} />
            <SummaryMetric label="已修改" value={visibleModifiedCount.toString()} />
          </div>
          {selectedAgent && !normalizedSearchQuery && (
            <div
              className="agent-detail-summary"
              data-testid={`agent-detail-${selectedAgent.agent_id}`}
            >
              <SummaryMetric label="此 Agent skills" value={visibleSkills.length.toString()} />
              <SummaryMetric label="已绑定来源" value={visibleBoundCount.toString()} />
              <SummaryMetric label="本地修改" value={visibleModifiedCount.toString()} />
              <SummaryMetric label="待更新" value={visibleUpdateAvailableCount.toString()} />
            </div>
          )}

          {state === "loading" && <LoadingState />}
          {state === "error" && <ErrorState message={error} onRetry={onScan} />}
          {state === "loaded" && visibleSkills.length === 0 && (
            <EmptyState onOpenSettings={onOpenSettings} onScan={onScan} />
          )}
          {state === "loaded" && visibleSkills.length > 0 && (
            <div className="skill-list">
              {visibleSkills.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  updateResult={updateResults[skill.id]}
                  diffDetail={diffDetails[skill.id]}
                  diffError={diffError[skill.id]}
                  backups={backups[skill.id] ?? []}
                  backupOpen={backupPanels[skill.id] ?? false}
                  backupError={backupError[skill.id]}
                  isBinding={bindingSkillId === skill.id}
                  bindDraft={bindDraft}
                  busyKey={actionBusy}
                  onOpenDetail={() => setRoute({ kind: "detail", skillId: skill.id })}
                  onOpenBind={() => onOpenBind(skill)}
                  onCancelBind={onCancelBind}
                  onDraftChange={onDraftChange}
                  onBind={() => onBind(skill.id)}
                  onUnbind={() => onUnbind(skill.id)}
                  onCheck={() => onCheckUpdates([skill.id])}
                  onToggleDiff={() => onToggleDiff(skill.id)}
                  onApplyUpdate={() => onApplyUpdate(skill.id)}
                  onToggleBackups={() => onBackupsToggle(skill.id)}
                  onRestoreBackup={(backupId) => onRestoreBackup(skill.id, backupId)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="state-block">
      <div className="loader" />
      <p>正在读取本地索引并扫描默认 skill 目录</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: DesktopError | null; onRetry: () => void }) {
  return (
    <div className="state-block error-state">
      <h3>扫描失败</h3>
      {message ? <InlineError error={message} /> : <p>未知错误</p>}
      <button onClick={onRetry}>重试扫描</button>
    </div>
  );
}

function EmptyState({
  onOpenSettings,
  onScan,
}: {
  onOpenSettings: () => void;
  onScan: () => void;
}) {
  return (
    <div className="state-block empty-state" data-testid="skills-empty-state">
      <h3>还没有发现 skills</h3>
      <p>默认目录中暂时没有可索引的 SKILL.md。可以重新扫描，或添加团队/个人的 Generic Agent Skills 根目录。</p>
      <div className="empty-actions">
        <button onClick={onScan}>重新扫描</button>
        <button className="ghost-button" onClick={onOpenSettings}>添加扫描路径</button>
      </div>
    </div>
  );
}

function panelTitle(
  selectedAgent: (DesktopAgentStatus & { skills: DesktopSkill[] }) | null,
  searchQuery: string,
) {
  if (searchQuery) {
    return "搜索结果";
  }
  if (selectedAgent) {
    return `${selectedAgent.agent_name} 工作区`;
  }
  return "Skill 索引";
}

function panelSubtitle(state: LoadState, count: number, searchQuery: string) {
  if (state === "loading") {
    return "正在同步 Core discovery 与 SQLite 索引";
  }
  if (state === "error") {
    return "请查看错误信息后重试";
  }
  if (searchQuery) {
    return `全局匹配 ${count} 个本机 skill，结果保留所属 Agent。`;
  }
  if (count === 0) {
    return "默认目录暂无已发现 skill";
  }
  return "来自本机 SQLite 索引和最新扫描结果";
}

function skillMatchesSearch(skill: DesktopSkill, query: string) {
  return [
    skill.name,
    skill.description,
    skill.agent_name,
    skill.agent_id,
    skill.install_path,
    skill.source?.url,
    skill.source?.repo_path,
  ]
    .filter(Boolean)
    .some((value) => value?.toLocaleLowerCase().includes(query));
}

export { remoteTargetId };
