import { CrossAgentTargetMatrix } from "./CrossAgentTargetMatrix";
import { GitSourceFields } from "./GitSourceFields";
import { InlineError } from "./SkillRow";
import type { CSSProperties } from "react";
import type {
  DesktopError,
  DesktopInstallRemoteSkillResult,
  DesktopRemoteSkillPreview,
  DesktopSkillTarget,
} from "./types";

export interface RemoteSyncDraft {
  url: string;
  repo_path: string;
  ref_: string;
}

export function AddSkillPage({
  actionBusy,
  draft,
  installResult,
  preview,
  previewError,
  selectedTargetIds,
  targets,
  onBack,
  onDraftChange,
  onInstallTargets,
  onPreview,
  onReset,
  onSelectAllValidTargets,
  onToggleTarget,
}: {
  actionBusy: string | null;
  draft: RemoteSyncDraft;
  installResult: DesktopInstallRemoteSkillResult | null;
  preview: DesktopRemoteSkillPreview | null;
  previewError: DesktopError | null;
  selectedTargetIds: string[];
  targets: DesktopSkillTarget[];
  onBack: () => void;
  onDraftChange: (draft: RemoteSyncDraft) => void;
  onInstallTargets: () => void;
  onPreview: () => void;
  onReset: () => void;
  onSelectAllValidTargets: () => void;
  onToggleTarget: (target: DesktopSkillTarget) => void;
}) {
  return (
    <section className="skill-panel add-skill-page" data-testid="add-skill-page">
      <button className="breadcrumb-button" onClick={onBack}>
        <span aria-hidden="true">←</span>
        <span>返回</span>
      </button>
      <section className="remote-sync-panel add-skill-source-card" aria-label="添加 Skill">
        <div className="remote-sync-header">
          <div>
            <h2>Skill 来源信息</h2>
            <p>填写 Git URL、Skill 路径和分支名，填好后可以点击预览查看确认后，再选择安装</p>
          </div>
          <div className="remote-sync-actions">
            <button
              className="compact add-skill-reset-button"
              data-testid="add-skill-reset"
              onClick={onReset}
            >
              重置
            </button>
            <button
              className="compact add-skill-preview-button"
              data-testid="add-skill-preview"
              disabled={actionBusy === "remote-sync-preview" || draft.url.trim().length === 0}
              onClick={onPreview}
            >
              {actionBusy === "remote-sync-preview" ? "预览中" : "预览Skill"}
            </button>
          </div>
        </div>
        <GitSourceFields
          draft={draft}
          fieldId="add-skill"
          testIds={{
            url: "add-skill-url",
            repoPath: "add-skill-repo-path",
            ref: "add-skill-ref",
          }}
          onChange={onDraftChange}
          variant="compact"
        />
        {previewError && <InlineError error={previewError} />}
        {preview && (
          <>
            <div className="remote-preview-card" style={remotePreviewAccentStyle(preview)}>
              <div className="remote-preview-copy">
                <strong>{preview.name}</strong>
                <span>{preview.description ?? "无描述"}</span>
              </div>
            </div>
            <div
              className="remote-preview-success-hint"
              data-testid="remote-preview-success-hint"
              role="status"
            >
              <span aria-hidden="true">✓</span>
              <strong>已成功获取Skill。确认信息无误后，在下方完成安装。</strong>
            </div>
          </>
        )}
        {(preview || targets.length > 0 || actionBusy === "remote-sync-preview") && (
          <CrossAgentTargetMatrix
            currentAgentId={null}
            installResult={installResult ?? undefined}
            loading={actionBusy === "remote-sync-preview"}
            selectedTargetIds={selectedTargetIds}
            targets={targets}
            title="安装到以下 Agent / 目录"
            onInstall={onInstallTargets}
            onSelectAllValid={onSelectAllValidTargets}
            onToggleTarget={onToggleTarget}
          />
        )}
      </section>
    </section>
  );
}

function remotePreviewAccentStyle(preview: DesktopRemoteSkillPreview): CSSProperties {
  const palette = [
    ["#496ee8", "#7f5be8"],
    ["#f06498", "#c94f7d"],
    ["#2db8a0", "#159a86"],
    ["#f0ad47", "#d98225"],
    ["#4c9fdb", "#2f75bf"],
    ["#41bf80", "#1e9667"],
    ["#6f72e8", "#4f46c8"],
    ["#e35d6a", "#b9465a"],
    ["#21a6c8", "#167da0"],
    ["#c47a2c", "#9a5f1f"],
    ["#8f5bd8", "#6843b8"],
    ["#22a66f", "#157a58"],
    ["#d95f9f", "#a84b86"],
    ["#5b8be8", "#3466c8"],
    ["#7aa33a", "#587d2b"],
    ["#5f6f86", "#405166"],
  ];
  const index = Math.abs(hashText(`${preview.name}:${preview.repo_path}`)) % palette.length;
  return {
    "--redesign-accent-start": palette[index][0],
    "--redesign-accent-end": palette[index][1],
  } as CSSProperties;
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}
