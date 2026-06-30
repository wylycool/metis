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
  DesktopSource,
  DesktopSkillTarget,
  DesktopUpdateCheckResult,
  LoadState,
} from "./types";

type SkillsRoute = { kind: "list" } | { kind: "detail"; skillId: string } | { kind: "add" };
type SkillStatusFilter = "all" | "upToDate" | "updateAvailable" | "modified";

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
  onBackupsDetailToggle,
  onBackupsToggle,
  onBind,
  onCancelBind,
  onCheckAgentUpdates,
  onCheckDetailUpdates,
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
  onSelectAgent,
  onSetRemoteSyncDraft,
  onToggleDetailTarget,
  onToggleDetailDiff,
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
  onBackupsDetailToggle: (skill: DesktopSkill) => void;
  onBackupsToggle: (skillId: string) => void;
  onBind: (skillId: string) => void;
  onCancelBind: () => void;
  onCheckAgentUpdates: (agentId: string) => void;
  onCheckDetailUpdates: (skill: DesktopSkill) => void;
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
  onSelectAgent: (agentId: string | null) => void;
  onSetRemoteSyncDraft: (draft: RemoteSyncDraft) => void;
  onToggleDetailTarget: (skillId: string, target: DesktopSkillTarget) => void;
  onToggleDetailDiff: (skill: DesktopSkill) => void;
  onToggleDiff: (skillId: string) => void;
  onToggleRemoteTarget: (target: DesktopSkillTarget) => void;
  onUnbind: (skillId: string) => void;
}) {
  const [route, setRoute] = useState<SkillsRoute>({ kind: "list" });
  const [statusFilter, setStatusFilter] = useState<SkillStatusFilter>("all");
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
  const searchMatchedSkills = useMemo(() => {
    if (!normalizedSearchQuery) {
      return skills;
    }
    return skills.filter((skill) => skillMatchesSearch(skill, normalizedSearchQuery));
  }, [normalizedSearchQuery, skills]);
  const agentVisibleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of agents) {
      const matches = searchMatchedSkills.filter((skill) => skill.agent_id === agent.agent_id);
      counts.set(agent.agent_id, uniqueSkills(matches).length);
    }
    return counts;
  }, [agents, searchMatchedSkills]);
  const allAgentVisibleCount = useMemo(
    () => uniqueSkills(searchMatchedSkills).length,
    [searchMatchedSkills],
  );
  const baseVisibleSkills = useMemo(() => {
    if (normalizedSearchQuery) {
      return uniqueSkills(searchMatchedSkills);
    }
    if (selectedAgent) {
      return selectedAgent.skills;
    }
    return skills;
  }, [normalizedSearchQuery, searchMatchedSkills, selectedAgent, skills]);
  const visibleSkills = useMemo(
    () =>
      baseVisibleSkills.filter((skill) => {
        if (statusFilter === "upToDate") {
          return updateResults[skill.id]?.status === "UpToDate";
        }
        if (statusFilter === "updateAvailable") {
          return updateResults[skill.id]?.status === "UpdateAvailable";
        }
        if (statusFilter === "modified") {
          return Boolean(skill.local_modified);
        }
        return true;
      }),
    [baseVisibleSkills, statusFilter, updateResults],
  );
  const routedSkill = useMemo(
    () =>
      route.kind === "detail" ? skills.find((skill) => skill.id === route.skillId) ?? null : null,
    [route, skills],
  );
  const routedDetailSkill = useMemo(
    () => (routedSkill ? skillWithEffectiveSource(routedSkill, skills) : null),
    [routedSkill, skills],
  );
  const visibleModifiedCount = baseVisibleSkills.filter((skill) => skill.local_modified).length;
  const visibleUpdateAvailableCount = baseVisibleSkills.filter(
    (skill) => updateResults[skill.id]?.status === "UpdateAvailable",
  ).length;
  const visibleUpToDateCount = baseVisibleSkills.filter(
    (skill) => updateResults[skill.id]?.status === "UpToDate",
  ).length;
  const detailTargetsLoaded = routedDetailSkill ? Boolean(detailTargets[routedDetailSkill.id]) : false;
  const detailTargetsFailed = routedDetailSkill
    ? Boolean(detailTargetErrors[routedDetailSkill.id])
    : false;

  useEffect(() => {
    if (route.kind !== "detail" || !routedDetailSkill?.source) {
      return;
    }
    if (detailTargetsLoaded || detailTargetsFailed) {
      return;
    }
    onLoadDetailTargets(routedDetailSkill);
  }, [
    detailTargetsFailed,
    detailTargetsLoaded,
    routedDetailSkill?.id,
    routedDetailSkill?.source?.ref_,
    routedDetailSkill?.source?.repo_path,
    routedDetailSkill?.source?.url,
    route.kind,
  ]);

  return (
    <main
      className={`workspace workspace-pane phase6-workspace ${
        route.kind === "list" ? "redesign-home" : ""
      }`}
      data-testid="workspace-skills"
    >
      {route.kind === "detail" && routedDetailSkill && (
        <SkillDetailPage
          actionBusy={actionBusy}
          backupError={backupError[routedDetailSkill.id]}
          backupOpen={backupPanels[routedDetailSkill.id] ?? false}
          backups={backups[routedDetailSkill.id] ?? []}
          bindDraft={bindDraft}
          detailInstallResult={detailInstallResults[routedDetailSkill.id]}
          detailTargetError={detailTargetErrors[routedDetailSkill.id]}
          detailTargets={detailTargets[routedDetailSkill.id] ?? []}
          diffDetail={diffDetails[routedDetailSkill.id]}
          diffError={diffError[routedDetailSkill.id]}
          isBinding={bindingSkillId === routedDetailSkill.id}
          selectedDetailTargetIds={selectedDetailTargetIds[routedDetailSkill.id] ?? []}
          skill={routedDetailSkill}
          updateResult={updateResults[routedDetailSkill.id]}
          onBack={() => setRoute({ kind: "list" })}
          onBind={() => onBind(routedDetailSkill.id)}
          onCancelBind={onCancelBind}
          onCheck={() => onCheckDetailUpdates(routedDetailSkill)}
          onDraftChange={onDraftChange}
          onInstallDetailTargets={() => onInstallDetailTargets(routedDetailSkill)}
          onApplyUpdate={() => onApplyUpdate(routedDetailSkill.id)}
          onOpenBind={() => onOpenBind(routedDetailSkill)}
          onRefreshDetailTargets={() => onLoadDetailTargets(routedDetailSkill)}
          onRestoreBackup={(backupId) => onRestoreBackup(routedDetailSkill.id, backupId)}
          onToggleBackups={() => onBackupsDetailToggle(routedDetailSkill)}
          onToggleDetailTarget={(target) => onToggleDetailTarget(routedDetailSkill.id, target)}
          onToggleDiff={() => onToggleDetailDiff(routedDetailSkill)}
          onUnbind={() => onUnbind(routedDetailSkill.id)}
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
        <section className="skill-panel redesign-home">
          <div className="skill-dashboard-stats redesign-home-stats" data-testid="skill-dashboard-stats">
            <DashboardStat label="全部 Skill" value={baseVisibleSkills.length} tone="mint" />
            <DashboardStat label="待更新" value={visibleUpdateAvailableCount} tone="warm" />
            <DashboardStat label="已最新" value={visibleUpToDateCount} tone="blue" />
            <DashboardStat label="本地修改" value={visibleModifiedCount} tone="rose" />
          </div>

          <div
            className="skill-status-filters agent-detail-summary"
            data-testid={
              selectedAgent && !normalizedSearchQuery
                ? `agent-detail-${selectedAgent.agent_id}`
                : "skill-status-filters"
            }
          >
            <StatusFilterButton
              active={statusFilter === "all"}
              count={baseVisibleSkills.length}
              label="全部"
              testId="status-filter-all"
              tone="mint"
              onClick={() => setStatusFilter("all")}
            />
            <StatusFilterButton
              active={statusFilter === "upToDate"}
              count={visibleUpToDateCount}
              label="已最新"
              testId="status-filter-up-to-date"
              tone="sky"
              onClick={() => setStatusFilter("upToDate")}
            />
            <StatusFilterButton
              active={statusFilter === "updateAvailable"}
              count={visibleUpdateAvailableCount}
              label="待更新"
              testId="status-filter-update-available"
              tone="rose"
              onClick={() => setStatusFilter("updateAvailable")}
            />
            <StatusFilterButton
              active={statusFilter === "modified"}
              count={visibleModifiedCount}
              label="已修改"
              testId="status-filter-modified"
              tone="warm"
              onClick={() => setStatusFilter("modified")}
            />
          </div>

          <div className="agent-filter-bar" data-testid="agent-category-bar" aria-label="Agent 筛选">
            <button
              aria-pressed={!selectedAgentId}
              className={`agent-filter-pill ${!selectedAgentId ? "active" : ""}`}
              data-testid="agent-filter-all"
              onClick={() => onSelectAgent(null)}
            >
              <b aria-hidden="true" />
              <span className="agent-filter-label">全部 Agent</span>
              <span className="agent-filter-count">{allAgentVisibleCount}</span>
            </button>
            {groupedSkills.map((agent) => {
              const visibleCount = agentVisibleCounts.get(agent.agent_id) ?? 0;
              return (
                <button
                  aria-label={`查看 Agent ${agent.agent_id}`}
                  aria-pressed={selectedAgentId === agent.agent_id}
                  className={`agent-filter-pill ${selectedAgentId === agent.agent_id ? "active" : ""} ${
                    visibleCount === 0 ? "empty" : ""
                  }`}
                  data-testid={`agent-filter-${agent.agent_id}`}
                  key={agent.agent_id}
                  onClick={() => onSelectAgent(agent.agent_id)}
                >
                  <b aria-hidden="true" />
                  <span className="agent-filter-label">{agent.agent_name}</span>
                  <span className="agent-filter-count">{visibleCount}</span>
                </button>
              );
            })}
            <button className="compact add-skill-button" data-testid="open-add-skill" onClick={() => setRoute({ kind: "add" })}>
              + 添加 Skill
            </button>
            {selectedAgent && !normalizedSearchQuery && (
              <button
                className="ghost-button compact"
                data-testid={`check-agent-updates-${selectedAgent.agent_id}`}
                disabled={actionBusy === `agent-check:${selectedAgent.agent_id}`}
                onClick={() => onCheckAgentUpdates(selectedAgent.agent_id)}
              >
                {actionBusy === `agent-check:${selectedAgent.agent_id}` ? "检查中" : "检查此类更新"}
              </button>
            )}
            {warnings.length > 0 && (
              <span className="warning-pill">{warnings.length} 条 warning</span>
            )}
          </div>

          {state === "loading" && <LoadingState />}
          {state === "error" && <ErrorState message={error} onRetry={onScan} />}
          {state === "loaded" && visibleSkills.length === 0 && (
            <EmptyState onOpenSettings={onOpenSettings} onScan={onScan} />
          )}
          {state === "loaded" && visibleSkills.length > 0 && (
            <>
            <div className="redesign-section-heading">
              <div>
                <p>Skill inventory</p>
                <h2>跨 Agent 安装概览</h2>
              </div>
              <span>{visibleSkills.length} of {baseVisibleSkills.length} visible</span>
            </div>
            <div className="skill-list redesign-skill-grid" data-testid="skill-card-grid">
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
            </>
          )}
        </section>
      )}
    </main>
  );
}

function DashboardStat({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "mint" | "rose" | "blue" | "warm";
  value: number;
}) {
  return (
    <article className={`dashboard-stat-card redesign-stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{label === "待更新" ? "needs review" : label === "已最新" ? "ready to use" : "from real scan"}</small>
    </article>
  );
}

function StatusFilterButton({
  active,
  count,
  label,
  testId,
  tone,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  testId: string;
  tone: "mint" | "sky" | "rose" | "warm";
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`status-filter-button ${tone} ${active ? "active" : ""}`}
      data-testid={testId}
      onClick={onClick}
    >
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
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

function uniqueSkills(skills: DesktopSkill[]) {
  const seen = new Set<string>();
  const unique: DesktopSkill[] = [];
  for (const skill of skills) {
    const key = skillIdentityKey(skill);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(skill);
  }
  return unique;
}

function skillIdentityKey(skill: DesktopSkill) {
  if (skill.source) {
    return [
      "source",
      skill.source.url,
      skill.source.repo_path,
      skill.source.ref_ || "main",
    ].join("\u0000");
  }
  return `name\u0000${skill.name.trim().toLocaleLowerCase()}`;
}

function skillWithEffectiveSource(skill: DesktopSkill, skills: DesktopSkill[]): DesktopSkill {
  const source = skill.source ?? reusableSourceForSkill(skill, skills);
  if (!source) {
    return skill;
  }
  return {
    ...skill,
    source_id: skill.source_id ?? source.id,
    source,
  };
}

function reusableSourceForSkill(
  skill: DesktopSkill,
  skills: DesktopSkill[],
): DesktopSource | null {
  if (skill.source) {
    return skill.source;
  }
  return (
    skills.find(
      (candidate) =>
        candidate.id !== skill.id &&
        candidate.name === skill.name &&
        candidate.source !== null &&
        candidate.source !== undefined,
    )?.source ?? null
  );
}

export { remoteTargetId };
