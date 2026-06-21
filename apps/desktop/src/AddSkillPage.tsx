import { CrossAgentTargetMatrix } from "./CrossAgentTargetMatrix";
import type {
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
  selectedTargetIds,
  targets,
  onBack,
  onDraftChange,
  onInstallTargets,
  onPreview,
  onToggleTarget,
}: {
  actionBusy: string | null;
  draft: RemoteSyncDraft;
  installResult: DesktopInstallRemoteSkillResult | null;
  preview: DesktopRemoteSkillPreview | null;
  selectedTargetIds: string[];
  targets: DesktopSkillTarget[];
  onBack: () => void;
  onDraftChange: (draft: RemoteSyncDraft) => void;
  onInstallTargets: () => void;
  onPreview: () => void;
  onToggleTarget: (target: DesktopSkillTarget) => void;
}) {
  return (
    <section className="skill-panel add-skill-page" data-testid="add-skill-page">
      <button className="breadcrumb-button" onClick={onBack}>
        <span aria-hidden="true">←</span>
        <span>Skills / 添加 Skill</span>
      </button>
      <section className="skill-detail-header add-skill-header">
        <div>
          <span className="status-kicker">Remote source</span>
          <h2>添加 Skill</h2>
          <p>预览远端 Git skill，然后安装或更新到选中的本机 Agent。</p>
        </div>
        <button
          className="compact"
          data-testid="add-skill-preview"
          disabled={actionBusy === "remote-sync-preview" || draft.url.trim().length === 0}
          onClick={onPreview}
        >
          {actionBusy === "remote-sync-preview" ? "预览中" : "预览远端"}
        </button>
      </section>
      <section className="remote-sync-panel" aria-label="添加 Skill">
        <div className="remote-sync-header">
          <div>
            <h3>远端信息</h3>
            <p>填写仓库 URL、Skill 目录和 ref，先预览再选择安装目标。</p>
          </div>
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
        {preview && (
          <div className="remote-preview-card">
            <div>
              <strong>{preview.name}</strong>
              <span>{preview.description ?? "无描述"}</span>
            </div>
            <code>{shortCommit(preview.commit)}</code>
          </div>
        )}
        {(preview || targets.length > 0 || actionBusy === "remote-sync-preview") && (
          <CrossAgentTargetMatrix
            currentAgentId={null}
            installResult={installResult ?? undefined}
            loading={actionBusy === "remote-sync-preview"}
            selectedTargetIds={selectedTargetIds}
            targets={targets}
            title="安装目标"
            onInstall={onInstallTargets}
            onRefresh={onPreview}
            onToggleTarget={onToggleTarget}
          />
        )}
      </section>
    </section>
  );
}

function shortCommit(commit: string) {
  return commit.length > 10 ? commit.slice(0, 10) : commit;
}
