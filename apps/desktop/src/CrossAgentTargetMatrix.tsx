import { AgentBadge } from "./AgentBadge";
import { InlineError } from "./SkillRow";
import type {
  DesktopError,
  DesktopInstallRemoteSkillResult,
  DesktopSkillTarget,
} from "./types";

export function CrossAgentTargetMatrix({
  currentAgentId,
  error,
  installResult,
  loading,
  selectedTargetIds,
  targets,
  title,
  onInstall,
  onSelectAllValid,
  onToggleTarget,
}: {
  currentAgentId: string | null;
  error?: DesktopError;
  installResult?: DesktopInstallRemoteSkillResult;
  loading: boolean;
  selectedTargetIds: string[];
  targets: DesktopSkillTarget[];
  title: string;
  onInstall: () => void;
  onSelectAllValid?: () => void;
  onToggleTarget: (target: DesktopSkillTarget) => void;
}) {
  const selectedCount = selectedTargetIds.length;
  const selectableTargetIds = targets.filter(isRemoteTargetSelectable).map(remoteTargetId);
  const selectableCount = selectableTargetIds.length;
  const allSelectableTargetsSelected =
    selectableCount > 0 && selectableTargetIds.every((id) => selectedTargetIds.includes(id));

  return (
    <section className="target-matrix cross-agent-matrix" aria-label={title}>
      <div className="target-matrix-header">
        <div>
          <h3>{title}</h3>
          <p>选择要安装或更新的位置。自定义路径会和内置 Agent 一起显示。</p>
        </div>
        <div className="target-matrix-actions">
          {onSelectAllValid && targets.length > 0 && (
            <button
              className="ghost-button compact target-matrix-select-all"
              data-testid="select-all-valid-targets"
              disabled={loading || selectableCount === 0}
              onClick={onSelectAllValid}
            >
              {allSelectableTargetsSelected ? "一键取消选中" : "一键选中有效路径"}
            </button>
          )}
        </div>
      </div>
      {error && <InlineError error={error} />}
      {loading && targets.length === 0 && (
        <p className="matrix-muted">正在读取远端 Git，并计算可安装的 Agent / 目录</p>
      )}
      {!loading && !error && targets.length === 0 && (
        <p className="matrix-muted">没有可用安装目标</p>
      )}
      {targets.length > 0 && (
        <div className="remote-target-list">
          {targets.map((target) => {
            const id = remoteTargetId(target);
            const selectable = isRemoteTargetSelectable(target);
            const isCurrent = currentAgentId === target.agent_id;
            return (
              <label
                className={`remote-target-row redesign-detail-agent-path-row ${remoteTargetDetailTone(target)} ${isCurrent ? "current" : ""}`}
                data-testid={`target-row-${target.agent_id}`}
                key={id}
              >
                <input
                  className="remote-target-checkbox"
                  data-testid={`target-checkbox-${target.agent_id}`}
                  type="checkbox"
                  checked={selectedTargetIds.includes(id)}
                  disabled={!selectable}
                  onChange={() => onToggleTarget(target)}
                />
                <AgentBadge agent={{ agent_id: target.agent_id, agent_name: target.agent_name }} />
                <span className="remote-target-agent-name">
                  {target.agent_name}
                  {isCurrent && <em>当前查看</em>}
                </span>
                <code>{target.install_path}</code>
                <b
                  className={`target-status-badge ${remoteTargetStatusTone(target)}`}
                  data-testid={`target-status-${target.agent_id}`}
                >
                  {remoteTargetStatusLabel(target)}
                </b>
              </label>
            );
          })}
        </div>
      )}
      {targets.length > 0 && (
        <div className="target-action-bar">
          <span>已选 {selectedCount} 个 Agent / 目录</span>
          <button
            className="compact target-install-button"
            data-testid="install-selected-targets"
            disabled={loading || selectedCount === 0}
            onClick={onInstall}
          >
            安装/更新选中
          </button>
        </div>
      )}
      {installResult && (
        <div className="remote-install-result">
          {installResult.targets.map((target) => (
            <span key={`${target.agent_id}:${target.install_path}`}>
              {remoteInstallTargetName(target, targets)}：{target.status}
              {target.reason ? ` (${target.reason})` : ""}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export function remoteTargetId(target: DesktopSkillTarget) {
  return `${target.agent_id}:${target.install_path}`;
}

export function isRemoteTargetSelectable(target: DesktopSkillTarget) {
  if (target.local_modified) {
    return ["UpToDate", "UpdateAvailable", "InstalledUnbound"].includes(target.status);
  }
  return ["NotInstalled", "InstalledUnbound", "UpdateAvailable"].includes(target.status);
}

function remoteTargetStatusLabel(target: DesktopSkillTarget) {
  if (target.local_modified) {
    return "本地已修改";
  }
  const labels: Record<string, string> = {
    NotInstalled: "未安装",
    InstalledUnbound: "可绑定并更新",
    InstalledBound: "已绑定",
    UpToDate: "最新",
    UpdateAvailable: "可更新",
    ConflictNonSkill: "冲突",
    AgentRootUnavailable: "不可用",
  };
  return labels[target.status] ?? target.status;
}

function remoteTargetStatusTone(target: DesktopSkillTarget) {
  if (target.local_modified) {
    return "target-status-warning";
  }
  if (["UpToDate", "InstalledBound"].includes(target.status)) {
    return "target-status-good";
  }
  if (["UpdateAvailable", "InstalledUnbound"].includes(target.status)) {
    return "target-status-warning";
  }
  if (["ConflictNonSkill", "AgentRootUnavailable"].includes(target.status)) {
    return "target-status-danger";
  }
  return "target-status-muted";
}

function remoteTargetDetailTone(target: DesktopSkillTarget) {
  if (target.local_modified) {
    return "local-modified";
  }
  if (target.status === "UpdateAvailable") {
    return "update";
  }
  if (["UpToDate", "InstalledBound"].includes(target.status)) {
    return "latest";
  }
  if (["ConflictNonSkill", "AgentRootUnavailable"].includes(target.status)) {
    return "failed";
  }
  if (target.status === "InstalledUnbound") {
    return "no-source";
  }
  return "unknown";
}

function agentNameFromId(agentId: string) {
  const names: Record<string, string> = {
    codex: "Codex",
    "claude-code": "Claude Code",
    openclaw: "OpenClaw",
    hermes: "Hermes",
    opencode: "opencode",
    generic: "Generic Agent Skills",
  };
  return names[agentId] ?? agentId;
}

function remoteInstallTargetName(
  resultTarget: DesktopInstallRemoteSkillResult["targets"][number],
  targets: DesktopSkillTarget[],
) {
  return (
    targets.find(
      (target) =>
        target.agent_id === resultTarget.agent_id &&
        target.install_path === resultTarget.install_path,
    )?.agent_name ?? agentNameFromId(resultTarget.agent_id)
  );
}
