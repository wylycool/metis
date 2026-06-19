import { useEffect, useMemo, useRef, useState } from "react";
import {
  applySkillUpdate,
  bindSkillSource,
  checkSkillUpdates,
  getSkillDiff,
  getDesktopSettings,
  listSkillBackups,
  listAgents,
  listIndexedSkills,
  restoreSkillBackup,
  saveDesktopSettings,
  scanSkills,
  unbindSkillSource,
} from "./api";
import type {
  DesktopAgentStatus,
  DesktopBackupSummary,
  DesktopDiffDetail,
  DesktopScanWarning,
  DesktopSettings,
  DesktopSkill,
  DesktopUpdateCheckResult,
  LoadState,
} from "./types";

interface BindDraft {
  url: string;
  repo_path: string;
  ref_: string;
  credential_ref: string;
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
  const [backupPanels, setBackupPanels] = useState<Record<string, boolean>>({});
  const [backups, setBackups] = useState<Record<string, DesktopBackupSummary[]>>({});
  const [backupError, setBackupError] = useState<Record<string, string>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<DesktopSettings>({ custom_scan_paths: [] });
  const [settingsDraft, setSettingsDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      const settingsResult = await getDesktopSettings();
      setAgents(agentResult);
      setSettings(settingsResult);
      setSettingsDraft(settingsResult.custom_scan_paths.join("\n"));

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
    setActionMessage(null);

    try {
      const [agentResult, scanResult] = await Promise.all([listAgents(), scanSkills()]);
      setAgents(agentResult);
      setSkills(scanResult.skills);
      setWarnings(scanResult.warnings);
      setUpdateResults({});
      setDiffDetails({});
      setDiffError({});
      setBackups({});
      setBackupPanels({});
      setBackupError({});
      setState("loaded");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("error");
    }
  }

  async function handleSaveSettings(scanAfterSave: boolean) {
    setActionBusy("settings");
    setActionError(null);
    setActionMessage(null);

    try {
      const saved = await saveDesktopSettings({
        custom_scan_paths: settingsDraft.split("\n"),
      });
      setSettings(saved);
      setSettingsDraft(saved.custom_scan_paths.join("\n"));
      setActionMessage("扫描路径已保存");
      if (scanAfterSave) {
        await handleScan();
      } else {
        setAgents(await listAgents());
      }
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setActionBusy(null);
    }
  }

  function removeCustomPath(path: string) {
    const nextPaths = settings.custom_scan_paths.filter((item) => item !== path);
    const nextDraft = nextPaths.join("\n");
    setSettings({ custom_scan_paths: nextPaths });
    setSettingsDraft(nextDraft);
  }

  function openBindForm(skill: DesktopSkill) {
    setBindingSkillId(skill.id);
    setActionError(null);
    setBindDraft({
      url: skill.source?.url ?? "",
      repo_path: skill.source?.repo_path ?? "",
      ref_: skill.source?.ref_ ?? "main",
      credential_ref: skill.source?.credential_ref ?? "",
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
    setActionMessage(null);

    try {
      await bindSkillSource({
        skill_id: skillId,
        url: bindDraft.url.trim(),
        repo_path: bindDraft.repo_path.trim(),
        ref_: bindDraft.ref_.trim() || "main",
        credential_ref: bindDraft.credential_ref.trim() || null,
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
      setBackups((current) => {
        const next = { ...current };
        delete next[skillId];
        return next;
      });
      setBackupPanels((current) => {
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
    setActionMessage(null);

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
      setBackups((current) => {
        const next = { ...current };
        delete next[skillId];
        return next;
      });
      setBackupPanels((current) => {
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
    setActionMessage(null);

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
    setActionMessage(null);
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

  async function loadBackups(skillId: string) {
    setActionBusy(`backups:${skillId}`);
    setActionError(null);
    setBackupError((current) => {
      const next = { ...current };
      delete next[skillId];
      return next;
    });

    try {
      const result = await listSkillBackups(skillId);
      setBackups((current) => ({ ...current, [skillId]: result }));
    } catch (caught) {
      setBackupError((current) => ({ ...current, [skillId]: errorMessage(caught) }));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleToggleBackups(skillId: string) {
    if (backupPanels[skillId]) {
      setBackupPanels((current) => ({ ...current, [skillId]: false }));
      return;
    }

    setBackupPanels((current) => ({ ...current, [skillId]: true }));
    await loadBackups(skillId);
  }

  async function handleApplyUpdate(skillId: string) {
    setActionBusy(`apply:${skillId}`);
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await applySkillUpdate(skillId);
      setActionMessage(
        `更新完成：${shortCommit(result.previous_commit)} -> ${shortCommit(
          result.new_commit,
        )}，已创建备份 ${result.backup_id}`,
      );
      clearSkillRuntimeState(skillId);
      setBackupPanels((current) => ({ ...current, [skillId]: true }));
      await refreshIndexedSkills();
      await loadBackups(skillId);
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleRestoreBackup(skillId: string, backupId: string) {
    setActionBusy(`restore:${backupId}`);
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await restoreSkillBackup({ skill_id: skillId, backup_id: backupId });
      setActionMessage(
        `已回滚到 ${result.restored_from_backup_id}，回滚前状态已备份为 ${result.previous_state_backup_id}`,
      );
      clearSkillRuntimeState(skillId);
      setBackupPanels((current) => ({ ...current, [skillId]: true }));
      await refreshIndexedSkills();
      await loadBackups(skillId);
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setActionBusy(null);
    }
  }

  function clearSkillRuntimeState(skillId: string) {
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

      <section className="settings-panel" aria-label="设置">
        <button
          className="ghost-button settings-toggle"
          onClick={() => setSettingsOpen((current) => !current)}
        >
          {settingsOpen ? "收起设置" : "设置"}
        </button>
        <div className="settings-summary">
          <span>{settings.custom_scan_paths.length || "默认"} 个扫描路径</span>
          <span>凭据使用本机 Git / SSH 配置</span>
        </div>
        {settingsOpen && (
          <div className="settings-editor">
            <div className="settings-section">
              <div>
                <h3>扫描路径</h3>
                <p>每行一个额外 Generic Agent Skills 根目录。</p>
              </div>
              <div className="custom-path-chips">
                {settings.custom_scan_paths.length === 0 ? (
                  <span>默认路径</span>
                ) : (
                  settings.custom_scan_paths.map((path) => <code key={path}>{path}</code>)
                )}
              </div>
              <textarea
                value={settingsDraft}
                placeholder="/Users/me/.agent-skills-extra"
                onChange={(event) => setSettingsDraft(event.target.value)}
              />
              {settings.custom_scan_paths.length > 0 && (
                <div className="path-remove-list">
                  {settings.custom_scan_paths.map((path) => (
                    <button
                      className="ghost-button compact"
                      key={path}
                      onClick={() => removeCustomPath(path)}
                    >
                      移除 {shortPath(path)}
                    </button>
                  ))}
                </div>
              )}
              <div className="form-actions">
                <button
                  className="ghost-button compact"
                  disabled={actionBusy === "settings"}
                  onClick={() => handleSaveSettings(false)}
                >
                  {actionBusy === "settings" ? "保存中" : "保存"}
                </button>
                <button
                  className="compact"
                  disabled={actionBusy === "settings" || state === "loading"}
                  onClick={() => handleSaveSettings(true)}
                >
                  保存并扫描
                </button>
              </div>
            </div>
            <div className="settings-section credential-section">
              <div>
                <h3>凭据引用</h3>
                <p>在来源绑定中填写引用名，Metis 只保存名称；真实认证由本机 Git、SSH agent 或 Git credential helper 处理。</p>
              </div>
              <div className="credential-note">
                <code>github-main</code>
                <code>work-gitlab</code>
              </div>
            </div>
          </div>
        )}
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
          {actionMessage && <div className="inline-success">{actionMessage}</div>}

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
                  backups={backups[skill.id] ?? []}
                  backupOpen={backupPanels[skill.id] ?? false}
                  backupError={backupError[skill.id]}
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
                  onApplyUpdate={() => handleApplyUpdate(skill.id)}
                  onToggleBackups={() => handleToggleBackups(skill.id)}
                  onRestoreBackup={(backupId) => handleRestoreBackup(skill.id, backupId)}
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
  backups,
  backupOpen,
  backupError,
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
  onApplyUpdate,
  onToggleBackups,
  onRestoreBackup,
}: {
  skill: DesktopSkill;
  updateResult?: DesktopUpdateCheckResult;
  diffDetail?: DesktopDiffDetail;
  diffError?: string;
  backups: DesktopBackupSummary[];
  backupOpen: boolean;
  backupError?: string;
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
  onApplyUpdate: () => void;
  onToggleBackups: () => void;
  onRestoreBackup: (backupId: string) => void;
}) {
  const bindingBusy = busyKey === `bind:${skill.id}`;
  const unbindingBusy = busyKey === `unbind:${skill.id}`;
  const checkingBusy = busyKey === "check-updates";
  const diffBusy = busyKey === `diff:${skill.id}`;
  const applyBusy = busyKey === `apply:${skill.id}`;
  const backupsBusy = busyKey === `backups:${skill.id}`;
  const canShowDiff = updateResult?.status === "UpdateAvailable";
  const canApplyUpdate = canShowDiff && !updateResult?.local_modified;

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
              {skill.source.credential_ref && <small>{skill.source.credential_ref}</small>}
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
            {canShowDiff && (
              <button
                className="compact"
                disabled={applyBusy || !canApplyUpdate}
                onClick={onApplyUpdate}
              >
                {applyBusy ? "更新中" : "应用更新"}
              </button>
            )}
            <button className="ghost-button compact" disabled={backupsBusy} onClick={onToggleBackups}>
              {backupsBusy ? "加载中" : backupOpen ? "收起备份" : "备份/回滚"}
            </button>
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
      {backupError && <div className="inline-error">{backupError}</div>}
      {backupOpen && (
        <BackupPanel
          backups={backups}
          busyKey={busyKey}
          onRestoreBackup={onRestoreBackup}
        />
      )}

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

function BackupPanel({
  backups,
  busyKey,
  onRestoreBackup,
}: {
  backups: DesktopBackupSummary[];
  busyKey: string | null;
  onRestoreBackup: (backupId: string) => void;
}) {
  return (
    <div className="backup-panel">
      <div className="backup-heading">
        <strong>备份</strong>
        <span>{backups.length} items</span>
      </div>
      {backups.length === 0 ? (
        <p className="empty-backups">暂无备份。应用更新或手动备份后会出现在这里。</p>
      ) : (
        <div className="backup-list">
          {backups.map((backup) => {
            const restoring = busyKey === `restore:${backup.backup_id}`;
            return (
              <article className="backup-row" key={backup.backup_id}>
                <div>
                  <strong>{backup.reason}</strong>
                  <span>{backup.created_at || "unknown time"}</span>
                  <code>{backup.backup_id}</code>
                </div>
                <div className="backup-meta">
                  {backup.source_commit && <span>{shortCommit(backup.source_commit)}</span>}
                  <span>{backup.file_count} files</span>
                  <span>{formatBytes(backup.total_size_bytes)}</span>
                </div>
                <button
                  className="danger-button compact"
                  disabled={restoring}
                  onClick={() => onRestoreBackup(backup.backup_id)}
                >
                  {restoring ? "回滚中" : "回滚"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
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
      <label>
        <span>Credential Ref</span>
        <input
          value={draft.credential_ref}
          placeholder="github-main"
          onChange={(event) => onChange({ ...draft, credential_ref: event.target.value })}
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
    credential_ref: "",
    trusted: false,
    auto_update: false,
  };
}

function shortCommit(commit: string) {
  return commit.length > 10 ? commit.slice(0, 10) : commit;
}

function shortPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return path;
  }
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
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
