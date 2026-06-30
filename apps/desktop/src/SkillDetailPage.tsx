import { CrossAgentTargetMatrix } from "./CrossAgentTargetMatrix";
import {
  BackupPanel,
  BindSourceForm,
  DiffPanel,
  InlineError,
  StatusBadge,
  localModifiedLabel,
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
  const installedPathRows = installedSkillPathRows(skill, detailTargets);

  return (
    <section className="skill-panel skill-detail-page" data-testid={`skill-detail-${skill.id}`}>
      <button className="breadcrumb-button" onClick={onBack}>
        <span aria-hidden="true">←</span>
        <span>返回</span>
      </button>

      <header
        className="skill-detail-card skill-intro-card"
        data-testid={`skill-intro-card-${skill.id}`}
      >
        <div
          className="skill-intro-heading"
          data-testid={`skill-detail-reference-summary-${skill.id}`}
        >
          <div className="skill-intro-facts">
            <div className="skill-intro-fact">
              <span className="skill-intro-label">Name</span>
              <strong className="skill-intro-name">{skill.name}</strong>
            </div>
            <div className="skill-intro-fact">
              <span className="skill-intro-label">Description</span>
              <p className="skill-intro-copy">{skill.description || "暂无描述"}</p>
            </div>
            <div className="skill-intro-fact">
              <span className="skill-intro-label">Source</span>
              {source ? (
                <div className="skill-source-summary">
                  <code>{source.url}</code>
                  <span>{source.repo_path}</span>
                  <em>{source.ref_ || "main"}</em>
                </div>
              ) : (
                <p className="skill-intro-copy">暂无来源</p>
              )}
            </div>
            <div className="skill-intro-fact">
              <span className="skill-intro-label">Paths</span>
              <div className="skill-installed-paths">
                {installedPathRows.map((row) => (
                  <div className="skill-installed-path" key={`${row.agent_id}:${row.install_path}`}>
                    <span>{row.agent_name}</span>
                    <code>{row.install_path}</code>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="intro-source-corner">
          <button
            className={`source-chip-button ${source ? "bound" : "unbound"}`}
            data-testid={`open-bind-source-${skill.id}`}
            onClick={onOpenBind}
          >
            <span aria-hidden="true" />
            {source ? "编辑来源" : "添加来源"}
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

      <div className="skill-detail-grid">
        <section
          className="skill-detail-card local-operations-card"
          data-testid={`skill-operations-card-${skill.id}`}
        >
          <div className="detail-card-heading">
            <div>
              <p className="detail-kicker">Operations</p>
              <h3>检查和更新</h3>
            </div>
          </div>

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

          <div className="detail-action-row local-action-row">
            <button
              className="operation-button compact"
              data-testid={`check-updates-${skill.id}`}
              disabled={!source || checkBusy}
              onClick={onCheck}
            >
              {checkBusy ? "检查中" : "检查更新"}
            </button>
            <button
              className="operation-button compact"
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
              className="operation-button compact"
              data-testid={`toggle-backups-${skill.id}`}
              disabled={!source || backupBusy}
              onClick={onToggleBackups}
            >
              {backupBusy ? "读取备份" : backupOpen ? "隐藏备份" : "备份/回滚"}
            </button>
          </div>

          {diffError && <InlineError error={diffError} />}
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
        <div className="source-drawer-backdrop" role="presentation" onClick={onCancelBind}>
          <aside
            aria-label="修改来源信息"
            className="source-drawer"
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

      {source && (
        <CrossAgentTargetMatrix
          currentAgentId={skill.agent_id}
          error={detailTargetError}
          installResult={detailInstallResult}
          loading={actionBusy === `detail-targets:${skill.id}`}
          selectedTargetIds={selectedDetailTargetIds}
          targets={detailTargets}
          title="跨 Agent 安装状态"
          onInstall={onInstallDetailTargets}
          onRefresh={onRefreshDetailTargets}
          onToggleTarget={onToggleDetailTarget}
        />
      )}
    </section>
  );
}

function installedSkillPathRows(skill: DesktopSkill, targets: DesktopSkillTarget[]) {
  const installedTargets = targets.filter((target) => isInstalledSkillTarget(target));
  const rows =
    installedTargets.length > 0
      ? installedTargets.map((target) => ({
          agent_id: target.agent_id,
          agent_name: target.agent_name,
          install_path: target.install_path,
        }))
      : [
          {
            agent_id: skill.agent_id,
            agent_name: skill.agent_name,
            install_path: skill.install_path,
          },
        ];

  return rows.filter(
    (row, index, list) =>
      list.findIndex((item) => item.agent_id === row.agent_id && item.install_path === row.install_path) === index,
  );
}

function isInstalledSkillTarget(target: DesktopSkillTarget) {
  if (target.skill_id) {
    return true;
  }
  return ["InstalledBound", "InstalledUnbound", "UpToDate", "UpdateAvailable"].includes(
    target.status,
  );
}
