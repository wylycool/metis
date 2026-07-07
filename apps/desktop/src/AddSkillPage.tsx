import { CrossAgentTargetMatrix } from "./CrossAgentTargetMatrix";
import { shortCommit } from "./commitDisplay";
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
  onSelectAllValidTargets: () => void;
  onToggleTarget: (target: DesktopSkillTarget) => void;
}) {
  return (
    <section className="skill-panel add-skill-page" data-testid="add-skill-page">
      <button className="breadcrumb-button" onClick={onBack}>
        <span aria-hidden="true">←</span>
        <span>Skills / 添加 Skill</span>
      </button>
      <section className="remote-sync-panel add-skill-source-card" aria-label="添加 Skill">
        <div className="remote-sync-header">
          <div>
            <h2>Skill 来源信息</h2>
            <p>填写 Git URL、Skill 路径和分支名，填好后可以点击预览查看确认后，再选择安装</p>
          </div>
          <button
            className="compact"
            data-testid="add-skill-preview"
            disabled={actionBusy === "remote-sync-preview" || draft.url.trim().length === 0}
            onClick={onPreview}
          >
            {actionBusy === "remote-sync-preview" ? "预览中" : "预览远端"}
          </button>
        </div>
        <div className="remote-sync-form">
          <input
            data-testid="add-skill-url"
            value={draft.url}
            placeholder="https://github.com/example/metis-skills.git"
            onChange={(event) => onDraftChange({ ...draft, url: event.target.value })}
          />
          <input
            data-testid="add-skill-repo-path"
            value={draft.repo_path}
            placeholder="skills/example"
            onChange={(event) => onDraftChange({ ...draft, repo_path: event.target.value })}
          />
          <input
            data-testid="add-skill-ref"
            value={draft.ref_}
            placeholder="main"
            onChange={(event) => onDraftChange({ ...draft, ref_: event.target.value })}
          />
        </div>
        {previewError && <InlineError error={previewError} />}
        {preview && (
          <div className="remote-preview-card" style={remotePreviewAccentStyle(preview)}>
            <div className="remote-preview-copy">
              <strong>{preview.name}</strong>
              <span>{preview.description ?? "无描述"}</span>
            </div>
            <div className="remote-preview-version">
              <span className="remote-preview-version-label">远端版本</span>
              <code>{shortCommit(preview.commit)}</code>
            </div>
          </div>
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
            onRefresh={onPreview}
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
