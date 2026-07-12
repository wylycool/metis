import { useEffect, useState, type ReactNode } from "react";
import { normalizeRemoteSyncDraft } from "./gitWebUrl";
import { textInputAssistanceProps } from "./inputAssistance";

export interface GitSourceDraft {
  url: string;
  repo_path: string;
  ref_: string;
}

type SourceHelpId = "url" | "repoPath" | "ref";

type GitSourceFieldTestIds = {
  url: string;
  repoPath: string;
  ref: string;
};

export function GitSourceFields<TDraft extends GitSourceDraft>({
  className = "",
  draft,
  fieldId,
  onChange,
  testIds,
  variant = "default",
}: {
  className?: string;
  draft: TDraft;
  fieldId: string;
  onChange: (draft: TDraft) => void;
  testIds: GitSourceFieldTestIds;
  variant?: "default" | "compact";
}) {
  const [activeSourceHelp, setActiveSourceHelp] = useState<SourceHelpId | null>(null);
  const rootClassName = [
    "git-source-fields",
    variant === "compact" ? "git-source-fields--compact" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!activeSourceHelp) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(`[data-source-help-root="${fieldId}-${activeSourceHelp}"]`)
      ) {
        return;
      }
      setActiveSourceHelp(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [activeSourceHelp, fieldId]);

  function renderSourceHelp(helpId: SourceHelpId, ariaLabel: string, content: ReactNode) {
    const isOpen = activeSourceHelp === helpId;
    const tone = helpId === "repoPath" ? "path" : helpId;

    return (
      <span
        className={`source-help source-help--${tone}`}
        data-source-help-root={`${fieldId}-${helpId}`}
        data-testid={`source-${helpId}-help-${fieldId}`}
      >
        <button
          aria-expanded={isOpen}
          aria-label={ariaLabel}
          className="source-help-button"
          onClick={() => setActiveSourceHelp((current) => (current === helpId ? null : helpId))}
          type="button"
        >
          <span aria-hidden="true">?</span>
        </button>
        {isOpen && (
          <span className="source-help-popover" role="tooltip">
            {content}
          </span>
        )}
      </span>
    );
  }

  return (
    <div className={rootClassName} data-testid={`${fieldId}-source-fields`}>
      <div className="source-field-stack">
        <div className="source-form-field">
          <div className="source-field-label-row">
            <span>Skill 页面链接</span>
            {renderSourceHelp(
              "url",
              "来源地址填写说明",
              <>
                <span className="source-help-heading">
                  <strong>复制 Skill 文件夹链接</strong>
                  <span>页面中能看到 SKILL.md 时，直接复制地址栏。</span>
                </span>
                <span className="source-help-card">
                  <span>
                    <strong>页面里有 SKILL.md</strong>
                  </span>
                  <code>https://github.com/org/repo/tree/main/skills/example</code>
                </span>
              </>,
            )}
          </div>
          <input
            aria-label="Skill 页面链接或 Git 地址"
            {...textInputAssistanceProps}
            data-testid={testIds.url}
            value={draft.url}
            placeholder="填写包含SKILL.md文件的git链接"
            onBlur={() => onChange(normalizeRemoteSyncDraft(draft))}
            onChange={(event) => onChange({ ...draft, url: event.target.value })}
          />
        </div>
        <div className="source-secondary-fields">
          <div className="source-form-field">
            <div className="source-field-label-row">
              <span>Skill 路径</span>
              {renderSourceHelp(
                "repoPath",
                "Skill 路径填写说明",
                <>
                  <span className="source-help-heading">
                    <strong>Skill 路径</strong>
                    <span>SKILL.md 在仓库里的目录路径。</span>
                  </span>
                  <span className="source-help-card">
                    <span>
                      <strong>子目录</strong>
                      <small>填写 SKILL.md 所在目录。</small>
                    </span>
                    <code>skills/example</code>
                  </span>
                  <span className="source-help-card">
                    <span>
                      <strong>根目录</strong>
                      <small>SKILL.md 在仓库根目录时留空。</small>
                    </span>
                    <code>留空</code>
                  </span>
                </>,
              )}
            </div>
            <input
              aria-label="Skill 路径"
              {...textInputAssistanceProps}
              data-testid={testIds.repoPath}
              value={draft.repo_path}
              placeholder="Skill 路径，可留空"
              onChange={(event) => onChange({ ...draft, repo_path: event.target.value })}
            />
          </div>
          <div className="source-form-field">
            <div className="source-field-label-row">
              <span>分支</span>
              {renderSourceHelp(
                "ref",
                "分支填写说明",
                <>
                  <span className="source-help-heading">
                    <strong>分支</strong>
                  </span>
                  <span className="source-help-card">
                    <span>
                      <strong>常见名称</strong>
                      <small>手动填写仓库分支名，github来源一般为main</small>
                    </span>
                    <code>main</code>
                    <code>master</code>
                  </span>
                </>,
              )}
            </div>
            <input
              aria-label="分支"
              {...textInputAssistanceProps}
              data-testid={testIds.ref}
              value={draft.ref_}
              placeholder="可选"
              onChange={(event) => onChange({ ...draft, ref_: event.target.value })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
