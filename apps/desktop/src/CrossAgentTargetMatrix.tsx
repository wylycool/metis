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
  onRefresh,
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
  onRefresh: () => void;
  onToggleTarget: (target: DesktopSkillTarget) => void;
}) {
  const selectedCount = selectedTargetIds.length;

  return (
    <section className="target-matrix cross-agent-matrix" aria-label={title}>
      <div className="target-matrix-header">
        <div>
          <h3>{title}</h3>
          <p>同一远端 source 在各 Agent 根目录下的安装与更新状态。</p>
        </div>
        <button
          aria-busy={loading}
          className="ghost-button compact"
          data-testid="refresh-target-matrix"
          disabled={loading}
          onClick={onRefresh}
        >
          {loading && <span className="target-matrix-spinner" data-testid="target-matrix-spinner" />}
          {loading ? "检查中" : "重新检查状态"}
        </button>
      </div>
      {error && <InlineError error={error} />}
      {loading && targets.length === 0 && <p className="matrix-muted">正在检查跨 Agent 状态</p>}
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
                className={`remote-target-row ${isCurrent ? "current" : ""}`}
                data-testid={`target-row-${target.agent_id}`}
                key={id}
              >
                <input
                  data-testid={`target-checkbox-${target.agent_id}`}
                  type="checkbox"
                  checked={selectedTargetIds.includes(id)}
                  disabled={!selectable}
                  onChange={() => onToggleTarget(target)}
                />
                <span>
                  <strong>
                    {target.agent_name}
                    {isCurrent && <em>当前查看</em>}
                  </strong>
                  <small>{target.install_path}</small>
                </span>
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
          <span>已选 {selectedCount} 个 Agent</span>
          <button
            className="compact"
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
              {agentNameFromId(target.agent_id)}：{target.status}
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

function isRemoteTargetSelectable(target: DesktopSkillTarget) {
  if (target.status === "UpdateAvailable") {
    return target.local_modified !== true;
  }
  return ["NotInstalled", "InstalledUnbound"].includes(target.status);
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
