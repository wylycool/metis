import { useCallback, useEffect, useRef, useState } from "react";
import {
  applySkillUpdate,
  bindSkillSource,
  checkSkillUpdates,
  getSkillDiff,
  getSkillSize,
  getDesktopSettings,
  getSkillTargetsForSource,
  installRemoteSkillToTargets,
  listSkillAuditEvents,
  listSkillBackups,
  listAgents,
  listIndexedSkills,
  openExternalUrl,
  previewRemoteSkillSource,
  restoreSkillBackup,
  saveDesktopSettings,
  scanSkills,
  testGitEnvironment,
  testSourceConnection,
  unbindSkillSource,
} from "./api";
import type { RemoteSyncDraft } from "./AddSkillPage";
import { shortCommit } from "./commitDisplay";
import { CrystalSkillLogo } from "./CrystalSkillLogo";
import { GitHubIcon } from "./GitHubIcon";
import { METIS_GITHUB_URL } from "./projectLinks";
import { remoteTargetId, SkillsWorkspace } from "./SkillsWorkspace";
import { InlineError, type BindDraft } from "./SkillRow";
import { UiRedesignPreview } from "./UiRedesignPreview";
import type {
  DesktopAgentStatus,
  DesktopApplyUpdateResult,
  DesktopAuditEvent,
  DesktopBackupSummary,
  DesktopDiffDetail,
  DesktopError,
  DesktopGitEnvironmentTestResult,
  DesktopInstallRemoteSkillResult,
  DesktopRemoteSkillPreview,
  DesktopScanWarning,
  DesktopSettings,
  DesktopSkill,
  DesktopSkillSize,
  DesktopSource,
  DesktopSourceConnectionTestResult,
  DesktopSkillTarget,
  DesktopCustomMonitoredPath,
  DesktopUpdateCheckResult,
  LoadState,
} from "./types";

type WorkspaceKey = "skills" | "settings";
type SkillsViewKind = "list" | "detail" | "add";

function App() {
  if (isUiRedesignPreviewRoute()) {
    return <UiRedesignPreview />;
  }

  return <MetisApp />;
}

function MetisApp() {
  const [agents, setAgents] = useState<DesktopAgentStatus[]>([]);
  const [skills, setSkills] = useState<DesktopSkill[]>([]);
  const [warnings, setWarnings] = useState<DesktopScanWarning[]>([]);
  const [updateResults, setUpdateResults] = useState<Record<string, DesktopUpdateCheckResult>>({});
  const [diffDetails, setDiffDetails] = useState<Record<string, DesktopDiffDetail>>({});
  const [diffError, setDiffError] = useState<Record<string, DesktopError>>({});
  const [skillSizes, setSkillSizes] = useState<Record<string, DesktopSkillSize>>({});
  const [skillAuditEvents, setSkillAuditEvents] = useState<Record<string, DesktopAuditEvent[]>>({});
  const [backupPanels, setBackupPanels] = useState<Record<string, boolean>>({});
  const [backups, setBackups] = useState<Record<string, DesktopBackupSummary[]>>({});
  const [backupError, setBackupError] = useState<Record<string, DesktopError>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [sourceRequiredSkillId, setSourceRequiredSkillId] = useState<string | null>(null);
  const [, setSettings] = useState<DesktopSettings>({
    custom_scan_paths: [],
    agent_path_overrides: [],
    custom_monitored_paths: [],
    team_policy_path: null,
    enterprise_network: emptyEnterpriseNetworkSettings(),
  });
  const [agentPathOverrideDrafts, setAgentPathOverrideDrafts] = useState<Record<string, string>>({});
  const [customMonitorDrafts, setCustomMonitorDrafts] = useState<DesktopCustomMonitoredPath[]>([]);
  const [newCustomMonitorName, setNewCustomMonitorName] = useState("");
  const [newCustomMonitorPath, setNewCustomMonitorPath] = useState("");
  const [bindingSkillId, setBindingSkillId] = useState<string | null>(null);
  const [bindDraft, setBindDraft] = useState<BindDraft>(emptyBindDraft());
  const [sourceConnectionResults, setSourceConnectionResults] = useState<
    Record<string, DesktopSourceConnectionTestResult>
  >({});
  const [sourceConnectionErrors, setSourceConnectionErrors] = useState<Record<string, DesktopError>>(
    {},
  );
  const [gitEnvironmentResult, setGitEnvironmentResult] =
    useState<DesktopGitEnvironmentTestResult | null>(null);
  const [gitEnvironmentError, setGitEnvironmentError] = useState<DesktopError | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<DesktopError | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<DesktopError | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceKey>("skills");
  const [skillsViewKind, setSkillsViewKind] = useState<SkillsViewKind>("list");
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [remoteSyncDraft, setRemoteSyncDraft] = useState<RemoteSyncDraft>({
    url: "",
    repo_path: "",
    ref_: "main",
  });
  const [remotePreview, setRemotePreview] = useState<DesktopRemoteSkillPreview | null>(null);
  const [remoteTargets, setRemoteTargets] = useState<DesktopSkillTarget[]>([]);
  const [selectedRemoteTargetIds, setSelectedRemoteTargetIds] = useState<string[]>([]);
  const [remoteInstallResult, setRemoteInstallResult] =
    useState<DesktopInstallRemoteSkillResult | null>(null);
  const builtinPathHealth = builtinPathHealthForAgents(agents);
  const customPathHealth = pathHealthForAgents(agents, "custom");
  const autoUpdateSourceSkills = skills.filter(
    (skill) => skill.source?.trusted && skill.source.auto_update,
  );
  const trustedAutoUpdateSkills = autoUpdateSourceSkills.filter(
    (skill) => skill.local_modified !== true,
  );
  const sourceRequiredSkill = sourceRequiredSkillId
    ? skills.find((skill) => skill.id === sourceRequiredSkillId) ?? null
    : null;
  const autoUpdateUnavailable = isAutoUpdateUnavailableMessage(actionMessage);
  const guidanceToastVisible = Boolean(sourceRequiredSkill || autoUpdateUnavailable);
  const didBootstrap = useRef(false);
  const skillSizesRef = useRef<Record<string, DesktopSkillSize>>({});

  useEffect(() => {
    if (didBootstrap.current) {
      return;
    }
    didBootstrap.current = true;
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!actionMessage) {
      setSourceRequiredSkillId(null);
      return;
    }
    const toastTimer = window.setTimeout(() => {
      setActionMessage(null);
    }, guidanceToastVisible ? 6000 : 3000);
    return () => window.clearTimeout(toastTimer);
  }, [actionMessage, guidanceToastVisible]);

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
      syncPathSettingsDrafts(settingsResult);

      if (indexedResult.length > 0 && !hasMissingLocalUpdatedAt(indexedResult)) {
        setSkills(indexedResult);
        setWarnings([]);
        setState("loaded");
        return;
      }

      const scanResult = await scanSkills();
      setSkills(scanResult.skills);
      setWarnings(scanResult.warnings);
      setState("loaded");
      setActionMessage("已重新扫描本机 skill 路径");
    } catch (caught) {
      setError(desktopError(caught));
      setState("error");
    }
  }

  function hasMissingLocalUpdatedAt(indexedSkills: DesktopSkill[]) {
    return indexedSkills.some((skill) => skill.local_updated_at === null);
  }

  function settingsRequestFromDrafts(): DesktopSettings {
    const nextCustomMonitors = [...customMonitorDrafts];
    if (newCustomMonitorName.trim() && newCustomMonitorPath.trim()) {
      nextCustomMonitors.push({
        id: customMonitorId(newCustomMonitorName, nextCustomMonitors.length),
        name: newCustomMonitorName,
        path: newCustomMonitorPath,
      });
    }
    return {
      custom_scan_paths: [],
      agent_path_overrides: Object.entries(agentPathOverrideDrafts).map(([agent_id, path]) => ({
        agent_id,
        path,
      })),
      custom_monitored_paths: nextCustomMonitors,
      team_policy_path: null,
      enterprise_network: emptyEnterpriseNetworkSettings(),
    };
  }

  function syncPathSettingsDrafts(nextSettings: DesktopSettings) {
    const overrides = Object.fromEntries(
      (nextSettings.agent_path_overrides ?? []).map((overridePath) => [
        overridePath.agent_id,
        overridePath.path,
      ]),
    );
    setAgentPathOverrideDrafts(overrides);
    setCustomMonitorDrafts(nextSettings.custom_monitored_paths ?? []);
    setNewCustomMonitorName("");
    setNewCustomMonitorPath("");
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
      setUpdateResults((current) => retainUpdateResultsForSkills(current, scanResult.skills));
      setDiffDetails({});
      setDiffError({});
      skillSizesRef.current = {};
      setSkillSizes({});
      setBackups({});
      setBackupPanels({});
      setBackupError({});
      setState("loaded");
    } catch (caught) {
      setError(desktopError(caught));
      setState("error");
    }
  }

  async function handleSaveSettings(scanAfterSave: boolean) {
    setActionError(null);
    setActionMessage(null);
    const nextSettings = settingsRequestFromDrafts();
    const validationError = validateSettingsDraft(nextSettings);
    if (validationError) {
      setActionError(validationError);
      return;
    }

    setActionBusy("settings");

    try {
      const saved = await saveDesktopSettings(nextSettings);
      setSettings(saved);
      syncPathSettingsDrafts(saved);
      setActionMessage("设置已保存");
      if (scanAfterSave) {
        await handleScan();
        setActionMessage("设置已保存");
      } else {
        setAgents(await listAgents());
      }
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  function validateSettingsDraft(nextSettings: DesktopSettings): DesktopError | null {
    const builtinAgentNames = new Set(
      settingsAgentRows
        .filter((row) => !row.agent_id.startsWith("custom-") && row.agent_id !== "generic")
        .map((row) => normalizeSettingsIdentity(row.agent_name)),
    );
    const builtinPaths = new Set(
      settingsAgentRows
        .filter((row) => !row.agent_id.startsWith("custom-") && row.agent_id !== "generic")
        .map((row) => normalizeSettingsPath(agentPathOverrideDrafts[row.agent_id] ?? row.path))
        .filter(Boolean),
    );
    const seenCustomNames = new Set<string>();
    const seenCustomPaths = new Set<string>();

    for (const customPath of nextSettings.custom_monitored_paths ?? []) {
      const name = normalizeSettingsIdentity(customPath.name);
      const path = normalizeSettingsPath(customPath.path);
      if (!name || !path) {
        continue;
      }
      if (builtinAgentNames.has(name)) {
        return settingsValidationError(
          "自定义路径名称不能和内置 Agent 重复",
          "换一个不会和 Codex、Claude Code、OpenClaw 等内置 Agent 混淆的名称。",
        );
      }
      if (seenCustomNames.has(name)) {
        return settingsValidationError(
          "自定义路径名称不能重复",
          "每个自定义路径需要使用不同的名称，方便在列表和详情页区分。",
        );
      }
      if (builtinPaths.has(path) || seenCustomPaths.has(path)) {
        return settingsValidationError(
          "自定义路径不能和已有路径重复",
          "请填写一个没有被内置 Agent 或其他自定义路径使用过的目录。",
        );
      }
      seenCustomNames.add(name);
      seenCustomPaths.add(path);
    }

    return null;
  }

  function handleAgentPathDraftChange(agentId: string, defaultPath: string, nextPath: string) {
    setAgentPathOverrideDrafts((current) => {
      const next = { ...current };
      if (nextPath.trim() === defaultPath.trim()) {
        delete next[agentId];
      } else {
        next[agentId] = nextPath;
      }
      return next;
    });
  }

  function removeCustomMonitor(id: string) {
    setCustomMonitorDrafts((current) => current.filter((path) => path.id !== id));
  }

  function customMonitorId(name: string, index: number) {
    const slug = name
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug ? `${slug}-${index + 1}` : `monitor-${index + 1}`;
  }

  function openBindForm(skill: DesktopSkill) {
    const source = skill.source ?? reusableSourceForSkill(skill);
    setBindingSkillId(skill.id);
    setActionError(null);
    clearSourceConnectionState(skill.id);
    setBindDraft({
      url: source?.url ?? "",
      repo_path: source?.repo_path ?? "",
      ref_: source?.ref_ ?? "main",
      credential_ref: source?.credential_ref ?? "",
      trusted: source?.trusted ?? false,
      auto_update: source?.auto_update ?? false,
    });
  }

  function handleBindDraftChange(draft: BindDraft) {
    setBindDraft(draft);
    if (bindingSkillId) {
      clearSourceConnectionState(bindingSkillId);
    }
  }

  function clearSourceConnectionState(skillId: string) {
    setSourceConnectionResults((current) => {
      const next = { ...current };
      delete next[skillId];
      return next;
    });
    setSourceConnectionErrors((current) => {
      const next = { ...current };
      delete next[skillId];
      return next;
    });
  }

  async function handleTestSourceConnection(skillId: string) {
    setActionBusy(`test-source:${skillId}`);
    setActionError(null);
    clearSourceConnectionState(skillId);

    const repoPath = bindDraft.repo_path.trim() || ".";
    const ref = bindDraft.ref_.trim() || "main";
    const candidates = gitUrlTestCandidates(bindDraft.url.trim());
    let lastError: DesktopError | null = null;

    try {
      for (const candidate of candidates) {
        try {
          const result = await testSourceConnection({
            url: candidate.url,
            repo_path: repoPath,
            ref_: ref,
          });
          if (!candidate.isOriginal) {
            setBindDraft((current) => ({ ...current, url: candidate.url }));
          }
          setSourceConnectionResults((current) => ({
            ...current,
            [skillId]: {
              ...result,
              message: candidate.isOriginal
                ? result.message
                : `已自动切换为可访问的 ${candidate.label} 地址，可以保存来源。`,
            },
          }));
          return;
        } catch (caught) {
          lastError = desktopError(caught);
        }
      }

      const displayError = lastError ?? unknownDesktopError("测试连接失败");
      setSourceConnectionErrors((current) => ({
        ...current,
        [skillId]:
          candidates.length > 1
            ? withDerivedGitUrlSuggestion(displayError)
            : displayError,
      }));
    } finally {
      setActionBusy(null);
    }
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
        repo_path: bindDraft.repo_path.trim() || ".",
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
      setActionError(desktopError(caught));
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
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleCheckUpdates(skillIds: string[], busyKey = "check-updates") {
    if (skillIds.length === 0) {
      return;
    }

    setActionBusy(busyKey);
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
      const updateCount = results.filter((result) => result.status === "UpdateAvailable").length;
      setActionMessage(`检查完成：${updateCount} 个 skill 待更新`);
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleCheckDetailUpdates(detailSkills: DesktopSkill[]) {
    if (detailSkills.length === 0) {
      return;
    }
    setActionBusy("check-updates");
    setActionError(null);
    setActionMessage(null);

    try {
      const readySkills: DesktopSkill[] = [];
      for (const detailSkill of detailSkills) {
        readySkills.push(await ensureReusableSourceBound(detailSkill));
      }
      const checkableSkills = readySkills.filter((readySkill) =>
        Boolean(readySkill.source_id || readySkill.source),
      );
      if (checkableSkills.length === 0) {
        setSourceRequiredSkillId(detailSkills[0].id);
        setActionMessage("需要先绑定来源");
        return;
      }
      const results = await checkSkillUpdates({
        skill_ids: checkableSkills.map((readySkill) => readySkill.id),
      });
      setUpdateResults((current) => {
        const next = { ...current };
        for (const result of results) {
          next[result.skill_id] = result;
        }
        return next;
      });
      setDiffError({});
      const updateCount = results.filter(
        (result) => result.status === "UpdateAvailable" && !result.local_modified,
      ).length;
      setActionMessage(`检查完成：${updateCount} 个 Agent 需要更新`);
      await Promise.all(checkableSkills.map((readySkill) => loadSkillAuditEvents(readySkill.id)));
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handlePreviewRemoteSync() {
    setActionBusy("remote-sync-preview");
    setActionError(null);
    setActionMessage(null);
    setRemotePreview(null);
    setRemoteTargets([]);
    setSelectedRemoteTargetIds([]);
    setRemoteInstallResult(null);

    try {
      const preview = await previewRemoteSkillSource({
        url: remoteSyncDraft.url.trim(),
        repo_path: remoteSyncDraft.repo_path.trim(),
        ref_: remoteSyncDraft.ref_.trim() || "main",
      });
      const targets = await getSkillTargetsForSource({
        url: remoteSyncDraft.url.trim(),
        repo_path: preview.repo_path === "." ? "" : preview.repo_path,
        ref_: remoteSyncDraft.ref_.trim() || "main",
        commit: preview.commit,
        install_name: preview.install_name,
      });
      setRemotePreview(preview);
      setRemoteTargets(targets);
      setSelectedRemoteTargetIds([]);
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  function toggleRemoteTarget(target: DesktopSkillTarget) {
    const id = remoteTargetId(target);
    setSelectedRemoteTargetIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function handleInstallRemoteTargets() {
    if (!remotePreview) {
      return;
    }
    const selectedTargets = remoteTargets.filter((target) =>
      selectedRemoteTargetIds.includes(remoteTargetId(target)),
    );
    if (selectedTargets.length === 0) {
      return;
    }

    setActionBusy("remote-sync-install");
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await installRemoteSkillToTargets({
        url: remoteSyncDraft.url.trim(),
        repo_path: remotePreview.repo_path === "." ? "" : remotePreview.repo_path,
        ref_: remoteSyncDraft.ref_.trim() || "main",
        commit: remotePreview.commit,
        install_name: remotePreview.install_name,
        targets: selectedTargets.map((target) => ({
          agent_id: target.agent_id,
          agent_name: target.agent_name,
          install_path: target.install_path,
        })),
      });
      setRemoteInstallResult(result);
      setActionMessage("跨 Agent 同步已完成");
      await refreshIndexedSkills();
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleRunAutoUpdate() {
    setActionBusy("auto-update");
    setActionError(null);
    setActionMessage(null);

    try {
      const candidateIds = trustedAutoUpdateSkills.map((skill) => skill.id);
      const skippedByPolicy = skills.filter(
        (skill) =>
          skill.source?.auto_update &&
          (!skill.source.trusted || skill.local_modified === true),
      ).length;

      if (candidateIds.length === 0) {
        setActionMessage(autoUpdateUnavailableMessage(skills));
        return;
      }

      const results = await checkSkillUpdates({ skill_ids: candidateIds });
      setUpdateResults((current) => {
        const next = { ...current };
        for (const result of results) {
          next[result.skill_id] = result;
        }
        return next;
      });

      let applied = 0;
      let failed = 0;
      const appliedSkillIds: string[] = [];
      for (const result of results) {
        if (result.status !== "UpdateAvailable" || result.local_modified) {
          continue;
        }
        try {
          const appliedResult = await applySkillUpdate(result.skill_id);
          applied += 1;
          appliedSkillIds.push(result.skill_id);
          markSkillUpToDate(appliedResult);
          clearSkillDetailArtifacts(result.skill_id);
        } catch {
          failed += 1;
        }
      }

      await refreshIndexedSkills();
      await Promise.all(appliedSkillIds.map((skillId) => loadSkillSize(skillId, { force: true })));
      const skipped =
        skippedByPolicy +
        results.filter((result) => result.status !== "UpdateAvailable" || result.local_modified)
          .length;
      const failureText = failed > 0 ? `，失败 ${failed} 个` : "";
      setActionMessage(`自动更新完成：已更新 ${applied} 个，跳过 ${skipped} 个${failureText}`);
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleTestGitEnvironment() {
    setActionBusy("git-environment");
    setActionError(null);
    setGitEnvironmentResult(null);
    setGitEnvironmentError(null);

    try {
      const result = await testGitEnvironment();
      setGitEnvironmentResult(result);
    } catch (caught) {
      setGitEnvironmentError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleRemoveAutoUpdateSkill(skill: DesktopSkill) {
    if (!skill.source) {
      return;
    }
    const confirmed = window.confirm(
      `确定将「${skill.name}」移出自动更新列表吗？移除后不会再自动更新这个 Skill。`,
    );
    if (!confirmed) {
      return;
    }

    setActionBusy(`remove-auto-update:${skill.id}`);
    setActionError(null);
    setActionMessage(null);

    try {
      await bindSkillSource({
        skill_id: skill.id,
        url: skill.source.url,
        repo_path: skill.source.repo_path,
        ref_: skill.source.ref_,
        credential_ref: skill.source.credential_ref ?? null,
        trusted: false,
        auto_update: false,
      });
      await refreshIndexedSkills();
      setActionMessage("已移出自动更新列表");
    } catch (caught) {
      setActionError(desktopError(caught));
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
      setDiffError((current) => ({ ...current, [skillId]: desktopError(caught) }));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleToggleDetailDiff(
    skill: DesktopSkill,
    updateResult?: DesktopUpdateCheckResult,
  ) {
    if (diffDetails[skill.id]) {
      setDiffDetails((current) => {
        const next = { ...current };
        delete next[skill.id];
        return next;
      });
      return;
    }
    if (!canLoadDiffDetail(updateResult)) {
      setActionMessage("请先检查更新，有文件变化后再查看 diff");
      return;
    }

    setActionBusy(`diff:${skill.id}`);
    setActionError(null);
    setActionMessage(null);
    setDiffError((current) => {
      const next = { ...current };
      delete next[skill.id];
      return next;
    });

    try {
      await ensureReusableSourceBound(skill);
      const detail = await getSkillDiff(skill.id);
      setDiffDetails((current) => ({ ...current, [skill.id]: detail }));
    } catch (caught) {
      setDiffError((current) => ({ ...current, [skill.id]: desktopError(caught) }));
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
      setBackupError((current) => ({ ...current, [skillId]: desktopError(caught) }));
    } finally {
      setActionBusy(null);
    }
  }

  const loadSkillAuditEvents = useCallback(async (skillId: string) => {
    try {
      const events = await listSkillAuditEvents(skillId, 6);
      setSkillAuditEvents((current) => ({ ...current, [skillId]: events }));
    } catch {
      setSkillAuditEvents((current) => ({ ...current, [skillId]: [] }));
    }
  }, []);

  const loadSkillSize = useCallback(async (skillId: string, options?: { force?: boolean }) => {
    if (!options?.force && skillSizesRef.current[skillId]) {
      return;
    }
    try {
      const size = await getSkillSize(skillId);
      const next = { ...skillSizesRef.current, [skillId]: size };
      skillSizesRef.current = next;
      setSkillSizes(next);
    } catch {
      // Size is supplemental UI data; failures should not block opening the detail page.
    }
  }, []);

  async function handleToggleBackups(skillId: string) {
    if (backupPanels[skillId]) {
      setBackupPanels((current) => ({ ...current, [skillId]: false }));
      return;
    }

    setBackupPanels((current) => ({ ...current, [skillId]: true }));
    await loadBackups(skillId);
  }

  async function handleToggleDetailBackups(skill: DesktopSkill) {
    if (backupPanels[skill.id]) {
      setBackupPanels((current) => ({ ...current, [skill.id]: false }));
      return;
    }

    setBackupPanels((current) => ({ ...current, [skill.id]: true }));
    setActionBusy(`backups:${skill.id}`);
    setActionError(null);
    setBackupError((current) => {
      const next = { ...current };
      delete next[skill.id];
      return next;
    });

    try {
      await ensureReusableSourceBound(skill);
      const result = await listSkillBackups(skill.id);
      setBackups((current) => ({ ...current, [skill.id]: result }));
    } catch (caught) {
      setBackupError((current) => ({ ...current, [skill.id]: desktopError(caught) }));
    } finally {
      setActionBusy(null);
    }
  }

  function reusableSourceForSkill(skill: DesktopSkill): DesktopSource | null {
    if (skill.source) {
      return skill.source;
    }
    return (
      skills.find(
        (candidate) =>
          candidate.id !== skill.id &&
          candidate.name === skill.name &&
          candidate.source !== null &&
          candidate.source !== undefined,
      )?.source ?? null
    );
  }

  async function ensureReusableSourceBound(skill: DesktopSkill): Promise<DesktopSkill> {
    const currentSkill = skills.find((candidate) => candidate.id === skill.id) ?? skill;
    if (currentSkill.source) {
      return currentSkill;
    }
    const source = skill.source ?? reusableSourceForSkill(currentSkill);
    if (!source) {
      return currentSkill;
    }

    await bindSkillSource({
      skill_id: currentSkill.id,
      url: source.url,
      repo_path: source.repo_path,
      ref_: source.ref_ || "main",
      credential_ref: source.credential_ref ?? null,
      trusted: source.trusted,
      auto_update: source.auto_update,
    });
    await refreshIndexedSkills();

    return {
      ...currentSkill,
      source_id: source.id,
      source,
    };
  }

  async function handleApplyUpdate(skillId: string, mode?: "overwrite-local") {
    setActionBusy(`apply:${skillId}`);
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await applySkillUpdate(skillId);
      setActionMessage(mode === "overwrite-local" ? overwriteLocalUpdateMessage(result) : applyUpdateMessage(result));
      markSkillUpToDate(result);
      clearSkillDetailArtifacts(skillId);
      setBackupPanels((current) => ({ ...current, [skillId]: true }));
      await refreshIndexedSkills();
      await loadSkillSize(skillId, { force: true });
      await loadBackups(skillId);
      await loadSkillAuditEvents(skillId);
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleApplyNeededAgentUpdates(skillIds: string[]) {
    if (skillIds.length === 0) {
      return;
    }
    setActionBusy("apply-needed-agent-updates");
    setActionError(null);
    setActionMessage(null);

    let applied = 0;
    let failed = 0;
    let securityFindingCount = 0;
    const appliedSkillIds: string[] = [];
    for (const skillId of skillIds) {
      try {
        const result = await applySkillUpdate(skillId);
        applied += 1;
        appliedSkillIds.push(skillId);
        securityFindingCount += result.security_findings.length;
        markSkillUpToDate(result);
        clearSkillDetailArtifacts(skillId);
        await loadSkillAuditEvents(skillId);
      } catch {
        failed += 1;
      }
    }

    try {
      await refreshIndexedSkills();
      await Promise.all(appliedSkillIds.map((skillId) => loadSkillSize(skillId, { force: true })));
      const failureText = failed > 0 ? `，失败 ${failed} 个` : "";
      setActionMessage(
        `已更新 ${applied} 个需要更新的 Agent${failureText}${securityFindingsNote(
          securityFindingCount,
        )}`,
      );
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleRestoreBackup(skillId: string, backupId: string) {
    setActionBusy(`restore:${backupId}`);
    setActionError(null);
    setActionMessage(null);

    try {
      await restoreSkillBackup({ skill_id: skillId, backup_id: backupId });
      setActionMessage("已回滚到备份版本，回滚前状态已自动备份");
      clearSkillRuntimeState(skillId);
      setBackupPanels((current) => ({ ...current, [skillId]: true }));
      await refreshIndexedSkills();
      await loadSkillSize(skillId, { force: true });
      await loadBackups(skillId);
      await loadSkillAuditEvents(skillId);
    } catch (caught) {
      setActionError(desktopError(caught));
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
    clearSkillDetailArtifacts(skillId);
  }

  function clearSkillDetailArtifacts(skillId: string) {
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

  function markSkillUpToDate(result: DesktopApplyUpdateResult) {
    setUpdateResults((current) => {
      const existing = current[result.skill_id];
      const indexedSkill = skills.find((skill) => skill.id === result.skill_id);
      const source = existing?.source ?? indexedSkill?.source ?? null;
      return {
        ...current,
        [result.skill_id]: {
          skill_id: result.skill_id,
          skill_name: existing?.skill_name ?? indexedSkill?.name ?? result.skill_id,
          status: "UpToDate",
          failure_reason: null,
          local_modified: false,
          commits_behind: null,
          diff_summary: null,
          source: source
            ? {
                ...source,
                current_commit: result.new_commit,
                remote_commit: result.new_commit,
              }
            : null,
        },
      };
    });
  }

  const settingsAgentRows = agentPathRows(agents);
  const isSkillDetailView = activeWorkspace === "skills" && skillsViewKind === "detail";
  const openMetisGithub = () => {
    void openExternalUrl(METIS_GITHUB_URL).catch(() => {
      if (navigator.userAgent.toLowerCase().includes("jsdom")) {
        return;
      }
      try {
        window.open(METIS_GITHUB_URL, "_blank", "noopener,noreferrer");
      } catch {
        // Some embedded WebViews do not support window.open; the command above is preferred.
      }
    });
  };

  return (
    <div className="metis-window redesign-preview-shell" data-theme="frost">
      <div className="metis-shell redesign-app-window" data-testid="metis-reference-shell">
        <aside className="metis-sidebar redesign-sidebar" data-testid="metis-reference-sidebar">
          <div className="metis-sidebar-brand-row" data-testid="metis-brand-row">
            <button
              className="metis-sidebar-brand redesign-brand"
              data-testid="metis-brand-home"
              data-github-url={METIS_GITHUB_URL}
              aria-label="打开 Metis GitHub 主页"
              onClick={() => {
                setActiveWorkspace("skills");
                openMetisGithub();
              }}
            >
              <span className="metis-brand-mark redesign-logo-mark" aria-hidden="true">
                <CrystalSkillLogo testId="metis-brand-crystal-logo" />
              </span>
              <span>
                <strong>Metis</strong>
                <small>Skill Manager</small>
              </span>
            </button>
          </div>
          <nav className="metis-sidebar-nav redesign-side-nav" aria-label="Workspace">
            <button
              aria-pressed={activeWorkspace === "skills"}
              className={activeWorkspace === "skills" ? "active" : ""}
              data-testid="workspace-tab-skills"
              onClick={() => setActiveWorkspace("skills")}
            >
              <GridIcon />
              Skills
            </button>
            <button
              aria-pressed={activeWorkspace === "settings"}
              className={activeWorkspace === "settings" ? "active" : ""}
              data-testid="workspace-tab-settings-sidebar"
              onClick={() => setActiveWorkspace("settings")}
            >
              <GearIcon />
              Settings
            </button>
          </nav>
          <div className="metis-sidebar-footer" data-testid="metis-sidebar-footer">
            <button
              className="metis-sidebar-github"
              data-testid="metis-github-link"
              data-github-url={METIS_GITHUB_URL}
              aria-label="打开 Metis GitHub 仓库"
              title="GitHub"
              onClick={openMetisGithub}
            >
              <GitHubIcon />
            </button>
          </div>
        </aside>
        <div className="app-shell redesign-main">
          {!isSkillDetailView && (
            <WorkspaceTopbar
              actionBusy={actionBusy}
              activeWorkspace={activeWorkspace}
              isLoading={state === "loading"}
              skillCount={skills.length}
              skillSearchQuery={skillSearchQuery}
              onCheckAllUpdates={() => handleCheckUpdates(skills.map((skill) => skill.id))}
              onOpenSettings={() => setActiveWorkspace("settings")}
              onScan={handleScan}
              onSearchChange={setSkillSearchQuery}
            />
          )}

          <nav className="workspace-tabs" aria-hidden="true" hidden>
            <WorkspaceTab
              active={activeWorkspace === "skills"}
              count={skills.length}
              label="Skills"
              testId="workspace-tab-skills-legacy"
              onClick={() => setActiveWorkspace("skills")}
            />
            <WorkspaceTab
              active={activeWorkspace === "settings"}
              label="Settings"
              testId="workspace-tab-settings-legacy"
              onClick={() => setActiveWorkspace("settings")}
            />
          </nav>

      {activeWorkspace !== "skills" && (
        <section className="summary-strip" aria-label="路径摘要">
          <SummaryMetric label="内置有效路径" value={builtinPathHealth.valid.toString()} />
          <SummaryMetric label="内置无效路径" value={builtinPathHealth.missing.toString()} />
          <SummaryMetric label="自定义有效路径" value={customPathHealth.valid.toString()} />
          <SummaryMetric label="自定义无效路径" value={customPathHealth.missing.toString()} />
        </section>
      )}

      {actionError && <InlineError error={actionError} />}
      {actionMessage &&
        (guidanceToastVisible ? (
          <div
            className="redesign-toast warning-toast source-required-toast"
            data-testid="source-required-toast"
            role="status"
          >
            <span className="source-required-toast-icon" aria-hidden="true">
              <SourceLinkIcon />
            </span>
            <span className="source-required-toast-copy">
              <strong>{sourceRequiredSkill ? "需要先绑定来源" : "没有可自动更新的 Skill"}</strong>
              <small>
                {sourceRequiredSkill
                  ? "当前 Skill 还没有 Git 来源，绑定后才能检查远端更新。"
                  : actionMessage}
              </small>
            </span>
            {sourceRequiredSkill && (
              <button
                className="source-required-toast-action"
                data-testid="source-required-toast-action"
                onClick={() => {
                  openBindForm(sourceRequiredSkill);
                  setActionMessage(null);
                }}
              >
                去绑定来源
              </button>
            )}
          </div>
        ) : (
          <div
            className={`redesign-toast ${toastToneForActionMessage(actionMessage)}-toast`}
            data-testid="redesign-toast"
          >
            {actionMessage}
          </div>
        ))}

      {activeWorkspace === "settings" && (
        <section className="settings-panel workspace-pane redesign-settings-page" aria-label="配置" data-testid="workspace-settings">
          <section className="settings-section path-management-section" data-testid="settings-section-path-management">
            <div>
              <h3>内置 Agent 路径管理</h3>
              <p>列出 Metis 当前用于扫描各 Agent skill 的目录，路径不对时可以直接修改。</p>
            </div>
            <div className="settings-agent-path-table redesign-agent-path-table" data-testid="settings-agent-path-table">
              {settingsAgentRows
                .filter((row) => !row.agent_id.startsWith("custom-") && row.agent_id !== "generic")
                .map((row) => {
                  const currentPath = agentPathOverrideDrafts[row.agent_id] ?? row.path;
                  return (
                    <label
                      className={`settings-agent-path-row redesign-agent-path-row ${row.exists ? "exists" : "missing"}`}
                      data-testid={`settings-agent-path-${row.agent_id}`}
                      key={row.agent_id}
                    >
                      <span className={row.exists ? "ready" : "missing"}>{row.agent_name}</span>
                      <input
                        data-testid={`agent-path-${row.agent_id}`}
                        value={currentPath}
                        onChange={(event) =>
                          handleAgentPathDraftChange(row.agent_id, row.path, event.target.value)
                        }
                      />
                      <small className={row.exists ? "path-status-ready" : "path-status-missing"}>
                        {row.exists ? "可读写" : "路径不存在"}
                      </small>
                    </label>
                  );
                })}
            </div>
          </section>

          <section className="settings-section custom-monitor-section" data-testid="settings-section-custom-monitors">
            <div>
              <h3>自定义路径管理</h3>
              <p>把个人或团队的 skill 目录作为独立来源展示，名称会和 Codex、OpenClaw 一样出现在列表里。</p>
            </div>
            <div className="custom-monitor-list">
              {customMonitorDrafts.length === 0 ? (
                <span className="settings-muted">暂无自定义监控路径</span>
              ) : (
                customMonitorDrafts.map((path) => (
                  <div
                    className="settings-agent-path-row redesign-agent-path-row custom-monitor-row"
                    data-testid={`custom-monitor-row-${path.id}`}
                    key={path.id}
                  >
                    <input
                      aria-label={`${path.name} 名称`}
                      value={path.name}
                      onChange={(event) =>
                        setCustomMonitorDrafts((current) =>
                          current.map((item) =>
                            item.id === path.id ? { ...item, name: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <input
                      aria-label={`${path.name} 路径`}
                      value={path.path}
                      onChange={(event) =>
                        setCustomMonitorDrafts((current) =>
                          current.map((item) =>
                            item.id === path.id ? { ...item, path: event.target.value } : item,
                          ),
                        )
                      }
                    />
                    <button
                      className="ghost-button compact custom-monitor-remove"
                      onClick={() => removeCustomMonitor(path.id)}
                      type="button"
                    >
                      移除
                    </button>
                  </div>
                ))
              )}
            </div>
            <div
              className="settings-agent-path-row redesign-agent-path-row custom-monitor-row new-monitor-row"
              data-testid="custom-monitor-new-row"
            >
              <input
                data-testid="custom-monitor-name-new"
                value={newCustomMonitorName}
                placeholder="自定义路径名称"
                onChange={(event) => setNewCustomMonitorName(event.target.value)}
              />
              <input
                data-testid="custom-monitor-path-new"
                value={newCustomMonitorPath}
                placeholder="/Users/me/team-skills"
                onChange={(event) => setNewCustomMonitorPath(event.target.value)}
              />
              <small className="path-status-ready">待添加</small>
            </div>
          </section>

          <section className="settings-section auto-update-section" data-testid="settings-section-auto-update">
            <div>
              <h3>自动更新</h3>
              <p>只会更新已加入自动更新列表、且本地没有修改的 Skill。</p>
            </div>
            <div className="policy-summary">
              <span>自动更新列表 {autoUpdateSourceSkills.length} 个</span>
              <span>本次可更新候选 {trustedAutoUpdateSkills.length} 个</span>
            </div>
            <div className="auto-update-source-list" data-testid="auto-update-source-list">
              {autoUpdateSourceSkills.length === 0 ? (
                <span className="settings-muted">暂无加入自动更新列表的 Skill</span>
              ) : (
                autoUpdateSourceSkills.map((skill) => (
                  <div
                    className="auto-update-source-row"
                    data-testid={`auto-update-source-row-${skill.id}`}
                    key={skill.id}
                  >
                    <div>
                      <strong>{skill.name}</strong>
                      <span>{skill.source?.url}</span>
                    </div>
                    <button
                      className="ghost-button compact auto-update-remove"
                      data-testid={`remove-auto-update-${skill.id}`}
                      disabled={actionBusy === `remove-auto-update:${skill.id}`}
                      onClick={() => handleRemoveAutoUpdateSkill(skill)}
                      type="button"
                    >
                      {actionBusy === `remove-auto-update:${skill.id}` ? "移除中" : "移除"}
                    </button>
                  </div>
                ))
              )}
            </div>
            <button
              className="compact"
              data-testid="run-auto-update"
              disabled={actionBusy === "auto-update" || skills.length === 0}
              onClick={handleRunAutoUpdate}
            >
              {actionBusy === "auto-update" ? "更新中" : "开启自动更新"}
            </button>
          </section>

          <section className="settings-section git-health-section" data-testid="settings-section-git-health">
            <div>
              <h3>Git 环境检查</h3>
              <p>检测本机 Git 是否可运行。</p>
            </div>
            <div className="settings-git-health-card">
              <div className="settings-git-health-action">
                <button
                  className="settings-git-test-button"
                  data-testid="test-git-environment"
                  disabled={actionBusy === "git-environment"}
                  onClick={handleTestGitEnvironment}
                  type="button"
                >
                  {actionBusy === "git-environment" ? "检测中" : "检测 Git 环境"}
                </button>
                <p>点击后只会运行本机 git --version，不会访问仓库、安装、更新或修改任何文件。</p>
              </div>
              {gitEnvironmentResult && (
                <div className="settings-git-health-result success" data-testid="git-environment-result">
                  <strong>{gitEnvironmentResult.message}</strong>
                  <span>{gitEnvironmentResult.version}</span>
                </div>
              )}
              {gitEnvironmentError && (
                <div className="settings-git-health-result failure" data-testid="git-environment-error">
                  <InlineError error={gitEnvironmentError} />
                </div>
              )}
            </div>
          </section>

          <div className="form-actions settings-save-actions">
            <button
              className="ghost-button compact"
              disabled={actionBusy === "settings"}
              onClick={() => handleSaveSettings(true)}
            >
              {actionBusy === "settings" ? "保存中" : "保存"}
            </button>
          </div>
        </section>
      )}

      {activeWorkspace === "skills" && (
        <SkillsWorkspace
          actionBusy={actionBusy}
          backupError={backupError}
          backupPanels={backupPanels}
          backups={backups}
          bindDraft={bindDraft}
          bindingSkillId={bindingSkillId}
          diffDetails={diffDetails}
          diffError={diffError}
          error={error}
          remoteInstallResult={remoteInstallResult}
          remotePreview={remotePreview}
          remoteSyncDraft={remoteSyncDraft}
          remoteTargets={remoteTargets}
          selectedRemoteTargetIds={selectedRemoteTargetIds}
          skillAuditEvents={skillAuditEvents}
          skillSearchQuery={skillSearchQuery}
          skillSizes={skillSizes}
          sourceConnectionErrors={sourceConnectionErrors}
          sourceConnectionResults={sourceConnectionResults}
          skills={skills}
          state={state}
          updateResults={updateResults}
          onApplyUpdate={handleApplyUpdate}
          onApplyNeededAgentUpdates={handleApplyNeededAgentUpdates}
          onBackupsDetailToggle={handleToggleDetailBackups}
          onBackupsToggle={handleToggleBackups}
          onBind={handleBindSource}
          onCancelBind={() => setBindingSkillId(null)}
          onCheckUpdates={handleCheckUpdates}
          onCheckDetailUpdates={handleCheckDetailUpdates}
          onDraftChange={handleBindDraftChange}
          onInstallRemoteTargets={handleInstallRemoteTargets}
          onLoadSkillAuditEvents={loadSkillAuditEvents}
          onLoadSkillSize={loadSkillSize}
          onOpenBind={openBindForm}
          onOpenSettings={() => setActiveWorkspace("settings")}
          onPreviewRemoteSync={handlePreviewRemoteSync}
          onRestoreBackup={handleRestoreBackup}
          onScan={handleScan}
          onSetRemoteSyncDraft={setRemoteSyncDraft}
          onRouteKindChange={setSkillsViewKind}
          onToggleDetailDiff={handleToggleDetailDiff}
          onToggleDiff={handleToggleDiff}
          onToggleRemoteTarget={toggleRemoteTarget}
          onTestSourceConnection={handleTestSourceConnection}
          onUnbind={handleUnbindSource}
        />
      )}

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
      </div>
    </div>
  );
}

function isUiRedesignPreviewRoute() {
  if (typeof window === "undefined") {
    return false;
  }
  const hash = window.location.hash.replace(/^#/, "");
  const search = window.location.search;
  return hash === "/ui-redesign-preview" || search.includes("preview=ui-redesign");
}

function autoUpdateUnavailableMessage(skills: DesktopSkill[]) {
  const boundSourceCount = skills.filter((skill) => skill.source).length;
  const autoUpdateSourceCount = skills.filter(
    (skill) => skill.source?.trusted && skill.source.auto_update,
  ).length;
  const blockedByLocalChanges = skills.some(
    (skill) => skill.source?.trusted && skill.source.auto_update && skill.local_modified === true,
  );

  if (boundSourceCount === 0) {
    return "请先为 Skill 绑定 Git 来源，再开启「信任此来源并加入自动更新列表」。";
  }

  if (autoUpdateSourceCount === 0) {
    return "请先在来源里开启「信任此来源并加入自动更新列表」。";
  }

  if (blockedByLocalChanges) {
    return "候选 Skill 都有本地修改，请先检查或手动处理本地修改。";
  }

  return "请确认 Skill 已加入自动更新列表，且本地没有修改。";
}

function isAutoUpdateUnavailableMessage(message: string | null) {
  return (
    message === "请先为 Skill 绑定 Git 来源，再开启「信任此来源并加入自动更新列表」。" ||
    message === "请先在来源里开启「信任此来源并加入自动更新列表」。" ||
    message === "候选 Skill 都有本地修改，请先检查或手动处理本地修改。" ||
    message === "请确认 Skill 已加入自动更新列表，且本地没有修改。"
  );
}

function toastToneForActionMessage(message: string): "success" | "info" | "warning" {
  if (
    message.startsWith("请先") ||
    message.startsWith("需要") ||
    message.includes("没有可用") ||
    message.includes("失败")
  ) {
    return "warning";
  }

  if (
    message.includes("完成") ||
    message.includes("已") ||
    message.includes("成功") ||
    message.includes("回滚")
  ) {
    return "success";
  }

  return "info";
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkspaceTab({
  active,
  count,
  label,
  testId,
  onClick,
}: {
  active: boolean;
  count?: number;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`workspace-tab ${active ? "active" : ""}`}
      data-testid={testId}
      onClick={onClick}
    >
      <span>{label}</span>
      {count !== undefined && <strong>{count}</strong>}
    </button>
  );
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

function emptyEnterpriseNetworkSettings() {
  return {
    proxy_url: null,
    no_proxy: null,
    certificate_authority_bundle_path: null,
  };
}

function normalizeSettingsIdentity(value: string) {
  return value.trim().toLocaleLowerCase();
}

function normalizeSettingsPath(value: string) {
  const trimmed = value.trim();
  if (trimmed === "/") {
    return trimmed;
  }
  return trimmed.replace(/\/+$/g, "");
}

function settingsValidationError(message: string, suggestion: string): DesktopError {
  return {
    category: "settings",
    title: "设置未保存",
    message,
    suggestion,
    debug_detail: null,
  };
}

function applyUpdateMessage(result: DesktopApplyUpdateResult) {
  if (result.previous_commit === result.new_commit) {
    return `已用来源版本覆盖本地修改：${shortCommit(result.new_commit)}，已创建备份 ${
      result.backup_id
    }${securityFindingsNote(result.security_findings.length)}`;
  }
  return `更新完成：${shortCommit(result.previous_commit)} -> ${shortCommit(
    result.new_commit,
  )}，已创建备份 ${result.backup_id}${securityFindingsNote(result.security_findings.length)}`;
}

function overwriteLocalUpdateMessage(result: DesktopApplyUpdateResult) {
  return `已用来源版本覆盖本地修改：${shortCommit(result.new_commit)}，已创建备份 ${
    result.backup_id
  }${securityFindingsNote(result.security_findings.length)}`;
}

function securityFindingsNote(count: number) {
  if (count === 0) {
    return "";
  }
  return "。更新内容包含需要留意的脚本或配置字段，来源可信时通常可以继续使用";
}

function canLoadDiffDetail(updateResult?: DesktopUpdateCheckResult) {
  return (
    updateResult?.status === "UpdateAvailable" &&
    (updateResult.diff_summary?.total_changes ?? 0) > 0
  );
}

function pathHealthForAgents(
  agents: DesktopAgentStatus[],
  kind: "custom",
): { valid: number; missing: number } {
  return agents
    .filter((agent) => kind === "custom" && agent.agent_id.startsWith("custom-"))
    .flatMap((agent) => agent.paths)
    .reduce(
      (summary, path) => ({
        valid: summary.valid + (path.exists ? 1 : 0),
        missing: summary.missing + (path.exists ? 0 : 1),
      }),
      { valid: 0, missing: 0 },
    );
}

function builtinPathHealthForAgents(
  agents: DesktopAgentStatus[],
): { valid: number; missing: number } {
  return agents
    .filter((agent) => !agent.agent_id.startsWith("custom-"))
    .reduce(
      (summary, agent) => {
        const hasValidPath = agent.paths.some((path) => path.exists);
        return {
          valid: summary.valid + (hasValidPath ? 1 : 0),
          missing: summary.missing + (hasValidPath ? 0 : 1),
        };
      },
      { valid: 0, missing: 0 },
    );
}

function agentPathRows(agents: DesktopAgentStatus[]) {
  const fallbackAgents = [
    { agent_id: "codex", agent_name: "Codex", path: "~/.codex/skills", exists: false },
    { agent_id: "claude-code", agent_name: "Claude Code", path: "~/.claude/skills", exists: false },
    { agent_id: "openclaw", agent_name: "OpenClaw", path: "~/.openclaw/skills", exists: false },
    { agent_id: "hermes", agent_name: "Hermes", path: "~/.hermes/skills", exists: false },
    { agent_id: "opencode", agent_name: "opencode", path: "~/.opencode/skills", exists: false },
    { agent_id: "generic", agent_name: "Generic", path: "自定义路径", exists: false },
  ];

  const discovered = agents.map((agent) => {
    const firstPath = agent.paths[0];
    return {
      agent_id: agent.agent_id,
      agent_name: agent.agent_name,
      path: firstPath?.path ?? "未配置",
      exists: Boolean(firstPath?.exists),
    };
  });
  const discoveredIds = new Set(discovered.map((row) => row.agent_id));

  return [
    ...discovered,
    ...fallbackAgents.filter((agent) => !discoveredIds.has(agent.agent_id)),
  ];
}

function desktopError(caught: unknown): DesktopError {
  if (isDesktopError(caught)) {
    return caught;
  }
  if (typeof caught === "string") {
    const parsed = parseDesktopError(caught);
    if (parsed) {
      return parsed;
    }
    return unknownDesktopError(caught);
  }
  if (caught instanceof Error) {
    return unknownDesktopError(caught.message);
  }
  return unknownDesktopError("桌面后端返回了无法识别的错误");
}

type GitUrlTestCandidate = {
  url: string;
  label: "当前" | "HTTPS" | "git@";
  isOriginal: boolean;
};

function gitUrlTestCandidates(rawUrl: string): GitUrlTestCandidate[] {
  const original = rawUrl.trim();
  if (!original) {
    return [];
  }

  const candidates: GitUrlTestCandidate[] = [
    { url: original, label: "当前", isOriginal: true },
  ];
  const derived = deriveAlternateGitUrl(original);
  if (derived && derived.url !== original) {
    candidates.push({ ...derived, isOriginal: false });
  }
  return candidates;
}

function deriveAlternateGitUrl(rawUrl: string): Omit<GitUrlTestCandidate, "isOriginal"> | null {
  const url = rawUrl.trim();
  const httpsMatch = url.match(/^https:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    return {
      label: "git@",
      url: `git@${httpsMatch[1]}:${ensureGitSuffix(httpsMatch[2])}`,
    };
  }

  const scpSshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?\/?$/i);
  if (scpSshMatch) {
    return {
      label: "HTTPS",
      url: `https://${scpSshMatch[1]}/${ensureGitSuffix(scpSshMatch[2])}`,
    };
  }

  return null;
}

function ensureGitSuffix(path: string) {
  return path.endsWith(".git") ? path : `${path}.git`;
}

function withDerivedGitUrlSuggestion(error: DesktopError): DesktopError {
  return {
    ...error,
    suggestion:
      "Metis 已自动尝试当前地址及可推导的 HTTPS / git@ 地址，仍然无法访问。请检查仓库地址、主分支名、仓库内路径，以及本机 Git 登录、token 或 SSH key 配置。",
  };
}

function retainUpdateResultsForSkills(
  current: Record<string, DesktopUpdateCheckResult>,
  scannedSkills: DesktopSkill[],
): Record<string, DesktopUpdateCheckResult> {
  const scannedSkillIds = new Set(scannedSkills.map((skill) => skill.id));
  return Object.fromEntries(
    Object.entries(current).filter(([skillId]) => scannedSkillIds.has(skillId)),
  );
}

function parseDesktopError(raw: string): DesktopError | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isDesktopError(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isDesktopError(value: unknown): value is DesktopError {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.category === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.suggestion === "string" &&
    (candidate.debug_detail === undefined ||
      candidate.debug_detail === null ||
      typeof candidate.debug_detail === "string")
  );
}

function unknownDesktopError(detail: string): DesktopError {
  return {
    category: "unknown",
    title: "操作失败",
    message: detail,
    suggestion: "请确认目标目录、Git source 和本地数据库状态后重试。",
    debug_detail: detail,
  };
}

type WorkspaceTopbarProps = {
  actionBusy: string | null;
  activeWorkspace: WorkspaceKey;
  isLoading: boolean;
  skillCount: number;
  skillSearchQuery: string;
  onCheckAllUpdates: () => void;
  onOpenSettings: () => void;
  onScan: () => void;
  onSearchChange: (value: string) => void;
};

const workspaceTopbarCopy: Record<WorkspaceKey, { eyebrow: string; title: string }> = {
  skills: { eyebrow: "Skill Dashboard", title: "Skills" },
  settings: { eyebrow: "Settings", title: "Agent 路径设置" },
};

function WorkspaceTopbar({
  actionBusy,
  activeWorkspace,
  isLoading,
  skillCount,
  skillSearchQuery,
  onCheckAllUpdates,
  onOpenSettings,
  onScan,
  onSearchChange,
}: WorkspaceTopbarProps) {
  const copy = workspaceTopbarCopy[activeWorkspace];
  const showSearch = activeWorkspace === "skills";

  return (
    <header className="topbar redesign-page-topbar" data-testid="workspace-topbar">
      <div className="topbar-title">
        <p>{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
      </div>
      <div className="topbar-actions">
        <div
          className={`topbar-middle-slot${showSearch ? "" : " is-empty"}`}
          data-testid="workspace-topbar-middle"
        >
          {showSearch && (
            <label className="topbar-search redesign-search-field" aria-label="搜索 skills">
              <SearchIcon />
              <input
                data-testid="skill-search-input"
                placeholder="搜索 skill、路径或来源"
                value={skillSearchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>
          )}
        </div>
        <div className="redesign-top-actions" data-testid="workspace-topbar-actions">
          <button
            className="ghost-button topbar-secondary-action"
            data-testid="check-all-updates"
            disabled={isLoading || actionBusy === "check-updates" || skillCount === 0}
            onClick={onCheckAllUpdates}
          >
            {actionBusy === "check-updates" ? "检查中" : "检查更新"}
          </button>
          <button
            className="scan-button"
            data-testid="scan-skills"
            disabled={isLoading}
            onClick={onScan}
          >
            {isLoading ? "扫描中" : "重新扫描"}
          </button>
        </div>
        <button
          aria-label="Settings"
          aria-pressed={activeWorkspace === "settings"}
          className="settings-icon-button"
          data-testid="workspace-tab-settings"
          onClick={onOpenSettings}
        >
          <span aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function GridIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="4" y="4" width="6" height="6" rx="1.4" />
      <rect x="14" y="4" width="6" height="6" rx="1.4" />
      <rect x="4" y="14" width="6" height="6" rx="1.4" />
      <rect x="14" y="14" width="6" height="6" rx="1.4" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 8.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Z" />
      <path d="M12 3.4 14 5l2.5-.5 1.2 2.1-1.6 2 .4 1.4 2.2 1v2.4l-2.2 1-.4 1.4 1.6 2-1.2 2.1-2.5-.5-2 1.6-2-1.6-2.5.5-1.2-2.1 1.6-2-.4-1.4-2.2-1V11l2.2-1 .4-1.4-1.6-2 1.2-2.1L10 5l2-1.6Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="10.5" cy="10.5" r="5.8" />
      <path d="m15 15 4.4 4.4" />
    </svg>
  );
}

function SourceLinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M9.2 14.8 14.8 9.2" />
      <path d="M10.5 6.8 12 5.3a4.2 4.2 0 0 1 5.9 5.9l-1.5 1.5" />
      <path d="M13.5 17.2 12 18.7a4.2 4.2 0 0 1-5.9-5.9l1.5-1.5" />
    </svg>
  );
}

export default App;
