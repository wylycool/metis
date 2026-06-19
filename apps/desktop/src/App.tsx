import { useEffect, useMemo, useRef, useState } from "react";
import {
  bindSkillSource,
  checkSkillUpdates,
  getSkillDiff,
  listAgents,
  listIndexedSkills,
  scanSkills,
  unbindSkillSource,
} from "./api";
import type {
  DesktopAgentStatus,
  DesktopDiffDetail,
  DesktopScanWarning,
  DesktopSkill,
  DesktopUpdateCheckResult,
  LoadState,
} from "./types";

interface BindDraft {
  url: string;
  repo_path: string;
  ref_: string;
  trusted: boolean;
  auto_update: boolean;
}

function App() {
  const [agents, setAgents] = useState<DesktopAgentStatus[]>([]);
  const [skills, setSkills] = useState<DesktopSkill[]>([]);
  const [warnings, setWarnings] = useState<DesktopScanWarning[]>([]);
  const [updateResults, setUpdateResults] = useState<Record<string, DesktopUpdateCheckResult>>({});
  const [diffDetails, setDiffDetails] = useState<Record<string, DesktopDiffDetail>>({});
  const [diffError, setDiffError] = useState<Record<string, string>>({});
  const [bindingSkillId, setBindingSkillId] = useState<string | null>(null);
  const [bindDraft, setBindDraft] = useState<BindDraft>(emptyBindDraft());
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const didBootstrap = useRef(false);

  const groupedSkills = useMemo(() => {
    return agents.map((agent) => ({
      ...agent,
      skills: skills.filter((skill) => skill.agent_id === agent.agent_id),
    }));
  }, [agents, skills]);

  const totalExistingPaths = agents.reduce(
    (count, agent) => count + agent.paths.filter((path) => path.exists).length,
    0,
  );
  const modifiedCount = skills.filter((skill) => skill.local_modified).length;
  const boundCount = skills.filter((skill) => skill.source).length;

  useEffect(() => {
    if (didBootstrap.current) {
      return;
    }
    didBootstrap.current = true;
    void bootstrap();
  }, []);

  async function bootstrap() {
    setState("loading");
    setError(null);

    try {
      const [agentResult, indexedResult] = await Promise.all([
        listAgents(),
        listIndexedSkills(),
      ]);
      setAgents(agentResult);

      if (indexedResult.length > 0) {
        setSkills(indexedResult);
        setWarnings([]);
        setState("loaded");
        return;
      }

      const scanResult = await scanSkills();
      setSkills(scanResult.skills);
      setWarnings(scanResult.warnings);
      setState("loaded");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("error");
    }
  }

  async function handleScan() {
    setState("loading");
    setError(null);
    setActionError(null);

    try {
      const [agentResult, scanResult] = await Promise.all([listAgents(), scanSkills()]);
      setAgents(agentResult);
      setSkills(scanResult.skills);
      setWarnings(scanResult.warnings);
      setUpdateResults({});
      setDiffDetails({});
      setDiffError({});
      setState("loaded");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("error");
    }
  }

  function openBindForm(skill: DesktopSkill) {
    setBindingSkillId(skill.id);
    setActionError(null);
    setBindDraft({
      url: skill.source?.url ?? "",
      repo_path: skill.source?.repo_path ?? "",
      ref_: skill.source?.ref_ ?? "main",
      trusted: skill.source?.trusted ?? false,
      auto_update: skill.source?.auto_update ?? false,
    });
  }

  async function refreshIndexedSkills() {
    const indexed = await listIndexedSkills();
    setSkills(indexed);
  }

  async function handleBindSource(skillId: string) {
    setActionBusy(`bind:${skillId}`);
    setActionError(null);

    try {
      await bindSkillSource({
        skill_id: skillId,
        url: bindDraft.url.trim(),
        repo_path: bindDraft.repo_path.trim(),
        ref_: bindDraft.ref_.trim() || "main",
        trusted: bindDraft.trusted,
        auto_update: bindDraft.auto_update,
      });
      await refreshIndexedSkills();
      setBindingSkillId(null);
      setBindDraft(emptyBindDraft());
      setUpdateResults((current) => {
        const next = { ...current };
        delete next[skillId];
        return next;
      });
      setDiffDetails((current) => {
        const next = { ...current };
        delete next[skillId];
        return next;
      });
      setDiffError((current) => {
        const next = { ...current };
        delete next[skillId];
        return next;
      });
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleUnbindSource(skillId: string) {
    setActionBusy(`unbind:${skillId}`);
    setActionError(null);

    try {
      await unbindSkillSource(skillId);
      await refreshIndexedSkills();
      setUpdateResults((current) => {
        const next = { ...current };
        delete next[skillId];
        return next;
      });
      setDiffDetails((current) => {
        const next = { ...current };
        delete next[skillId];
        return next;
      });
      setDiffError((current) => {
        const next = { ...current };
        delete next[skillId];
        return next;
      });
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleCheckUpdates(skillIds: string[]) {
    if (skillIds.length === 0) {
      return;
    }

    setActionBusy("check-updates");
    setActionError(null);

    try {
      const results = await checkSkillUpdates({ skill_ids: skillIds });
      setUpdateResults((current) => {
        const next = { ...current };
        for (const result of results) {
          next[result.skill_id] = result;
        }
        return next;
      });
      setDiffError({});
      await refreshIndexedSkills();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleToggleDiff(skillId: string) {
    if (diffDetails[skillId]) {
      setDiffDetails((current) => {
        const next = { ...current };
        delete next[skillId];
        return next;
      });
      return;
    }

    setActionBusy(`diff:${skillId}`);
    setActionError(null);
    setDiffError((current) => {
      const next = { ...current };
      delete next[skillId];
      return next;
    });

    try {
      const detail = await getSkillDiff(skillId);
      setDiffDetails((current) => ({ ...current, [skillId]: detail }));
    } catch (caught) {
      setDiffError((current) => ({ ...current, [skillId]: errorMessage(caught) }));
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Metis Desktop MVP</p>
          <h1>本机 Skills</h1>
        </div>
        <div className="topbar-actions">
          <button
            className="ghost-button"
            disabled={state === "loading" || actionBusy === "check-updates" || skills.length === 0}
            onClick={() => handleCheckUpdates(skills.map((skill) => skill.id))}
          >
            {actionBusy === "check-updates" ? "检查中" : "检查更新"}
          </button>
          <button className="scan-button" disabled={state === "loading"} onClick={handleScan}>
            {state === "loading" ? "扫描中" : "重新扫描"}
          </button>
        </div>
      </header>

      <section className="summary-strip" aria-label="扫描摘要">
        <SummaryMetric label="已发现 skills" value={skills.length.toString()} />
        <SummaryMetric label="已绑定来源" value={boundCount.toString()} />
        <SummaryMetric label="存在的路径" value={totalExistingPaths.toString()} />
        <SummaryMetric label="本地修改" value={modifiedCount.toString()} />
      </section>

      <main className="workspace">
        <aside className="agent-rail" aria-label="Agent 分组">
          <div className="rail-heading">
            <span>Agent</span>
            <strong>{agents.length}</strong>
          </div>
          <div className="agent-list">
            {groupedSkills.map((agent) => (
              <div className="agent-row" key={agent.agent_id}>
                <div>
                  <strong>{agent.agent_name}</strong>
                  <span>{agent.agent_id}</span>
                </div>
                <b>{agent.skills.length}</b>
              </div>
            ))}
          </div>
        </aside>

        <section className="skill-panel">
          <div className="panel-heading">
            <div>
              <h2>Skill 索引</h2>
              <p>{statusText(state, skills.length)}</p>
            </div>
            {warnings.length > 0 && (
              <span className="warning-pill">{warnings.length} 条 warning</span>
            )}
          </div>

          {actionError && <div className="inline-error">{actionError}</div>}

          {state === "loading" && <LoadingState />}
          {state === "error" && <ErrorState message={error} onRetry={handleScan} />}
          {state === "loaded" && skills.length === 0 && <EmptyState onScan={handleScan} />}
          {state === "loaded" && skills.length > 0 && (
            <div className="skill-list">
              {skills.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  updateResult={updateResults[skill.id]}
                  diffDetail={diffDetails[skill.id]}
                  diffError={diffError[skill.id]}
                  isBinding={bindingSkillId === skill.id}
                  bindDraft={bindDraft}
                  busyKey={actionBusy}
                  onOpenBind={() => openBindForm(skill)}
                  onCancelBind={() => setBindingSkillId(null)}
                  onDraftChange={setBindDraft}
                  onBind={() => handleBindSource(skill.id)}
                  onUnbind={() => handleUnbindSource(skill.id)}
                  onCheck={() => handleCheckUpdates([skill.id])}
                  onToggleDiff={() => handleToggleDiff(skill.id)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {warnings.length > 0 && (
        <section className="warning-panel" aria-label="扫描警告">
          <h2>扫描警告</h2>
          {warnings.map((warning) => (
            <div className="warning-row" key={`${warning.agent_id}-${warning.path}-${warning.message}`}>
              <strong>{warning.agent_id}</strong>
              <span>{warning.message}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SkillRow({
  skill,
  updateResult,
  diffDetail,
  diffError,
  isBinding,
  bindDraft,
  busyKey,
  onOpenBind,
  onCancelBind,
  onDraftChange,
  onBind,
  onUnbind,
  onCheck,
  onToggleDiff,
}: {
  skill: DesktopSkill;
  updateResult?: DesktopUpdateCheckResult;
  diffDetail?: DesktopDiffDetail;
  diffError?: string;
  isBinding: boolean;
  bindDraft: BindDraft;
  busyKey: string | null;
  onOpenBind: () => void;
  onCancelBind: () => void;
  onDraftChange: (draft: BindDraft) => void;
  onBind: () => void;
  onUnbind: () => void;
  onCheck: () => void;
  onToggleDiff: () => void;
}) {
  const bindingBusy = busyKey === `bind:${skill.id}`;
  const unbindingBusy = busyKey === `unbind:${skill.id}`;
  const checkingBusy = busyKey === "check-updates";
  const diffBusy = busyKey === `diff:${skill.id}`;
  const canShowDiff = updateResult?.status === "UpdateAvailable";

  return (
    <article className="skill-row">
      <div className="skill-row-main">
        <div className="skill-main">
          <div className="skill-title">
            <h3>{skill.name}</h3>
            <span>{skill.agent_name}</span>
          </div>
          {skill.description && <p>{skill.description}</p>}
          <code>{skill.install_path}</code>
          {skill.source && (
            <div className="source-line">
              <strong>{skill.source.ref_}</strong>
              <span>{skill.source.url}</span>
              <em>{skill.source.repo_path}</em>
            </div>
          )}
        </div>

        <div className="skill-status">
          <StatusBadge tone={metadataTone(skill.metadata_status)}>
            metadata: {metadataLabel(skill.metadata_status)}
          </StatusBadge>
          <StatusBadge tone={skill.local_modified ? "danger" : "muted"}>
            {localModifiedLabel(skill.local_modified)}
          </StatusBadge>
          <StatusBadge tone={updateTone(updateResult, skill)}>
            {updateLabel(updateResult, skill)}
          </StatusBadge>
        </div>
      </div>

      {updateResult?.diff_summary && (
        <div className="update-summary">
          <span>+{updateResult.diff_summary.files_added}</span>
          <span>~{updateResult.diff_summary.files_modified}</span>
          <span>-{updateResult.diff_summary.files_deleted}</span>
          {updateResult.commits_behind !== null && updateResult.commits_behind !== undefined && (
            <strong>{updateResult.commits_behind} commits behind</strong>
          )}
        </div>
      )}

      <div className="skill-actions">
        {skill.source ? (
          <>
            <button className="ghost-button compact" disabled={checkingBusy} onClick={onCheck}>
              {checkingBusy ? "检查中" : "检查更新"}
            </button>
            {canShowDiff && (
              <button className="ghost-button compact" disabled={diffBusy} onClick={onToggleDiff}>
                {diffBusy ? "加载中" : diffDetail ? "收起 diff" : "查看 diff"}
              </button>
            )}
            <button className="ghost-button compact" onClick={onOpenBind}>
              编辑来源
            </button>
            <button
              className="danger-button compact"
              disabled={unbindingBusy}
              onClick={onUnbind}
            >
              {unbindingBusy ? "解绑中" : "解绑"}
            </button>
          </>
        ) : (
          <button className="ghost-button compact" onClick={onOpenBind}>
            绑定来源
          </button>
        )}
      </div>

      {diffError && <div className="inline-error">{diffError}</div>}
      {diffDetail && <DiffPanel detail={diffDetail} />}

      {isBinding && (
        <BindSourceForm
          draft={bindDraft}
          busy={bindingBusy}
          onChange={onDraftChange}
          onCancel={onCancelBind}
          onSubmit={onBind}
        />
      )}
    </article>
  );
}

function DiffPanel({ detail }: { detail: DesktopDiffDetail }) {
  return (
    <div className="diff-panel">
      <div className="diff-heading">
        <span>{shortCommit(detail.current_commit)}</span>
        <strong>→</strong>
        <span>{shortCommit(detail.target_commit)}</span>
        <b>{detail.files.length} files</b>
      </div>
      <div className="diff-file-list">
        {detail.files.map((file) => (
          <article className="diff-file" key={`${file.status}-${file.old_path ?? ""}-${file.path}`}>
            <div className="diff-file-heading">
              <StatusBadge tone={file.status === "Deleted" ? "danger" : "muted"}>
                {file.status}
              </StatusBadge>
              <code>{file.old_path ? `${file.old_path} → ${file.path}` : file.path}</code>
            </div>
            {file.patch ? (
              <pre>{file.patch}</pre>
            ) : (
              <p className="no-patch">这个文件没有可展示的 patch 文本。</p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function BindSourceForm({
  draft,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: BindDraft;
  busy: boolean;
  onChange: (draft: BindDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const disabled = busy || !draft.url.trim() || !draft.repo_path.trim();

  return (
    <div className="source-form">
      <label>
        <span>Git URL</span>
        <input
          value={draft.url}
          placeholder="https://github.com/org/repo.git"
          onChange={(event) => onChange({ ...draft, url: event.target.value })}
        />
      </label>
      <label>
        <span>Repo Path</span>
        <input
          value={draft.repo_path}
          placeholder="skills/example"
          onChange={(event) => onChange({ ...draft, repo_path: event.target.value })}
        />
      </label>
      <label>
        <span>Ref</span>
        <input
          value={draft.ref_}
          placeholder="main"
          onChange={(event) => onChange({ ...draft, ref_: event.target.value })}
        />
      </label>
      <label className="check-label">
        <input
          checked={draft.trusted}
          type="checkbox"
          onChange={(event) => onChange({ ...draft, trusted: event.target.checked })}
        />
        <span>Trusted</span>
      </label>
      <label className="check-label">
        <input
          checked={draft.auto_update}
          type="checkbox"
          onChange={(event) => onChange({ ...draft, auto_update: event.target.checked })}
        />
        <span>Auto update</span>
      </label>
      <div className="form-actions">
        <button className="ghost-button compact" onClick={onCancel}>
          取消
        </button>
        <button className="compact" disabled={disabled} onClick={onSubmit}>
          {busy ? "保存中" : "保存来源"}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "good" | "danger" | "muted";
}) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

function LoadingState() {
  return (
    <div className="state-block">
      <div className="loader" />
      <p>正在读取本地索引并扫描默认 skill 目录</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="state-block error-state">
      <h3>扫描失败</h3>
      <p>{message ?? "未知错误"}</p>
      <button onClick={onRetry}>重试扫描</button>
    </div>
  );
}

function EmptyState({ onScan }: { onScan: () => void }) {
  return (
    <div className="state-block">
      <h3>还没有发现 skills</h3>
      <p>默认目录中暂时没有可索引的 `SKILL.md`。</p>
      <button onClick={onScan}>重新扫描</button>
    </div>
  );
}

function statusText(state: LoadState, count: number) {
  if (state === "loading") {
    return "正在同步 Core discovery 与 SQLite 索引";
  }
  if (state === "error") {
    return "请查看错误信息后重试";
  }
  if (count === 0) {
    return "默认目录暂无已发现 skill";
  }
  return "来自本机 SQLite 索引和最新扫描结果";
}

function metadataTone(status: string) {
  return status === "found" ? "good" : "danger";
}

function metadataLabel(status: string) {
  if (status === "found") {
    return "found";
  }
  if (status === "parse_error") {
    return "parse error";
  }
  return status;
}

function localModifiedLabel(value: boolean | null | undefined) {
  if (value === true) {
    return "本地已修改";
  }
  if (value === false) {
    return "未发现修改";
  }
  return "未检测修改";
}

function updateTone(
  result: DesktopUpdateCheckResult | undefined,
  skill: DesktopSkill,
): "good" | "danger" | "muted" {
  if (result?.local_modified || result?.status === "CheckFailed") {
    return "danger";
  }
  if (result?.status === "UpToDate") {
    return "good";
  }
  if (result?.status === "UpdateAvailable") {
    return "danger";
  }
  if (!skill.source) {
    return "muted";
  }
  return "muted";
}

function updateLabel(result: DesktopUpdateCheckResult | undefined, skill: DesktopSkill) {
  if (result?.local_modified) {
    return "本地修改，先处理";
  }
  if (result?.status === "UpToDate") {
    return "已最新";
  }
  if (result?.status === "UpdateAvailable") {
    return "有更新";
  }
  if (result?.status === "CheckFailed") {
    return `检查失败${result.failure_reason ? `: ${result.failure_reason}` : ""}`;
  }
  if (result?.status === "NoSource" || !skill.source) {
    return "未绑定来源";
  }
  return "未检查更新";
}

function emptyBindDraft(): BindDraft {
  return {
    url: "",
    repo_path: "",
    ref_: "main",
    trusted: false,
    auto_update: false,
  };
}

function shortCommit(commit: string) {
  return commit.length > 10 ? commit.slice(0, 10) : commit;
}

function errorMessage(caught: unknown) {
  if (caught instanceof Error) {
    return caught.message;
  }
  if (typeof caught === "string") {
    return caught;
  }
  return "桌面后端返回了无法识别的错误";
}

export default App;
