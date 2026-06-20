import { CrossAgentTargetMatrix } from "./CrossAgentTargetMatrix";
import { SkillRow, type BindDraft } from "./SkillRow";
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
  onApplyUpdate,
  onBack,
  onBind,
  onCancelBind,
  onCheck,
  onDraftChange,
  onInstallDetailTargets,
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
  onApplyUpdate: () => void;
  onBack: () => void;
  onBind: () => void;
  onCancelBind: () => void;
  onCheck: () => void;
  onDraftChange: (draft: BindDraft) => void;
  onInstallDetailTargets: () => void;
  onOpenBind: () => void;
  onRestoreBackup: (backupId: string) => void;
  onToggleBackups: () => void;
  onToggleDetailTarget: (target: DesktopSkillTarget) => void;
  onToggleDiff: () => void;
  onUnbind: () => void;
  onRefreshDetailTargets: () => void;
}) {
  return (
    <section className="skill-panel skill-detail-page" data-testid={`skill-detail-${skill.id}`}>
      <button className="breadcrumb-button" onClick={onBack}>
        <span aria-hidden="true">←</span>
        <span>Skills / {skill.name}</span>
      </button>
      <SkillRow
        skill={skill}
        updateResult={updateResult}
        diffDetail={diffDetail}
        diffError={diffError}
        backups={backups}
        backupOpen={backupOpen}
        backupError={backupError}
        isBinding={isBinding}
        bindDraft={bindDraft}
        busyKey={actionBusy}
        onOpenBind={onOpenBind}
        onCancelBind={onCancelBind}
        onDraftChange={onDraftChange}
        onBind={onBind}
        onUnbind={onUnbind}
        onCheck={onCheck}
        onToggleDiff={onToggleDiff}
        onApplyUpdate={onApplyUpdate}
        onToggleBackups={onToggleBackups}
        onRestoreBackup={onRestoreBackup}
      />
      {skill.source && (
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
