import { useEffect, useMemo, useRef, useState } from "react";
import { AddSkillPage, type RemoteSyncDraft } from "./AddSkillPage";
import { isRemoteTargetSelectable, remoteTargetId } from "./CrossAgentTargetMatrix";
import {
  emptyDetailLocalInstallState,
  SkillDetailPage,
  type DetailLocalInstallState,
} from "./SkillDetailPage";
import { InlineError, SkillRow, type BindDraft } from "./SkillRow";
import type {
  DesktopBackupSummary,
  DesktopAuditEvent,
  DesktopDiffDetail,
  DesktopError,
  DesktopInstallRemoteSkillResult,
  DesktopLocalSkillTarget,
  DesktopRemoteSkillPreview,
  DesktopSkill,
  DesktopSkillSize,
  DesktopSourceConnectionTestResult,
  DesktopSource,
  DesktopSkillTarget,
  DesktopUpdateCheckResult,
  LoadState,
} from "./types";

type SkillsRoute = { kind: "list" } | { kind: "detail"; skillId: string } | { kind: "add" };
type SkillSortMode = "name" | "source" | "recent";
const HOME_SKILL_PREVIEW_LIMIT = 6;

export function SkillsWorkspace({
  actionBusy,
  backupError,
  backupPanels,
  backups,
  bindDraft,
  bindingSkillId,
  detailLocalInstallStates,
  diffDetails,
  diffError,
  error,
  remoteInstallResult,
  remotePreview,
  remotePreviewError,
  remoteSyncDraft,
  remoteTargets,
  selectedRemoteTargetIds,
  homeNavigationKey,
  homeCheckCompletionKey,
  skillAuditEvents,
  skillSearchQuery,
  skillSizes,
  sourceConnectionErrors,
  sourceConnectionResults,
  skills,
  state,
  updateResults,
  onApplyUpdate,
  onBackupsDetailToggle,
  onBackupsToggle,
  onBind,
  onCancelBind,
  onCheckDetailUpdates,
  onCheckUpdates,
  onDraftChange,
  onInstallDetailTargets,
  onInstallRemoteTargets,
  onLoadDetailTargets,
  onLoadSkillAuditEvents,
  onLoadSkillSize,
  onOpenBind,
  onOpenSettings,
  onPreviewRemoteSync,
  onApplyNeededAgentUpdates,
  onResetRemoteSync,
  onSelectAllValidRemoteTargets,
  onSelectAllDetailTargets,
  onRestoreBackup,
  onRouteKindChange,
  onScan,
  onSetRemoteSyncDraft,
  onToggleDetailDiff,
  onToggleDiff,
  onToggleDetailTarget,
  onToggleRemoteTarget,
  onTestSourceConnection,
  onUnbind,
}: {
  actionBusy: string | null;
  backupError: Record<string, DesktopError>;
  backupPanels: Record<string, boolean>;
  backups: Record<string, DesktopBackupSummary[]>;
  bindDraft: BindDraft;
  bindingSkillId: string | null;
  detailLocalInstallStates: Record<string, DetailLocalInstallState>;
  diffDetails: Record<string, DesktopDiffDetail>;
  diffError: Record<string, DesktopError>;
  error: DesktopError | null;
  remoteInstallResult: DesktopInstallRemoteSkillResult | null;
  remotePreview: DesktopRemoteSkillPreview | null;
  remotePreviewError: DesktopError | null;
  remoteSyncDraft: RemoteSyncDraft;
  remoteTargets: DesktopSkillTarget[];
  selectedRemoteTargetIds: string[];
  homeNavigationKey: number;
  homeCheckCompletionKey: number | null;
  skillAuditEvents: Record<string, DesktopAuditEvent[]>;
  skillSearchQuery: string;
  skillSizes: Record<string, DesktopSkillSize>;
  sourceConnectionErrors: Record<string, DesktopError>;
  sourceConnectionResults: Record<string, DesktopSourceConnectionTestResult>;
  skills: DesktopSkill[];
  state: LoadState;
  updateResults: Record<string, DesktopUpdateCheckResult>;
  onApplyUpdate: (skillId: string, mode?: "overwrite-local") => void;
  onApplyNeededAgentUpdates: (skillIds: string[]) => void;
  onBackupsDetailToggle: (skill: DesktopSkill) => void;
  onBackupsToggle: (skillId: string) => void;
  onBind: (skillId: string) => void;
  onCancelBind: () => void;
  onCheckDetailUpdates: (skills: DesktopSkill[]) => void;
  onCheckUpdates: (skillIds: string[]) => void;
  onDraftChange: (draft: BindDraft) => void;
  onInstallDetailTargets: (skill: DesktopSkill) => void;
  onInstallRemoteTargets: () => void;
  onLoadDetailTargets: (skill: DesktopSkill) => void;
  onLoadSkillAuditEvents: (skillId: string) => void;
  onLoadSkillSize: (skillId: string) => void;
  onOpenBind: (skill: DesktopSkill) => void;
  onOpenSettings: () => void;
  onPreviewRemoteSync: () => void;
  onResetRemoteSync: () => void;
  onSelectAllValidRemoteTargets: () => void;
  onSelectAllDetailTargets: (skillId: string) => void;
  onRestoreBackup: (skillId: string, backupId: string) => void;
  onRouteKindChange: (kind: SkillsRoute["kind"]) => void;
  onScan: () => void;
  onSetRemoteSyncDraft: (draft: RemoteSyncDraft) => void;
  onToggleDetailDiff: (skill: DesktopSkill, updateResult?: DesktopUpdateCheckResult) => void;
  onToggleDiff: (skillId: string) => void;
  onToggleDetailTarget: (skillId: string, target: DesktopLocalSkillTarget) => void;
  onToggleRemoteTarget: (target: DesktopSkillTarget) => void;
  onTestSourceConnection: (skillId: string) => void;
  onUnbind: (skillId: string) => void;
}) {
  const [route, setRoute] = useState<SkillsRoute>({ kind: "list" });
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [skillSortMode, setSkillSortMode] = useState<SkillSortMode>("recent");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const normalizedSearchQuery = skillSearchQuery.trim().toLocaleLowerCase();
  const searchMatchedSkills = useMemo(() => {
    if (!normalizedSearchQuery) {
      return skills;
    }
    return skills.filter((skill) => skillMatchesSearch(skill, normalizedSearchQuery));
  }, [normalizedSearchQuery, skills]);
  const baseVisibleSkills = useMemo(() => {
    return uniqueSkills(searchMatchedSkills);
  }, [searchMatchedSkills]);
  const agentMembershipsByKey = useMemo(() => {
    return agentMembershipsBySkillKey(searchMatchedSkills);
  }, [searchMatchedSkills]);
  const visibleSkills = useMemo(() => {
    return sortHomeSkills(baseVisibleSkills, skillSortMode, agentMembershipsByKey);
  }, [agentMembershipsByKey, baseVisibleSkills, skillSortMode]);
  const displayedSkills = showAllSkills
    ? visibleSkills
    : visibleSkills.slice(0, HOME_SKILL_PREVIEW_LIMIT);
  const hiddenSkillCount = Math.max(visibleSkills.length - displayedSkills.length, 0);
  const routedSkill = useMemo(
    () =>
      route.kind === "detail" ? skills.find((skill) => skill.id === route.skillId) ?? null : null,
    [route, skills],
  );
  const routedDetailSkill = useMemo(
    () => (routedSkill ? skillWithEffectiveSource(routedSkill, skills) : null),
    [routedSkill, skills],
  );
  const routedDetailSkillWithSize = useMemo(
    () =>
      routedDetailSkill
        ? skillWithLazySize(routedDetailSkill, skillSizes[routedDetailSkill.id])
        : null,
    [routedDetailSkill, skillSizes],
  );
  const visibleModifiedCount = baseVisibleSkills.filter((skill) => skill.local_modified).length;
  const visibleUpdateAvailableCount = baseVisibleSkills.filter(
    (skill) => updateResults[skill.id]?.status === "UpdateAvailable",
  ).length;
  const visibleUpToDateCount = baseVisibleSkills.filter(
    (skill) => updateResults[skill.id]?.status === "UpToDate",
  ).length;
  const routedAgentMemberships =
    routedSkill && routedDetailSkill
      ? relatedAgentMembershipsForSkill(routedSkill, skills)
      : routedDetailSkill
        ? [routedDetailSkill]
        : [];

  useEffect(() => {
    onRouteKindChange(route.kind);
  }, [onRouteKindChange, route.kind]);

  useEffect(() => {
    setRoute({ kind: "list" });
  }, [homeNavigationKey]);

  useEffect(() => {
    setShowAllSkills(false);
  }, [normalizedSearchQuery, skillSortMode, skills.length]);

  useEffect(() => {
    if (route.kind !== "detail" || !routedDetailSkill) {
      return;
    }
    onLoadSkillAuditEvents(routedDetailSkill.id);
  }, [onLoadSkillAuditEvents, route.kind, routedDetailSkill?.id]);

  useEffect(() => {
    if (route.kind !== "detail" || !routedDetailSkill) {
      return;
    }
    onLoadSkillSize(routedDetailSkill.id);
  }, [onLoadSkillSize, route.kind, routedDetailSkill?.id]);

  useEffect(() => {
    try {
      workspaceRef.current?.scrollTo?.({ top: 0, left: 0, behavior: "instant" });
    } catch {
      // Some test and webview environments do not implement element scrollTo options.
    }
    if (workspaceRef.current) {
      workspaceRef.current.scrollTop = 0;
    }
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    } catch {
      // jsdom exposes scrollTo but may report it as not implemented.
    }
  }, [route.kind, routedDetailSkill?.id]);

  return (
    <main
      ref={workspaceRef}
      className={`workspace workspace-pane phase6-workspace ${
        route.kind === "list" ? "redesign-home" : ""
      }`}
      data-testid="workspace-skills"
    >
      {route.kind === "detail" && routedDetailSkill && routedDetailSkillWithSize && (
        <SkillDetailPage
          actionBusy={actionBusy}
          backupError={backupError[routedDetailSkill.id]}
          backupOpen={backupPanels[routedDetailSkill.id] ?? false}
          backups={backups[routedDetailSkill.id] ?? []}
          bindDraft={bindDraft}
          detailLocalInstallState={
            detailLocalInstallStates[routedDetailSkill.id] ?? emptyDetailLocalInstallState()
          }
          diffDetail={diffDetails[routedDetailSkill.id]}
          diffError={diffError[routedDetailSkill.id]}
          isBinding={bindingSkillId === routedDetailSkill.id}
          sourceConnectionError={sourceConnectionErrors[routedDetailSkill.id]}
          sourceConnectionResult={sourceConnectionResults[routedDetailSkill.id]}
          agentMemberships={routedAgentMemberships}
          skill={routedDetailSkillWithSize}
          skillAuditEvents={skillAuditEvents[routedDetailSkill.id] ?? []}
          updateResult={updateResults[routedDetailSkill.id]}
          updateResults={updateResults}
          onBack={() => setRoute({ kind: "list" })}
          onBind={() => onBind(routedDetailSkill.id)}
          onCancelBind={onCancelBind}
          onCheck={() => onCheckDetailUpdates(uniqueSkillsById([...routedAgentMemberships, routedDetailSkill]))}
          onDraftChange={onDraftChange}
          onInstallDetailTargets={() => onInstallDetailTargets(routedDetailSkill)}
          onLoadDetailTargets={() => onLoadDetailTargets(routedDetailSkill)}
          onSelectAllDetailTargets={() => onSelectAllDetailTargets(routedDetailSkill.id)}
          onTestSourceConnection={() => onTestSourceConnection(routedDetailSkill.id)}
          onToggleDetailTarget={(target) =>
            onToggleDetailTarget(routedDetailSkill.id, target)
          }
          onApplyUpdate={onApplyUpdate}
          onApplyNeededAgentUpdates={onApplyNeededAgentUpdates}
          onOpenBind={() => onOpenBind(routedDetailSkill)}
          onRestoreBackup={(backupId) => onRestoreBackup(routedDetailSkill.id, backupId)}
          onToggleBackups={() => onBackupsDetailToggle(routedDetailSkill)}
          onToggleDiff={() =>
            onToggleDetailDiff(routedDetailSkill, updateResults[routedDetailSkill.id])
          }
          onUnbind={() => onUnbind(routedDetailSkill.id)}
        />
      )}

      {route.kind === "add" && (
        <AddSkillPage
          actionBusy={actionBusy}
          draft={remoteSyncDraft}
          installResult={remoteInstallResult}
          preview={remotePreview}
          previewError={remotePreviewError}
          selectedTargetIds={selectedRemoteTargetIds}
          targets={remoteTargets}
          onBack={() => setRoute({ kind: "list" })}
          onDraftChange={onSetRemoteSyncDraft}
          onInstallTargets={onInstallRemoteTargets}
          onPreview={onPreviewRemoteSync}
          onReset={onResetRemoteSync}
          onSelectAllValidTargets={onSelectAllValidRemoteTargets}
          onToggleTarget={onToggleRemoteTarget}
        />
      )}

      {route.kind === "list" && (
        <section className="skill-panel redesign-home">
          <div
            className={`skill-dashboard-stats redesign-home-stats${
              homeCheckCompletionKey === null ? "" : " is-check-complete"
            }`}
            data-testid="skill-dashboard-stats"
          >
            {homeCheckCompletionKey !== null && (
              <div
                aria-live="polite"
                className="skill-dashboard-check-complete"
                data-testid="skill-dashboard-check-complete"
                key={homeCheckCompletionKey}
                role="status"
              >
                <span aria-hidden="true">✓</span>
                检查完成
              </div>
            )}
            <DashboardStat label="全部 Skill" value={baseVisibleSkills.length} tone="mint" />
            <DashboardStat label="待更新" value={visibleUpdateAvailableCount} tone="warm" />
            <DashboardStat label="已最新" value={visibleUpToDateCount} tone="blue" />
            <DashboardStat label="本地修改" value={visibleModifiedCount} tone="rose" />
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
              <div className="skill-list-actions" data-testid="skill-list-actions">
                <label className="skill-sort-control" data-testid="skill-sort-control">
                  <span>排序</span>
                  <select
                    aria-label="排序 Skill"
                    data-testid="skill-sort-select"
                    value={skillSortMode}
                    onChange={(event) => setSkillSortMode(event.target.value as SkillSortMode)}
                  >
                    <option value="name">首字母</option>
                    <option value="source">来源状态</option>
                    <option value="recent">最近修改</option>
                  </select>
                </label>
                <button
                  className="compact add-skill-button"
                  data-testid="open-add-skill"
                  onClick={() => {
                    onResetRemoteSync();
                    setRoute({ kind: "add" });
                  }}
                >
                  + 添加 Skill
                </button>
              </div>
            </div>
            <div className="skill-list redesign-skill-grid" data-testid="skill-card-grid">
              {displayedSkills.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  agentMemberships={agentMembershipsByKey.get(skillIdentityKey(skill)) ?? [skill]}
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
            {hiddenSkillCount > 0 && (
              <button
                className="redesign-show-more"
                data-testid="show-more-skills"
                onClick={() => setShowAllSkills(true)}
              >
                查看更多 {hiddenSkillCount} 个
              </button>
            )}
            {showAllSkills && visibleSkills.length > HOME_SKILL_PREVIEW_LIMIT && (
              <button
                className="redesign-show-more"
                data-testid="collapse-skills"
                onClick={() => setShowAllSkills(false)}
              >
                收起
              </button>
            )}
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
    </article>
  );
}

function sortHomeSkills(
  skills: DesktopSkill[],
  mode: SkillSortMode,
  membershipsByKey: Map<string, DesktopSkill[]>,
) {
  return [...skills].sort((left, right) => {
    if (mode === "source") {
      const leftHasSource = skillHasSourceInMemberships(left, membershipsByKey);
      const rightHasSource = skillHasSourceInMemberships(right, membershipsByKey);
      if (leftHasSource !== rightHasSource) {
        return leftHasSource ? -1 : 1;
      }
    }

    if (mode === "recent") {
      const recentCompare = skillRecentAtMs(right) - skillRecentAtMs(left);
      if (recentCompare !== 0) {
        return recentCompare;
      }
    }

    return compareSkillName(left, right);
  });
}

function compareSkillName(left: DesktopSkill, right: DesktopSkill) {
  const nameCompare = left.name.localeCompare(right.name, "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });

  if (nameCompare !== 0) {
    return nameCompare;
  }

  return left.id.localeCompare(right.id, "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function skillHasSourceInMemberships(
  skill: DesktopSkill,
  membershipsByKey: Map<string, DesktopSkill[]>,
) {
  const memberships = membershipsByKey.get(skillIdentityKey(skill)) ?? [skill];
  return memberships.some((membership) => Boolean(membership.source_id || membership.source));
}

function skillRecentAtMs(skill: DesktopSkill) {
  const recentAt = Date.parse(skill.local_updated_at ?? skill.last_scanned_at);
  return Number.isNaN(recentAt) ? 0 : recentAt;
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
      <p>默认目录中暂时没有可索引的 SKILL.md。可以重新扫描，或到 Settings 添加自定义路径。</p>
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

function uniqueSkillsById(skills: DesktopSkill[]) {
  const seen = new Set<string>();
  const unique: DesktopSkill[] = [];
  for (const skill of skills) {
    if (seen.has(skill.id)) {
      continue;
    }
    seen.add(skill.id);
    unique.push(skill);
  }
  return unique;
}

function agentMembershipsBySkillKey(skills: DesktopSkill[]) {
  const memberships = new Map<string, DesktopSkill[]>();
  for (const skill of skills) {
    const key = skillIdentityKey(skill);
    const group = memberships.get(key) ?? [];
    group.push(skill);
    memberships.set(key, group);
  }
  return memberships;
}

function relatedAgentMembershipsForSkill(skill: DesktopSkill, skills: DesktopSkill[]) {
  const identityKey = skillIdentityKey(skill);
  const nameKey = skill.name.trim().toLocaleLowerCase();
  const memberships = skills.filter((candidate) => {
    if (candidate.name.trim().toLocaleLowerCase() === nameKey) {
      return true;
    }
    return skillIdentityKey(candidate) === identityKey;
  });
  return memberships.length > 0 ? memberships : [skill];
}

function skillIdentityKey(skill: DesktopSkill) {
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

function skillWithLazySize(skill: DesktopSkill, size?: DesktopSkillSize): DesktopSkill {
  if (!size) {
    return skill;
  }
  return {
    ...skill,
    file_count: size.file_count,
    total_size_bytes: size.total_size_bytes,
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

export { isRemoteTargetSelectable, remoteTargetId };
