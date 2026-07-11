import { useEffect, useRef, useState } from "react";
import { AgentBadge } from "./AgentBadge";
import { InlineError } from "./SkillRow";
import type {
  DesktopCopyLocalSkillResult,
  DesktopError,
  DesktopInstallRemoteSkillResult,
  DesktopLocalSkillTarget,
  DesktopSkillTarget,
} from "./types";

type TargetMatrixMode = "install-or-update" | "local-copy";
type TargetMatrixTarget = DesktopSkillTarget | DesktopLocalSkillTarget;
type TargetMatrixResult = DesktopInstallRemoteSkillResult | DesktopCopyLocalSkillResult;

interface CrossAgentTargetMatrixProps<T extends TargetMatrixTarget> {
  currentAgentId: string | null;
  description?: string;
  error?: DesktopError;
  installResult?: TargetMatrixResult;
  installing?: boolean;
  loading: boolean;
  mode?: TargetMatrixMode;
  resultTargets?: T[];
  selectedTargetIds: string[];
  targets: T[];
  title: string;
  onInstall: () => void;
  onSelectAllValid?: () => void;
  onToggleTarget: (target: T) => void;
}

export function CrossAgentTargetMatrix<T extends TargetMatrixTarget>({
  currentAgentId,
  description,
  error,
  installResult,
  installing = false,
  loading,
  mode = "install-or-update",
  resultTargets,
  selectedTargetIds,
  targets,
  title,
  onInstall,
  onSelectAllValid,
  onToggleTarget,
}: CrossAgentTargetMatrixProps<T>) {
  const [installedHelpOpen, setInstalledHelpOpen] = useState(false);
  const installedHelpRef = useRef<HTMLDetailsElement | null>(null);
  const installResultRef = useRef<HTMLDivElement | null>(null);
  const copy =
    mode === "local-copy"
      ? {
          action: "安装到选中位置",
          clearAll: "一键取消选中",
          description: "复制当前本地 Skill 到选中位置，不检查远端更新。",
          empty: "所有可用路径均已安装此 skill",
          loading: "正在读取可安装路径",
          selectAll: "一键选中全部",
          selected: (count: number) => `已选 ${count} 个位置`,
        }
      : {
          action: "安装/更新选中",
          clearAll: "一键取消选中",
          description: "选择要安装或更新的位置。自定义路径会和内置 Agent 一起显示。",
          empty: "没有可用安装目标",
          loading: "正在读取 Skill",
          selectAll: "一键选中有效路径",
          selected: (count: number) => `已选 ${count} 个 Agent / 目录`,
        };
  const targetIds = new Set(targets.map(remoteTargetId));
  const selectedCount = selectedTargetIds.filter((id) => targetIds.has(id)).length;
  const selectableTargetIds = targets
    .filter((target) => isTargetSelectable(target, mode))
    .map(remoteTargetId);
  const selectableCount = selectableTargetIds.length;
  const allSelectableTargetsSelected =
    selectableCount > 0 && selectableTargetIds.every((id) => selectedTargetIds.includes(id));

  useEffect(() => {
    if (!installedHelpOpen) {
      return undefined;
    }

    function closeInstalledHelpOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && installedHelpRef.current?.contains(target)) {
        return;
      }
      setInstalledHelpOpen(false);
    }

    document.addEventListener("pointerdown", closeInstalledHelpOnOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", closeInstalledHelpOnOutsidePointerDown);
    };
  }, [installedHelpOpen]);

  useEffect(() => {
    if (mode === "local-copy" && installResult) {
      installResultRef.current?.focus();
    }
  }, [installResult, mode]);

  if (loading && targets.length === 0) {
    return (
      <section
        className="target-matrix cross-agent-matrix remote-target-loading"
        aria-label={copy.loading}
        data-testid="remote-target-loading"
        role="status"
      >
        <span className="remote-target-loading-spinner" aria-hidden="true" />
        <p className="matrix-muted">{copy.loading}</p>
      </section>
    );
  }

  return (
    <section className="target-matrix cross-agent-matrix" aria-label={title}>
      <div className="target-matrix-header">
        <div>
          <h3>{title}</h3>
          <p>{description ?? copy.description}</p>
        </div>
        <div className="target-matrix-actions">
          {onSelectAllValid && targets.length > 0 && (
            <button
              className="ghost-button compact target-matrix-select-all"
              data-testid="select-all-valid-targets"
              disabled={loading || installing || selectableCount === 0}
              onClick={onSelectAllValid}
            >
              {allSelectableTargetsSelected ? copy.clearAll : copy.selectAll}
            </button>
          )}
          {mode !== "local-copy" && targets.length > 0 && (
            <details
              className="target-installed-help target-matrix-help source-help source-help--path"
              data-testid="target-installed-help"
              onToggle={(event) => setInstalledHelpOpen(event.currentTarget.open)}
              open={installedHelpOpen}
              ref={installedHelpRef}
            >
              <summary
                aria-label="已安装覆盖说明"
                className="source-help-button target-installed-help-button"
              >
                ?
              </summary>
              <span
                className="source-help-popover target-installed-help-popover"
                data-testid="target-installed-help-popover"
                role="tooltip"
              >
                <span className="source-help-heading">
                  <strong>路径状态说明</strong>
                </span>
                <span className="source-help-card">
                  <span>
                    <strong>已安装</strong>
                    <small>
                      表示此 Agent / 目录中已有同名 Skill。勾选后，Metis 会用当前远端内容覆盖它，并在覆盖前自动备份。若不想覆盖，请不要勾选。
                    </small>
                  </span>
                </span>
              </span>
            </details>
          )}
        </div>
      </div>
      {error && <InlineError error={error} />}
      {!loading && !error && targets.length === 0 && (
        <p className="matrix-muted">{copy.empty}</p>
      )}
      {targets.length > 0 && (
        <div className="remote-target-list">
          {targets.map((target) => {
            const id = remoteTargetId(target);
            const selectable = isTargetSelectable(target, mode);
            const isCurrent = currentAgentId === target.agent_id;
            return (
              <div
                className={`remote-target-row redesign-detail-agent-path-row ${remoteTargetDetailTone(target)} ${isCurrent ? "current" : ""}`}
                data-testid={`target-row-${target.agent_id}`}
                key={id}
              >
                <input
                  className="remote-target-checkbox"
                  data-testid={`target-checkbox-${target.agent_id}`}
                  type="checkbox"
                  checked={selectedTargetIds.includes(id)}
                  disabled={loading || installing || !selectable}
                  onChange={() => onToggleTarget(target)}
                  aria-label={`选择 ${target.agent_name} ${target.install_path}`}
                />
                <AgentBadge agent={{ agent_id: target.agent_id, agent_name: target.agent_name }} />
                <span className="remote-target-agent-name" title={target.agent_name}>
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
              </div>
            );
          })}
        </div>
      )}
      {targets.length > 0 && (
        <div className="target-action-bar">
          <span>{copy.selected(selectedCount)}</span>
          <button
            className="compact target-install-button"
            data-testid="install-selected-targets"
            disabled={loading || installing || selectedCount === 0}
            onClick={onInstall}
          >
            {installing ? "正在安装…" : copy.action}
          </button>
        </div>
      )}
      {installResult && (
        <div
          aria-atomic="true"
          aria-live="polite"
          className="remote-install-result"
          data-testid="target-install-result"
          ref={installResultRef}
          role="status"
          tabIndex={-1}
        >
          {installResult.targets.map((target) => (
            <span key={`${target.agent_id}:${target.install_path}`}>
              {remoteInstallTargetName(target, resultTargets ?? targets)}：{target.status}
              {target.reason ? ` (${target.reason})` : ""}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export function remoteTargetId(target: TargetMatrixTarget) {
  return `${target.agent_id}:${target.install_path}`;
}

export function isRemoteTargetSelectable(target: DesktopSkillTarget) {
  if (target.local_modified) {
    return ["UpToDate", "UpdateAvailable", "InstalledUnbound", "InstalledBound"].includes(
      target.status,
    );
  }
  return ["NotInstalled", "InstalledUnbound", "UpdateAvailable", "InstalledBound"].includes(
    target.status,
  );
}

function remoteTargetStatusLabel(target: TargetMatrixTarget) {
  if (targetLocalModified(target)) {
    return "本地已修改";
  }
  const labels: Record<string, string> = {
    NotInstalled: "未安装",
    Installed: "已安装",
    InstalledUnbound: "可更新",
    InstalledBound: "已安装",
    UpToDate: "已最新",
    UpdateAvailable: "可更新",
    ConflictNonSkill: "冲突",
    AgentRootUnavailable: "无效路径",
  };
  return labels[target.status] ?? target.status;
}

function remoteTargetStatusTone(target: TargetMatrixTarget) {
  if (targetLocalModified(target)) {
    return "target-status-warning";
  }
  if (["Installed", "UpToDate", "InstalledBound"].includes(target.status)) {
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

function remoteTargetDetailTone(target: TargetMatrixTarget) {
  if (targetLocalModified(target)) {
    return "local-modified";
  }
  if (target.status === "UpdateAvailable") {
    return "update";
  }
  if (["Installed", "UpToDate", "InstalledBound"].includes(target.status)) {
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
  resultTarget: TargetMatrixResult["targets"][number],
  targets: TargetMatrixTarget[],
) {
  return (
    targets.find(
      (target) =>
        target.agent_id === resultTarget.agent_id &&
        target.install_path === resultTarget.install_path,
    )?.agent_name ?? agentNameFromId(resultTarget.agent_id)
  );
}

function isTargetSelectable(target: TargetMatrixTarget, mode: TargetMatrixMode) {
  return mode === "local-copy"
    ? target.status === "NotInstalled" && target.root_available
    : isRemoteTargetSelectable(target as DesktopSkillTarget);
}

function targetLocalModified(target: TargetMatrixTarget) {
  return "local_modified" in target && target.local_modified;
}
