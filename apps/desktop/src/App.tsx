import { useCallback, useEffect, useRef, useState } from "react";
import desktopPackage from "../package.json";
import {
  applySkillUpdate,
  bindSkillSource,
  checkPathStatus,
  checkSkillUpdates,
  copyLocalSkillToTargets,
  getSkillDiff,
  getSkillSize,
  getDesktopSettings,
  getLocalSkillInstallTargets,
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
import { normalizeRemoteSyncDraft } from "./gitWebUrl";
import { GitHubIcon } from "./GitHubIcon";
import { textInputAssistanceProps } from "./inputAssistance";
import { MetisBrandWordmark } from "./MetisBrandWordmark";
import { METIS_GITHUB_URL } from "./projectLinks";
import { isRemoteTargetSelectable, remoteTargetId, SkillsWorkspace } from "./SkillsWorkspace";
import {
  emptyDetailLocalInstallState,
  type DetailLocalInstallState,
} from "./SkillDetailPage";
import { InlineError, type BindDraft } from "./SkillRow";
import {
  checkSoftwareUpdate,
  downloadSoftwareUpdate,
  openDownloadsDirectory,
  openSoftwareUpdateInstaller,
} from "./software-update/api";
import { SoftwareUpdateSurface } from "./software-update/SoftwareUpdateSurface";
import {
  emptySoftwareUpdateDownloadState,
  type SoftwareUpdateDownloadEvent,
  type SoftwareUpdateInfo,
} from "./software-update/types";
import { UiRedesignPreview } from "./UiRedesignPreview";
import type {
  DesktopAgentStatus,
  DesktopAgentPath,
  DesktopApplyUpdateResult,
  DesktopAuditEvent,
  DesktopBackupSummary,
  DesktopCopyLocalSkillResult,
  DesktopDiffDetail,
  DesktopError,
  DesktopGitEnvironmentTestResult,
  DesktopInstallRemoteSkillResult,
  DesktopLocalSkillTarget,
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
type DetailLocalInstallStateUpdate =
  | Partial<DetailLocalInstallState>
  | ((current: DetailLocalInstallState) => Partial<DetailLocalInstallState>);
type DetailLocalInstallOperation = "targets" | "install";
interface DetailLocalInstallPending {
  operation: DetailLocalInstallOperation;
  token: number;
}
interface AutoUpdateSourceGroup {
  sourceKey: string;
  representative: DesktopSkill;
  members: DesktopSkill[];
}

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
  const [homeCheckCompletionKey, setHomeCheckCompletionKey] = useState<number | null>(null);
  const [sourceRequiredSkillId, setSourceRequiredSkillId] = useState<string | null>(null);
  const [settings, setSettings] = useState<DesktopSettings>({
    custom_scan_paths: [],
    agent_path_overrides: [],
    custom_monitored_paths: [],
    team_policy_path: null,
    enterprise_network: emptyEnterpriseNetworkSettings(),
    software_update: { check_on_startup: true },
  });
  const [softwareUpdateCheckOnStartupDraft, setSoftwareUpdateCheckOnStartupDraft] =
    useState(true);
  const [softwareUpdateInfo, setSoftwareUpdateInfo] = useState<SoftwareUpdateInfo | null>(null);
  const [softwareUpdateDismissed, setSoftwareUpdateDismissed] = useState(false);
  const [softwareUpdateDialogOpen, setSoftwareUpdateDialogOpen] = useState(false);
  const [softwareUpdateDownloadState, setSoftwareUpdateDownloadState] = useState(
    emptySoftwareUpdateDownloadState,
  );
  const [softwareUpdateCheckBusy, setSoftwareUpdateCheckBusy] = useState(false);
  const [softwareUpdateCheckMessage, setSoftwareUpdateCheckMessage] = useState<string | null>(null);
  const [softwareUpdateCheckError, setSoftwareUpdateCheckError] = useState<string | null>(null);
  const [softwareUpdateOpenError, setSoftwareUpdateOpenError] = useState<string | null>(null);
  const [agentPathOverrideDrafts, setAgentPathOverrideDrafts] = useState<Record<string, string>>({});
  const [editingAgentPathId, setEditingAgentPathId] = useState<string | null>(null);
  const [customMonitorDrafts, setCustomMonitorDrafts] = useState<DesktopCustomMonitoredPath[]>([]);
  const [customMonitorPathStatuses, setCustomMonitorPathStatuses] = useState<
    Record<string, DesktopAgentPath>
  >({});
  const [savedCustomMonitorIds, setSavedCustomMonitorIds] = useState<Set<string>>(new Set());
  const [pendingCustomMonitorRemovalIds, setPendingCustomMonitorRemovalIds] = useState<Set<string>>(
    new Set(),
  );
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
  const [skillsHomeNavigationKey, setSkillsHomeNavigationKey] = useState(0);
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [remoteSyncDraft, setRemoteSyncDraft] = useState<RemoteSyncDraft>(emptyRemoteSyncDraft());
  const [remotePreview, setRemotePreview] = useState<DesktopRemoteSkillPreview | null>(null);
  const [remotePreviewError, setRemotePreviewError] = useState<DesktopError | null>(null);
  const [remoteTargets, setRemoteTargets] = useState<DesktopSkillTarget[]>([]);
  const [selectedRemoteTargetIds, setSelectedRemoteTargetIds] = useState<string[]>([]);
  const [detailLocalInstallStates, setDetailLocalInstallStates] = useState<
    Record<string, DetailLocalInstallState>
  >({});
  const [pendingAutoUpdateRemovalSourceKey, setPendingAutoUpdateRemovalSourceKey] =
    useState<string | null>(null);
  const [remoteInstallResult, setRemoteInstallResult] =
    useState<DesktopInstallRemoteSkillResult | null>(null);
  const builtinPathHealth = builtinPathHealthForAgents(agents);
  const customPathHealth = pathHealthForAgents(agents, "custom");
  const autoUpdateInstallationSkills = skills.filter(
    (skill) => skill.source?.trusted && skill.source.auto_update,
  );
  const autoUpdateSourceGroups = groupAutoUpdateSkillsBySource(autoUpdateInstallationSkills);
  const trustedAutoUpdateSkills = autoUpdateInstallationSkills.filter(
    (skill) => skill.local_modified !== true,
  );
  const sourceRequiredSkill = sourceRequiredSkillId
    ? skills.find((skill) => skill.id === sourceRequiredSkillId) ?? null
    : null;
  const autoUpdateUnavailable = isAutoUpdateUnavailableMessage(actionMessage);
  const guidanceToastVisible = Boolean(sourceRequiredSkill || autoUpdateUnavailable);
  const didBootstrap = useRef(false);
  const detailLocalInstallRequestSequenceRef = useRef(0);
  const softwareUpdateCheckSequenceRef = useRef(0);
  const detailLocalInstallRequestTokensRef = useRef<Record<string, number>>({});
  const detailLocalInstallPendingRef = useRef<Record<string, DetailLocalInstallPending>>({});
  const agentPathInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
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

  useEffect(() => {
    if (homeCheckCompletionKey === null) {
      return;
    }
    const completionTimer = window.setTimeout(() => {
      setHomeCheckCompletionKey(null);
    }, 3000);
    return () => window.clearTimeout(completionTimer);
  }, [homeCheckCompletionKey]);

  useEffect(() => {
    if (!editingAgentPathId) {
      return;
    }
    const input = agentPathInputRefs.current[editingAgentPathId];
    input?.focus();
    input?.select();
  }, [editingAgentPathId]);

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
        startStartupSoftwareUpdateCheck(settingsResult);
        return;
      }

      const scanResult = await scanSkills();
      setSkills(scanResult.skills);
      setWarnings(scanResult.warnings);
      setState("loaded");
      setActionMessage("已重新扫描本机 skill 路径");
      startStartupSoftwareUpdateCheck(settingsResult);
    } catch (caught) {
      setError(desktopError(caught));
      setState("error");
    }
  }

  function hasMissingLocalUpdatedAt(indexedSkills: DesktopSkill[]) {
    return indexedSkills.some((skill) => skill.local_updated_at === null);
  }

  function startStartupSoftwareUpdateCheck(nextSettings: DesktopSettings) {
    if (nextSettings.software_update?.check_on_startup ?? true) {
      void handleCheckSoftwareUpdate("startup");
    }
  }

  function settingsRequestFromDrafts(): DesktopSettings {
    const nextCustomMonitors = customMonitorDrafts.filter(
      (path) => !pendingCustomMonitorRemovalIds.has(path.id),
    );
    if (newCustomMonitorName.trim() && newCustomMonitorPath.trim()) {
      nextCustomMonitors.push({
        id: customMonitorId(newCustomMonitorName, nextCustomMonitors.length),
        name: newCustomMonitorName,
        path: newCustomMonitorPath,
      });
    }
    return {
      ...settings,
      custom_scan_paths: settings.custom_scan_paths ?? [],
      agent_path_overrides: Object.entries(agentPathOverrideDrafts).map(([agent_id, path]) => ({
        agent_id,
        path,
      })),
      custom_monitored_paths: nextCustomMonitors,
      team_policy_path: settings.team_policy_path ?? null,
      enterprise_network: settings.enterprise_network ?? emptyEnterpriseNetworkSettings(),
      software_update: {
        check_on_startup: softwareUpdateCheckOnStartupDraft,
      },
    };
  }

  function syncPathSettingsDrafts(nextSettings: DesktopSettings) {
    const overrides = agentPathOverrideRecord(nextSettings);
    setAgentPathOverrideDrafts(overrides);
    setEditingAgentPathId(null);
    setCustomMonitorDrafts(nextSettings.custom_monitored_paths ?? []);
    setSavedCustomMonitorIds(
      new Set((nextSettings.custom_monitored_paths ?? []).map((path) => path.id)),
    );
    setPendingCustomMonitorRemovalIds(new Set());
    setCustomMonitorPathStatuses({});
    setNewCustomMonitorName("");
    setNewCustomMonitorPath("");
    setSoftwareUpdateCheckOnStartupDraft(
      nextSettings.software_update?.check_on_startup ?? true,
    );
  }

  async function handleCheckSoftwareUpdate(mode: "startup" | "manual") {
    const requestToken = softwareUpdateCheckSequenceRef.current + 1;
    softwareUpdateCheckSequenceRef.current = requestToken;
    setSoftwareUpdateCheckBusy(true);
    if (mode === "manual") {
      setSoftwareUpdateCheckMessage(null);
      setSoftwareUpdateCheckError(null);
    }

    try {
      const update = await checkSoftwareUpdate();
      if (requestToken !== softwareUpdateCheckSequenceRef.current) {
        return;
      }
      setSoftwareUpdateInfo(update);
      if (update) {
        setSoftwareUpdateDismissed(false);
        if (mode === "manual") {
          setSoftwareUpdateCheckMessage(`发现 Metis ${update.version}`);
        }
      } else if (mode === "manual") {
        setSoftwareUpdateCheckMessage("当前已是最新版");
      }
    } catch {
      if (mode === "manual" && requestToken === softwareUpdateCheckSequenceRef.current) {
        setSoftwareUpdateCheckError("暂时无法获取更新信息，请稍后重试。");
      }
    } finally {
      if (requestToken === softwareUpdateCheckSequenceRef.current) {
        setSoftwareUpdateCheckBusy(false);
      }
    }
  }

  function handleSoftwareUpdateDownloadEvent(event: SoftwareUpdateDownloadEvent) {
    setSoftwareUpdateDownloadState((current) => {
      switch (event.event) {
        case "started":
          return {
            phase: "downloading",
            downloaded: 0,
            contentLength: event.content_length ?? null,
            result: null,
            error: null,
          };
        case "progress":
          return {
            ...current,
            phase: "downloading",
            downloaded: event.downloaded,
            contentLength: event.content_length ?? current.contentLength,
          };
        case "verifying":
          return { ...current, phase: "verifying" };
        case "saving":
        case "finished":
          return { ...current, phase: "saving" };
      }
    });
  }

  async function handleDownloadSoftwareUpdate() {
    if (!softwareUpdateInfo || softwareUpdateCheckBusy) {
      return;
    }
    softwareUpdateCheckSequenceRef.current += 1;
    setSoftwareUpdateDialogOpen(true);
    setSoftwareUpdateOpenError(null);
    setSoftwareUpdateDownloadState({
      ...emptySoftwareUpdateDownloadState(),
      phase: "downloading",
    });
    try {
      const result = await downloadSoftwareUpdate(handleSoftwareUpdateDownloadEvent);
      setSoftwareUpdateDownloadState((current) => ({
        ...current,
        phase: "saved",
        downloaded: current.contentLength ?? current.downloaded,
        result,
        error: null,
      }));
    } catch (caught) {
      setSoftwareUpdateDownloadState((current) => ({
        ...current,
        phase: "error",
        error: softwareUpdateErrorMessage(
          caught,
          "更新没有下载完成，请检查网络后重试。",
        ),
      }));
    }
  }

  async function handleOpenSoftwareUpdateInstaller() {
    setSoftwareUpdateOpenError(null);
    try {
      await openSoftwareUpdateInstaller();
    } catch (caught) {
      setSoftwareUpdateOpenError(
        softwareUpdateErrorMessage(caught, "暂时无法打开安装包，请稍后重试。"),
      );
    }
  }

  async function handleOpenDownloadsDirectory() {
    setSoftwareUpdateOpenError(null);
    try {
      await openDownloadsDirectory();
    } catch {
      setSoftwareUpdateOpenError("暂时无法打开下载目录，请稍后重试。");
    }
  }

  function closeSoftwareUpdateDialog() {
    if (softwareUpdateDownloadState.phase === "saved") {
      setSoftwareUpdateDismissed(true);
    }
    setSoftwareUpdateDialogOpen(false);
    setSoftwareUpdateOpenError(null);
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
      clearAllDetailLocalInstallStates();
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
      const pathValidationError = await validateCustomMonitorPathAvailability(nextSettings);
      if (pathValidationError) {
        setActionError(pathValidationError);
        return;
      }
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

  async function validateCustomMonitorPathAvailability(
    nextSettings: DesktopSettings,
  ): Promise<DesktopError | null> {
    const customPaths = nextSettings.custom_monitored_paths ?? [];
    const statuses = await Promise.all(
      customPaths.map(async (customPath) => {
        const status = await checkPathStatus(customPath.path).catch(
          () =>
            ({
              path: customPath.path,
              scope: "custom",
              exists: false,
              readable: false,
              writable: false,
            }) satisfies DesktopAgentPath,
        );
        return [customPath.id, status] as const;
      }),
    );
    setCustomMonitorPathStatuses(Object.fromEntries(statuses));

    const invalidPath = statuses.find(
      ([, status]) => !status.exists || !status.readable || !status.writable,
    );
    if (!invalidPath) {
      return null;
    }
    return settingsValidationError(
      "自定义路径不可用",
      "请确认该目录存在，并且当前用户拥有读取和写入权限。",
    );
  }

  function handleAgentPathDraftChange(agentId: string, nextPath: string) {
    setAgentPathOverrideDrafts((current) => ({ ...current, [agentId]: nextPath }));
  }

  function cancelAgentPathDraft(agentId: string) {
    const savedOverride = agentPathOverrideRecord(settings)[agentId];
    setAgentPathOverrideDrafts((current) => {
      const next = { ...current };
      if (savedOverride === undefined) {
        delete next[agentId];
      } else {
        next[agentId] = savedOverride;
      }
      return next;
    });
    setEditingAgentPathId((current) => (current === agentId ? null : current));
  }

  function removeCustomMonitor(id: string) {
    if (savedCustomMonitorIds.has(id)) {
      setPendingCustomMonitorRemovalIds((current) => new Set(current).add(id));
      return;
    }
    setCustomMonitorDrafts((current) => current.filter((path) => path.id !== id));
    setCustomMonitorPathStatuses((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function restoreCustomMonitor(id: string) {
    setPendingCustomMonitorRemovalIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  async function addCustomMonitorDraft() {
    const name = newCustomMonitorName.trim();
    const path = newCustomMonitorPath.trim();
    if (!name || !path) {
      return;
    }
    const id = customMonitorId(name, customMonitorDrafts.length);
    const pathStatus = await checkPathStatus(path).catch(
      () =>
        ({
          path,
          scope: "custom",
          exists: false,
          readable: false,
          writable: false,
        }) satisfies DesktopAgentPath,
    );
    setCustomMonitorDrafts((current) => [...current, { id, name, path }]);
    setCustomMonitorPathStatuses((current) => ({ ...current, [id]: pathStatus }));
    setNewCustomMonitorName("");
    setNewCustomMonitorPath("");
    setActionError(null);
  }

  function customMonitorId(name: string, index: number) {
    const slug = name
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug ? `${slug}-${index + 1}` : `monitor-${index + 1}`;
  }

  function customMonitorAgentId(id: string) {
    const slug = id
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug ? `custom-${slug}` : "custom-monitor";
  }

  function openBindForm(skill: DesktopSkill) {
    const source = skill.source ?? reusableSourceForSkill(skill);
    setBindingSkillId(skill.id);
    setActionError(null);
    clearSourceConnectionState(skill.id);
    setBindDraft({
      url: source?.url ?? "",
      repo_path: source?.repo_path ?? "",
      ref_: source?.ref_ ?? "",
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
    const ref = bindDraft.ref_.trim();
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
          if (!candidate.isOriginal || !shouldTryDerivedGitUrl(lastError)) {
            break;
          }
        }
      }

      const displayError = lastError ?? unknownDesktopError("测试连接失败");
      setSourceConnectionErrors((current) => ({
        ...current,
        [skillId]:
          candidates.length > 1 && shouldTryDerivedGitUrl(displayError)
            ? withDerivedGitUrlSuggestion(displayError)
            : displayError,
      }));
    } finally {
      setActionBusy(null);
    }
  }

  async function fetchIndexedSkills() {
    return listIndexedSkills();
  }

  async function refreshIndexedSkills() {
    setSkills(await fetchIndexedSkills());
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
        ref_: resolvedBindSourceRef(skillId),
        credential_ref: bindDraft.credential_ref.trim() || null,
        trusted: bindDraft.trusted,
        auto_update: bindDraft.auto_update,
      });
      await refreshIndexedSkills();
      clearDetailLocalInstallState(skillId);
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

  function resolvedBindSourceRef(skillId: string) {
    return bindDraft.ref_.trim() || sourceConnectionResults[skillId]?.ref_ || "main";
  }

  async function handleUnbindSource(skillId: string) {
    setActionBusy(`unbind:${skillId}`);
    setActionError(null);
    setActionMessage(null);

    try {
      await unbindSkillSource(skillId);
      await refreshIndexedSkills();
      clearDetailLocalInstallState(skillId);
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
    setHomeCheckCompletionKey(null);

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
      setHomeCheckCompletionKey((current) => (current ?? 0) + 1);
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
    const normalizedDraft = normalizeRemoteSyncDraft(remoteSyncDraft);
    if (normalizedDraft !== remoteSyncDraft) {
      setRemoteSyncDraft(normalizedDraft);
    }
    setActionBusy("remote-sync-preview");
    setActionError(null);
    setRemotePreviewError(null);
    setActionMessage(null);
    setRemotePreview(null);
    setRemoteTargets([]);
    setSelectedRemoteTargetIds([]);
    setRemoteInstallResult(null);

    const candidates = gitUrlTestCandidates(normalizedDraft.url.trim());
    let lastError: DesktopError | null = null;

    try {
      for (const candidate of candidates) {
        try {
          const preview = await previewRemoteSkillSource({
            url: candidate.url,
            repo_path: normalizedDraft.repo_path.trim(),
            ref_: normalizedDraft.ref_.trim(),
          });
          const targets = await getSkillTargetsForSource({
            url: candidate.url,
            repo_path: preview.repo_path === "." ? "" : preview.repo_path,
            ref_: preview.ref_,
            commit: preview.commit,
            install_name: preview.install_name,
          });
          if (!candidate.isOriginal) {
            setRemoteSyncDraft((current) => ({ ...current, url: candidate.url }));
          }
          setRemotePreview(preview);
          setRemoteTargets(targets);
          setSelectedRemoteTargetIds([]);
          return;
        } catch (caught) {
          lastError = desktopError(caught);
          if (!candidate.isOriginal || !shouldTryDerivedGitUrl(lastError)) {
            break;
          }
        }
      }

      const displayError = lastError ?? unknownDesktopError("预览远端 Skill 失败");
      setRemotePreviewError(
        candidates.length > 1 && shouldTryDerivedGitUrl(displayError)
          ? withDerivedGitUrlSuggestion(displayError)
          : displayError,
      );
    } finally {
      setActionBusy(null);
    }
  }

  function resetRemoteSyncState() {
    setRemoteSyncDraft(emptyRemoteSyncDraft());
    setRemotePreview(null);
    setRemotePreviewError(null);
    setRemoteTargets([]);
    setSelectedRemoteTargetIds([]);
    setRemoteInstallResult(null);
    setActionError(null);
    setActionMessage(null);
  }

  function handleSelectAllValidRemoteTargets() {
    const selectableTargetIds = remoteTargets
      .filter(isRemoteTargetSelectable)
      .map((target) => remoteTargetId(target));
    setSelectedRemoteTargetIds((current) => {
      const allSelectableTargetsSelected =
        selectableTargetIds.length > 0 && selectableTargetIds.every((id) => current.includes(id));
      if (allSelectableTargetsSelected) {
        return [];
      }
      return Array.from(new Set([...current, ...selectableTargetIds]));
    });
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
    setRemotePreviewError(null);
    setActionMessage(null);

    try {
      const result = await installRemoteSkillToTargets({
        url: remoteSyncDraft.url.trim(),
        repo_path: remotePreview.repo_path === "." ? "" : remotePreview.repo_path,
        ref_: remotePreview.ref_,
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

  function updateDetailLocalInstallState(
    skillId: string,
    update: DetailLocalInstallStateUpdate,
  ) {
    setDetailLocalInstallStates((current) => {
      const existing = current[skillId] ?? emptyDetailLocalInstallState();
      const patch = typeof update === "function" ? update(existing) : update;
      return {
        ...current,
        [skillId]: {
          ...existing,
          ...patch,
        },
      };
    });
  }

  function beginDetailLocalInstallRequest(skillId: string) {
    detailLocalInstallRequestSequenceRef.current += 1;
    const token = detailLocalInstallRequestSequenceRef.current;
    detailLocalInstallRequestTokensRef.current[skillId] = token;
    return token;
  }

  function isDetailLocalInstallRequestCurrent(skillId: string, token: number) {
    return detailLocalInstallRequestTokensRef.current[skillId] === token;
  }

  function beginDetailLocalInstallOperation(
    skillId: string,
    operation: DetailLocalInstallOperation,
  ) {
    if (detailLocalInstallPendingRef.current[skillId]) {
      return null;
    }
    const token = beginDetailLocalInstallRequest(skillId);
    detailLocalInstallPendingRef.current[skillId] = { operation, token };
    return token;
  }

  function finishDetailLocalInstallOperation(
    skillId: string,
    operation: DetailLocalInstallOperation,
    token: number,
  ) {
    const pending = detailLocalInstallPendingRef.current[skillId];
    if (!pending || pending.operation !== operation || pending.token !== token) {
      return;
    }
    delete detailLocalInstallPendingRef.current[skillId];
    updateDetailLocalInstallState(skillId, {
      targetLoading: false,
      installing: false,
    });
  }

  function clearDetailLocalInstallState(skillId: string) {
    detailLocalInstallRequestSequenceRef.current += 1;
    detailLocalInstallRequestTokensRef.current[skillId] =
      detailLocalInstallRequestSequenceRef.current;
    delete detailLocalInstallPendingRef.current[skillId];
    setDetailLocalInstallStates((current) => {
      const next = { ...current };
      delete next[skillId];
      return next;
    });
  }

  function clearAllDetailLocalInstallStates() {
    detailLocalInstallRequestTokensRef.current = {};
    detailLocalInstallPendingRef.current = {};
    setDetailLocalInstallStates({});
  }

  async function handleLoadDetailTargets(skill: DesktopSkill) {
    const requestToken = beginDetailLocalInstallOperation(skill.id, "targets");
    if (requestToken === null) {
      return;
    }
    const previousState = detailLocalInstallStates[skill.id] ?? emptyDetailLocalInstallState();
    const refreshIndexedSkills = Boolean(previousState.refreshError);
    updateDetailLocalInstallState(skill.id, {
      targetError: null,
      refreshError: refreshIndexedSkills ? null : previousState.refreshError,
      installError: null,
      loaded: false,
      targetLoading: true,
    });

    let indexedRefreshError: DesktopError | null = null;
    try {
      if (refreshIndexedSkills) {
        try {
          const indexedSkills = await fetchIndexedSkills();
          if (!isDetailLocalInstallRequestCurrent(skill.id, requestToken)) {
            return;
          }
          setSkills(indexedSkills);
        } catch (caught) {
          indexedRefreshError = desktopError(caught);
        }
      }
      const targets = await getLocalSkillInstallTargets(skill.id);
      if (!isDetailLocalInstallRequestCurrent(skill.id, requestToken)) {
        return;
      }
      const availableTargetIds = new Set(
        targets
          .filter((target) => target.status === "NotInstalled" && target.root_available)
          .map(remoteTargetId),
      );
      updateDetailLocalInstallState(skill.id, (current) => ({
        targets,
        selectedTargetIds: current.selectedTargetIds.filter((id) =>
          availableTargetIds.has(id),
        ),
        targetError: null,
        refreshError: indexedRefreshError,
        loaded: true,
      }));
    } catch (caught) {
      if (!isDetailLocalInstallRequestCurrent(skill.id, requestToken)) {
        return;
      }
      updateDetailLocalInstallState(skill.id, {
        targetError: desktopError(caught),
        refreshError: indexedRefreshError,
        loaded: true,
      });
    } finally {
      finishDetailLocalInstallOperation(skill.id, "targets", requestToken);
    }
  }

  function toggleDetailTarget(skillId: string, target: DesktopLocalSkillTarget) {
    if (target.status !== "NotInstalled" || !target.root_available) {
      return;
    }
    const id = remoteTargetId(target);
    updateDetailLocalInstallState(skillId, (current) => ({
      selectedTargetIds: current.selectedTargetIds.includes(id)
        ? current.selectedTargetIds.filter((item) => item !== id)
        : [...current.selectedTargetIds, id],
    }));
  }

  function toggleAllDetailTargets(skillId: string) {
    updateDetailLocalInstallState(skillId, (current) => {
      const targetIds = current.targets
        .filter((target) => target.status === "NotInstalled" && target.root_available)
        .map(remoteTargetId);
      const targetIdSet = new Set(targetIds);
      const allSelected =
        targetIds.length > 0 &&
        targetIds.every((id) => current.selectedTargetIds.includes(id));
      return {
        selectedTargetIds: allSelected
          ? current.selectedTargetIds.filter((id) => !targetIdSet.has(id))
          : Array.from(new Set([...current.selectedTargetIds, ...targetIds])),
      };
    });
  }

  async function handleInstallDetailTargets(skill: DesktopSkill) {
    if (detailLocalInstallPendingRef.current[skill.id]) {
      return;
    }
    const state = detailLocalInstallStates[skill.id];
    if (!state?.loaded) {
      return;
    }
    const selectedTargetIds = new Set(state.selectedTargetIds);
    const selectedTargets = state.targets.filter(
      (target) =>
        target.status === "NotInstalled" &&
        target.root_available &&
        selectedTargetIds.has(remoteTargetId(target)),
    );
    if (selectedTargets.length === 0) {
      return;
    }
    const requestToken = beginDetailLocalInstallOperation(skill.id, "install");
    if (requestToken === null) {
      return;
    }

    updateDetailLocalInstallState(skill.id, {
      targetError: null,
      refreshError: null,
      installError: null,
      installResult: null,
      installing: true,
    });

    try {
      const result = await copyLocalSkillToTargets({
        source_skill_id: skill.id,
        targets: selectedTargets.map((target) => ({
          agent_id: target.agent_id,
          agent_name: target.agent_name,
          install_path: target.install_path,
        })),
      });
      if (!isDetailLocalInstallRequestCurrent(skill.id, requestToken)) {
        return;
      }
      const successfulResultsByTargetId = new Map<
        string,
        DesktopCopyLocalSkillResult["targets"][number]
      >(
        result.targets
          .filter((target) => target.status === "Installed")
          .map(
            (target) =>
              [`${target.agent_id}:${target.install_path}`, target] as const,
          ),
      );

      updateDetailLocalInstallState(skill.id, (current) => ({
        installError: null,
        installResult: result,
        selectedTargetIds: current.selectedTargetIds.filter(
          (id) => !successfulResultsByTargetId.has(id),
        ),
        targets: current.targets.map((target) => {
          const successfulResult = successfulResultsByTargetId.get(remoteTargetId(target));
          if (!successfulResult) {
            return target;
          }
          return {
            ...target,
            status: "Installed",
          } satisfies DesktopLocalSkillTarget;
        }),
      }));

      if (successfulResultsByTargetId.size === 0) {
        return;
      }

      let indexedRefreshError: DesktopError | null = null;
      let indexedSkills: DesktopSkill[] | null = null;
      try {
        indexedSkills = await fetchIndexedSkills();
      } catch (caught) {
        indexedRefreshError = desktopError(caught);
      }
      if (!isDetailLocalInstallRequestCurrent(skill.id, requestToken)) {
        return;
      }
      if (indexedSkills) {
        setSkills(indexedSkills);
      }

      try {
        const refreshedTargets = await getLocalSkillInstallTargets(skill.id);
        if (!isDetailLocalInstallRequestCurrent(skill.id, requestToken)) {
          return;
        }
        const remainingNotInstalledIds = new Set(
          refreshedTargets
            .filter((target) => target.status === "NotInstalled" && target.root_available)
            .map(remoteTargetId),
        );
        updateDetailLocalInstallState(skill.id, (current) => ({
          targets: refreshedTargets,
          selectedTargetIds: current.selectedTargetIds.filter((id) =>
            remainingNotInstalledIds.has(id),
          ),
          targetError: null,
          refreshError: indexedRefreshError,
          loaded: true,
        }));
      } catch (caught) {
        if (isDetailLocalInstallRequestCurrent(skill.id, requestToken)) {
          updateDetailLocalInstallState(skill.id, {
            targetError: desktopError(caught),
            refreshError: indexedRefreshError,
          });
        }
      }
    } catch (caught) {
      if (isDetailLocalInstallRequestCurrent(skill.id, requestToken)) {
        updateDetailLocalInstallState(skill.id, {
          installError: desktopError(caught),
        });
      }
    } finally {
      finishDetailLocalInstallOperation(skill.id, "install", requestToken);
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
      let noUpdate = 0;
      let localModifiedSkipped = 0;
      const appliedSkillIds: string[] = [];
      for (const result of results) {
        if (result.local_modified) {
          localModifiedSkipped += 1;
          continue;
        }
        if (result.status !== "UpdateAvailable") {
          noUpdate += 1;
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
      setActionMessage(
        autoUpdateCompletionMessage({
          applied,
          noUpdate,
          localModifiedSkipped,
          policySkipped: skippedByPolicy,
          failed,
        }),
      );
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

  async function handleRemoveAutoUpdateSkill(group: AutoUpdateSourceGroup) {
    const skill = group.representative;
    if (!skill.source) {
      return;
    }

    setActionBusy(`remove-auto-update:${group.sourceKey}`);
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
      setPendingAutoUpdateRemovalSourceKey(null);
      setActionMessage("已移出一键更新列表");
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

    setBackupPanels((current) =>
      current[skill.id] ? { ...current, [skill.id]: false } : current,
    );
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

    setDiffDetails((current) => {
      if (!current[skill.id]) {
        return current;
      }
      const next = { ...current };
      delete next[skill.id];
      return next;
    });
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
  const builtinSettingsAgentRows = settingsAgentRows.filter(
    (row) => !row.agent_id.startsWith("custom-") && row.agent_id !== "generic",
  );
  const savedAgentPathOverrides = agentPathOverrideRecord(settings);
  const dirtyAgentPathIds = new Set(
    builtinSettingsAgentRows
      .filter(
        (row) =>
          normalizeSettingsPath(agentPathOverrideDrafts[row.agent_id] ?? row.path) !==
          normalizeSettingsPath(savedAgentPathOverrides[row.agent_id] ?? row.path),
      )
      .map((row) => row.agent_id),
  );
  const hasUnsavedAgentPathChanges = dirtyAgentPathIds.size > 0;
  const hasCustomMonitorDraftChanges =
    pendingCustomMonitorRemovalIds.size > 0 ||
    Boolean(newCustomMonitorName.trim() && newCustomMonitorPath.trim()) ||
    JSON.stringify(customMonitorDrafts) !==
      JSON.stringify(settings.custom_monitored_paths ?? []);
  const hasSoftwareUpdateDraftChanges =
    softwareUpdateCheckOnStartupDraft !==
    (settings.software_update?.check_on_startup ?? true);
  const hasSettingsDraftChanges =
    hasUnsavedAgentPathChanges ||
    hasCustomMonitorDraftChanges ||
    hasSoftwareUpdateDraftChanges;
  const isSkillDetailView = activeWorkspace === "skills" && skillsViewKind === "detail";
  const handleSkillsRouteKindChange = useCallback((kind: SkillsViewKind) => {
    setSkillsViewKind(kind);
    if (kind !== "add") {
      setRemotePreviewError(null);
    }
  }, []);
  const openSettingsWorkspace = useCallback(() => {
    setSoftwareUpdateCheckMessage(null);
    setSoftwareUpdateCheckError(null);
    setGitEnvironmentResult(null);
    setGitEnvironmentError(null);
    setActiveWorkspace("settings");
  }, []);
  const openSkillsHome = useCallback(() => {
    if (activeWorkspace === "settings") {
      if (hasUnsavedAgentPathChanges) {
        const shouldLeave = window.confirm(
          "内置 Agent 路径尚未保存，离开后将放弃这些修改。确定离开吗？",
        );
        if (!shouldLeave) {
          return false;
        }
        setAgentPathOverrideDrafts(agentPathOverrideRecord(settings));
      }
      setEditingAgentPathId(null);
    }
    setActiveWorkspace("skills");
    setSkillsHomeNavigationKey((current) => current + 1);
    return true;
  }, [activeWorkspace, hasUnsavedAgentPathChanges, settings]);
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
                if (openSkillsHome()) {
                  openMetisGithub();
                }
              }}
            >
              <span className="metis-brand-mark redesign-logo-mark" aria-hidden="true">
                <CrystalSkillLogo testId="metis-brand-crystal-logo" />
              </span>
              <span>
                <MetisBrandWordmark testId="metis-brand-wordmark" />
                <small>Skill Manager</small>
              </span>
            </button>
          </div>
          <nav className="metis-sidebar-nav redesign-side-nav" aria-label="Workspace">
            <button
              aria-pressed={activeWorkspace === "skills"}
              className={activeWorkspace === "skills" ? "active" : ""}
              data-testid="workspace-tab-skills"
              onClick={openSkillsHome}
            >
              <GridIcon />
              Skills
            </button>
            <button
              aria-pressed={activeWorkspace === "settings"}
              className={activeWorkspace === "settings" ? "active" : ""}
              data-testid="workspace-tab-settings-sidebar"
              onClick={openSettingsWorkspace}
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
        <div
          className={`app-shell redesign-main${
            activeWorkspace === "settings" ? " settings-workspace-main" : ""
          }`}
          data-testid="metis-reference-main"
        >
          {!isSkillDetailView && (
            <WorkspaceTopbar
              actionBusy={actionBusy}
              activeWorkspace={activeWorkspace}
              isLoading={state === "loading"}
              skillCount={skills.length}
              skillSearchQuery={skillSearchQuery}
              onCheckAllUpdates={() => handleCheckUpdates(skills.map((skill) => skill.id))}
              onOpenSettings={openSettingsWorkspace}
              onScan={handleScan}
              onSearchChange={setSkillSearchQuery}
            />
          )}

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

      <SoftwareUpdateSurface
        dismissed={softwareUpdateDismissed}
        dialogOpen={softwareUpdateDialogOpen}
        downloadDisabled={softwareUpdateCheckBusy}
        downloadState={softwareUpdateDownloadState}
        info={softwareUpdateInfo}
        openError={softwareUpdateOpenError}
        onCloseDialog={closeSoftwareUpdateDialog}
        onDismiss={() => setSoftwareUpdateDismissed(true)}
        onDownload={() => void handleDownloadSoftwareUpdate()}
        onOpenDownloads={() => void handleOpenDownloadsDirectory()}
        onOpenInstaller={() => void handleOpenSoftwareUpdateInstaller()}
      />

      {activeWorkspace === "settings" && (
        <section className="settings-panel workspace-pane redesign-settings-page" aria-label="配置" data-testid="workspace-settings">
          <section className="settings-section path-management-section" data-testid="settings-section-path-management">
            <div className="path-management-heading">
              <div>
                <h3>内置 Agent 路径管理</h3>
                <p>列出 Metis 当前用于扫描各 Agent skill 的目录，需要调整时点击修改。</p>
              </div>
              <div className="path-status-legend" aria-label="路径状态说明" role="note">
                <span className="path-status-legend-item">
                  <span className="path-status-legend-dot ready" aria-hidden="true" />
                  可读写
                </span>
                <span className="path-status-legend-item">
                  <span className="path-status-legend-dot missing" aria-hidden="true" />
                  路径不存在
                </span>
              </div>
            </div>
            <div className="settings-agent-path-table redesign-agent-path-table" data-testid="settings-agent-path-table">
              {builtinSettingsAgentRows.map((row) => {
                const currentPath = agentPathOverrideDrafts[row.agent_id] ?? row.path;
                const isEditing = editingAgentPathId === row.agent_id;
                const isDirty = dirtyAgentPathIds.has(row.agent_id);
                const statusClass = isDirty ? "pending" : row.exists ? "ready" : "missing";
                const statusLabel = isDirty
                  ? "路径有待保存修改"
                  : row.exists
                    ? "路径可读写"
                    : "路径不存在";
                return (
                  <div
                    className={`settings-agent-path-row redesign-agent-path-row${
                      !isDirty && !row.exists ? " missing" : ""
                    }${isDirty ? " is-dirty" : ""}`}
                    data-testid={`settings-agent-path-${row.agent_id}`}
                    key={row.agent_id}
                  >
                    <span
                      aria-label={`${row.agent_name}，${statusLabel}`}
                      className={statusClass}
                    >
                      {row.agent_name}
                    </span>
                    <input
                      {...textInputAssistanceProps}
                      aria-label={`${row.agent_name} Skill 路径`}
                      data-testid={`agent-path-${row.agent_id}`}
                      readOnly={!isEditing}
                      ref={(input) => {
                        agentPathInputRefs.current[row.agent_id] = input;
                      }}
                      value={currentPath}
                      onChange={(event) =>
                        handleAgentPathDraftChange(row.agent_id, event.target.value)
                      }
                    />
                    <div className="agent-path-row-actions">
                      {isDirty && <small className="agent-path-pending-badge">待保存</small>}
                      <button
                        className={`ghost-button compact agent-path-edit-button metis-action-button metis-action-button--compact${
                          isEditing ? " metis-action-button--neutral" : ""
                        }`}
                        data-testid={`agent-path-${isEditing ? "cancel" : "edit"}-${row.agent_id}`}
                        onClick={() =>
                          isEditing
                            ? cancelAgentPathDraft(row.agent_id)
                            : setEditingAgentPathId(row.agent_id)
                        }
                        type="button"
                      >
                        {isEditing ? "取消" : "修改"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="settings-section custom-monitor-section" data-testid="settings-section-custom-monitors">
            <div>
              <h3>自定义路径管理</h3>
            </div>
            <div className="custom-monitor-list">
              {customMonitorDrafts.length === 0 ? (
                <span className="settings-muted">暂无自定义监控路径</span>
              ) : (
                customMonitorDrafts.map((path) => {
                  const liveStatus = customMonitorPathStatuses[path.id];
                  const savedStatus = settingsAgentRows.find(
                    (row) => row.agent_id === customMonitorAgentId(path.id),
                  );
                  const customPathStatus =
                    liveStatus?.path === path.path
                      ? liveStatus
                      : savedStatus?.path === path.path
                        ? {
                            path: savedStatus.path,
                            scope: "custom",
                            exists: savedStatus.exists,
                            readable: savedStatus.exists,
                            writable: savedStatus.exists,
                          }
                        : null;
                  const isMissingCustomPath = customPathStatus ? !customPathStatus.exists : false;
                  const isPendingRemoval = pendingCustomMonitorRemovalIds.has(path.id);
                  return (
                    <div
                      className={`settings-agent-path-row redesign-agent-path-row custom-monitor-row${
                        isMissingCustomPath ? " missing" : ""
                      }${isPendingRemoval ? " pending-removal" : ""}`}
                      data-testid={`custom-monitor-row-${path.id}`}
                      key={path.id}
                    >
                      <input
                        {...textInputAssistanceProps}
                        aria-label={`${path.name} 名称`}
                        disabled={isPendingRemoval}
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
                        {...textInputAssistanceProps}
                        aria-label={`${path.name} 路径`}
                        disabled={isPendingRemoval}
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
                        className={`ghost-button compact custom-monitor-remove metis-action-button metis-action-button--compact ${
                          isPendingRemoval
                            ? "metis-action-button--neutral"
                            : "metis-action-button--danger"
                        }`}
                        onClick={() =>
                          isPendingRemoval
                            ? restoreCustomMonitor(path.id)
                            : removeCustomMonitor(path.id)
                        }
                        type="button"
                      >
                        {isPendingRemoval ? "撤销" : "移除"}
                      </button>
                      {isPendingRemoval ? (
                        <small className="path-status-pending custom-monitor-status">待删除</small>
                      ) : isMissingCustomPath ? (
                        <small className="path-status-missing custom-monitor-status">
                          路径不存在
                        </small>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
            <div
              className="settings-agent-path-row redesign-agent-path-row custom-monitor-row new-monitor-row"
              data-testid="custom-monitor-new-row"
            >
              <input
                {...textInputAssistanceProps}
                data-testid="custom-monitor-name-new"
                value={newCustomMonitorName}
                placeholder="自定义路径名称"
                onChange={(event) => setNewCustomMonitorName(event.target.value)}
              />
              <input
                {...textInputAssistanceProps}
                data-testid="custom-monitor-path-new"
                value={newCustomMonitorPath}
                placeholder="/Users/me/team-skills"
                onChange={(event) => setNewCustomMonitorPath(event.target.value)}
              />
              <button
                className="ghost-button compact custom-monitor-add metis-action-button metis-action-button--compact"
                data-testid="custom-monitor-add"
                disabled={!newCustomMonitorName.trim() || !newCustomMonitorPath.trim()}
                onClick={addCustomMonitorDraft}
                type="button"
              >
                添加路径
              </button>
            </div>
          </section>

          <section className="settings-section auto-update-section" data-testid="settings-section-auto-update">
            <div className="auto-update-copy">
              <h3>一键更新受信任 Skill</h3>
              <p>仅更新已加入一键更新列表且本地无修改的 Skill。</p>
            </div>
            <div className="auto-update-source-list" data-testid="auto-update-source-list">
              {autoUpdateSourceGroups.length === 0 ? (
                <div className="auto-update-empty-state" data-testid="auto-update-empty-state">
                  <strong>暂无加入一键更新列表的 Skill</strong>
                  <span>在来源设置中加入一键更新列表后，这里会显示可安全更新的 Skill。</span>
                </div>
              ) : (
                autoUpdateSourceGroups.map((group) => {
                  const skill = group.representative;
                  const removeBusy = actionBusy === `remove-auto-update:${group.sourceKey}`;
                  const removalOpen = pendingAutoUpdateRemovalSourceKey === group.sourceKey;
                  return (
                    <div
                      className={`auto-update-source-row${removalOpen ? " is-open" : ""}`}
                      data-testid={`auto-update-source-row-${skill.id}`}
                      key={group.sourceKey}
                    >
                      <div className="auto-update-source-main">
                        <div className="auto-update-source-name-line">
                          <strong className="auto-update-source-name">{skill.name}</strong>
                          <span className="auto-update-trusted-chip">已信任</span>
                        </div>
                        <span className="auto-update-source-url">{skill.source?.url}</span>
                      </div>
                      <div
                        className="auto-update-remove-actions"
                        data-testid={`auto-update-remove-actions-${skill.id}`}
                      >
                        <button
                          className="auto-update-remove"
                          data-testid={`remove-auto-update-${skill.id}`}
                          disabled={removeBusy}
                          onClick={() => setPendingAutoUpdateRemovalSourceKey(group.sourceKey)}
                          type="button"
                        >
                          移出列表
                        </button>
                      </div>
                      {removalOpen ? (
                        <div
                          className="auto-update-remove-confirm"
                          data-testid={`auto-update-remove-confirm-${skill.id}`}
                        >
                          <div className="auto-update-remove-confirm-copy">
                            <strong>移出一键更新列表？</strong>
                            <span>不会删除本地 Skill，只会停止通过一键更新处理这个来源。</span>
                          </div>
                          <div className="auto-update-remove-confirm-actions">
                            <button
                              className="auto-update-cancel metis-action-button metis-action-button--compact metis-action-button--neutral"
                              data-testid={`cancel-remove-auto-update-${skill.id}`}
                              disabled={removeBusy}
                              onClick={() => setPendingAutoUpdateRemovalSourceKey(null)}
                              type="button"
                            >
                              取消
                            </button>
                            <button
                              aria-busy={removeBusy}
                              className={`auto-update-confirm metis-action-button metis-action-button--compact metis-action-button--danger${
                                removeBusy ? " is-busy" : ""
                              }`}
                              data-testid={`confirm-remove-auto-update-${skill.id}`}
                              disabled={removeBusy}
                              onClick={() => handleRemoveAutoUpdateSkill(group)}
                              type="button"
                            >
                              {removeBusy ? (
                                <>
                                  <span className="metis-action-spinner" aria-hidden="true" />
                                  正在移出
                                </>
                              ) : (
                                "确认移出"
                              )}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
            <button
              aria-busy={actionBusy === "auto-update"}
              className={`auto-update-run metis-action-button${
                actionBusy === "auto-update" ? " is-busy" : ""
              }`}
              data-testid="run-auto-update"
              disabled={actionBusy === "auto-update" || skills.length === 0}
              onClick={handleRunAutoUpdate}
            >
              {actionBusy === "auto-update" ? (
                <>
                  <span className="metis-action-spinner" aria-hidden="true" />
                  正在检查并更新
                </>
              ) : (
                "立即更新"
              )}
            </button>
          </section>

          <section className="settings-section git-health-section" data-testid="settings-section-git-health">
            <div className="settings-git-health-heading">
              <h3>本机Git 检测</h3>
              <button
                aria-busy={actionBusy === "git-environment"}
                className={`settings-git-test-button metis-action-button${
                  actionBusy === "git-environment" ? " is-busy" : ""
                }`}
                data-testid="test-git-environment"
                disabled={actionBusy === "git-environment"}
                onClick={handleTestGitEnvironment}
                type="button"
              >
                {actionBusy === "git-environment" ? (
                  <>
                    <span className="metis-action-spinner" aria-hidden="true" />
                    正在检测
                  </>
                ) : (
                  "检测"
                )}
              </button>
            </div>
            <div className="settings-git-health-card">
              {gitEnvironmentResult && (
                <div className="settings-git-health-result success" data-testid="git-environment-result">
                  <strong>{gitEnvironmentResult.message}</strong>
                  <span>{gitEnvironmentResult.version}</span>
                </div>
              )}
              {gitEnvironmentError && (
                <div
                  className="settings-git-health-notice"
                  data-testid="git-environment-notice"
                  role="status"
                >
                  <span>{gitEnvironmentNoticeText(gitEnvironmentError)}</span>
                </div>
              )}
            </div>
          </section>

          <section
            className="settings-section software-update-settings-section"
            data-testid="settings-section-software-update"
          >
            <div className="software-update-settings-copy">
              <h3>Metis 软件更新</h3>
              <p>启动时自动检查新版本；发现新版后由你确认下载和安装。</p>
            </div>
            <div className="software-update-settings-controls">
              <span className="software-update-current-version">
                当前版本 <strong>{desktopPackage.version}</strong>
              </span>
              <label className="software-update-startup-toggle">
                <input
                  checked={softwareUpdateCheckOnStartupDraft}
                  data-testid="software-update-check-on-startup"
                  onChange={(event) =>
                    setSoftwareUpdateCheckOnStartupDraft(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>启动时检查</span>
              </label>
              <button
                aria-busy={softwareUpdateCheckBusy}
                className={`software-update-check-button metis-action-button${
                  softwareUpdateCheckBusy ? " is-busy" : ""
                }`}
                data-testid="check-software-update"
                disabled={
                  softwareUpdateCheckBusy ||
                  ["downloading", "verifying", "saving"].includes(
                    softwareUpdateDownloadState.phase,
                  )
                }
                onClick={() => void handleCheckSoftwareUpdate("manual")}
                type="button"
              >
                {softwareUpdateCheckBusy ? (
                  <>
                    <span className="metis-action-spinner" aria-hidden="true" />
                    正在检查
                  </>
                ) : (
                  "检查更新"
                )}
              </button>
            </div>
            <div
              className="software-update-settings-feedback"
              data-testid="software-update-settings-feedback"
            >
              {softwareUpdateCheckBusy ? null : softwareUpdateCheckError ? (
                <div className="software-update-check-error" role="alert">
                  <span>{softwareUpdateCheckError}</span>
                  <button
                    className="metis-action-button metis-action-button--compact metis-action-button--danger metis-action-button--context"
                    onClick={() => void handleCheckSoftwareUpdate("manual")}
                    type="button"
                  >
                    重试
                  </button>
                </div>
              ) : softwareUpdateCheckMessage ? (
                <div className="software-update-check-result" role="status">
                  {softwareUpdateCheckMessage}
                </div>
              ) : null}
            </div>
          </section>

          <div className="form-actions settings-save-actions">
            <button
              aria-busy={actionBusy === "settings"}
              className={`settings-save-button metis-action-button metis-action-button--primary${
                actionBusy === "settings" ? " is-busy" : ""
              }`}
              data-testid="settings-save"
              disabled={actionBusy === "settings" || !hasSettingsDraftChanges}
              onClick={() => handleSaveSettings(true)}
            >
              {actionBusy === "settings" ? (
                <>
                  <span className="metis-action-spinner" aria-hidden="true" />
                  正在保存
                </>
              ) : (
                "保存"
              )}
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
          detailLocalInstallStates={detailLocalInstallStates}
          diffDetails={diffDetails}
          diffError={diffError}
          error={error}
          remoteInstallResult={remoteInstallResult}
          remotePreview={remotePreview}
          remotePreviewError={remotePreviewError}
          remoteSyncDraft={remoteSyncDraft}
          remoteTargets={remoteTargets}
          selectedRemoteTargetIds={selectedRemoteTargetIds}
          homeNavigationKey={skillsHomeNavigationKey}
          homeCheckCompletionKey={homeCheckCompletionKey}
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
          onInstallDetailTargets={handleInstallDetailTargets}
          onInstallRemoteTargets={handleInstallRemoteTargets}
          onLoadDetailTargets={handleLoadDetailTargets}
          onLoadSkillAuditEvents={loadSkillAuditEvents}
          onLoadSkillSize={loadSkillSize}
          onOpenBind={openBindForm}
          onOpenSettings={openSettingsWorkspace}
          onPreviewRemoteSync={handlePreviewRemoteSync}
          onResetRemoteSync={resetRemoteSyncState}
          onRestoreBackup={handleRestoreBackup}
          onScan={handleScan}
          onSetRemoteSyncDraft={setRemoteSyncDraft}
          onRouteKindChange={handleSkillsRouteKindChange}
          onSelectAllValidRemoteTargets={handleSelectAllValidRemoteTargets}
          onSelectAllDetailTargets={toggleAllDetailTargets}
          onToggleDetailDiff={handleToggleDetailDiff}
          onToggleDiff={handleToggleDiff}
          onToggleDetailTarget={toggleDetailTarget}
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

function groupAutoUpdateSkillsBySource(skills: DesktopSkill[]): AutoUpdateSourceGroup[] {
  const groups = new Map<string, AutoUpdateSourceGroup>();
  for (const skill of skills) {
    const source = skill.source;
    if (!source) {
      continue;
    }
    const sourceKey =
      skill.source_id?.trim() ||
      source.id.trim() ||
      `source\u0000${source.url}\u0000${source.repo_path}\u0000${source.ref_}`;
    const existing = groups.get(sourceKey);
    if (existing) {
      existing.members.push(skill);
      continue;
    }
    groups.set(sourceKey, {
      sourceKey,
      representative: skill,
      members: [skill],
    });
  }
  return Array.from(groups.values());
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
    return "请先为 Skill 绑定 Git 来源，再开启「信任此来源并加入一键更新列表」。";
  }

  if (autoUpdateSourceCount === 0) {
    return "请先在来源里开启「信任此来源并加入一键更新列表」。";
  }

  if (blockedByLocalChanges) {
    return "候选 Skill 都有本地修改，请先检查或手动处理本地修改。";
  }

  return "请确认 Skill 已加入一键更新列表，且本地没有修改。";
}

function isAutoUpdateUnavailableMessage(message: string | null) {
  return (
    message === "请先为 Skill 绑定 Git 来源，再开启「信任此来源并加入一键更新列表」。" ||
    message === "请先在来源里开启「信任此来源并加入一键更新列表」。" ||
    message === "候选 Skill 都有本地修改，请先检查或手动处理本地修改。" ||
    message === "请确认 Skill 已加入一键更新列表，且本地没有修改。"
  );
}

function autoUpdateCompletionMessage({
  applied,
  noUpdate,
  localModifiedSkipped,
  policySkipped,
  failed,
}: {
  applied: number;
  noUpdate: number;
  localModifiedSkipped: number;
  policySkipped: number;
  failed: number;
}) {
  const parts = [`自动更新完成：已更新 ${applied} 个`];
  if (noUpdate > 0) {
    parts.push(`无需更新 ${noUpdate} 个`);
  }
  if (localModifiedSkipped > 0) {
    parts.push(`因本地修改跳过 ${localModifiedSkipped} 个`);
  }
  if (policySkipped > 0) {
    parts.push(`因策略跳过 ${policySkipped} 个`);
  }
  if (failed > 0) {
    parts.push(`失败 ${failed} 个`);
  }
  return parts.join("，");
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

function emptyRemoteSyncDraft(): RemoteSyncDraft {
  return {
    url: "",
    repo_path: "",
    ref_: "",
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

function agentPathOverrideRecord(settings: DesktopSettings) {
  return Object.fromEntries(
    (settings.agent_path_overrides ?? []).map((overridePath) => [
      overridePath.agent_id,
      overridePath.path,
    ]),
  );
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

const unsafeSavedInstallerMessage = "安装包安全检查未通过，请删除该文件并重新下载。";
const softwareUpdateSecurityMessages = new Map<string, string>([
  [
    "安装包校验失败，已停止下载，请勿安装该文件。",
    "安装包校验失败，已停止下载，请勿安装该文件。",
  ],
  ["安装包校验失败，请重新下载。", "安装包校验失败，请重新下载。"],
  [
    "安装包内容已发生变化，请删除该文件并重新下载。",
    "安装包内容已发生变化，请删除该文件并重新下载。",
  ],
  ["安装包安全检查未完成，请重新下载。", "安装包安全检查未完成，请重新下载。"],
  ["安装包已被移动或删除，请重新下载。", "安装包已被移动或删除，请重新下载。"],
  ["已下载的安装包不是普通文件。", unsafeSavedInstallerMessage],
  ["已下载的安装包文件名无效。", unsafeSavedInstallerMessage],
  ["已下载的安装包没有父目录。", unsafeSavedInstallerMessage],
  ["拒绝打开 Downloads 目录之外的文件。", unsafeSavedInstallerMessage],
]);

function softwareUpdateErrorMessage(caught: unknown, fallback: string): string {
  const error = desktopError(caught);
  for (const candidate of [error.message, error.debug_detail]) {
    const message = candidate?.trim();
    if (message) {
      const securityMessage = softwareUpdateSecurityMessages.get(message);
      if (securityMessage) {
        return securityMessage;
      }
    }
  }
  return fallback;
}

function gitEnvironmentNoticeText(error: DesktopError): string {
  const detail = `${error.debug_detail ?? ""} ${error.message}`.toLowerCase();
  if (
    detail.includes("no such file") ||
    detail.includes("os error 2") ||
    detail.includes("command not found") ||
    detail.includes("not found") ||
    detail.includes("找不到")
  ) {
    return "本机未安装Git";
  }
  return "Git 可启动，但本地 clone/fetch 命令自检失败，请自行确认";
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

function shouldTryDerivedGitUrl(error: DesktopError): boolean {
  return !["git_ref", "git_url", "repo_path", "ssh_host_key"].includes(error.category);
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
    message: "操作没有完成，请稍后重试。",
    suggestion: "如果仍然失败，请重新打开 Metis 后再试。",
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
  settings: { eyebrow: "Settings", title: "应用设置" },
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
    <header
      className={`topbar redesign-page-topbar${activeWorkspace === "settings" ? " settings-topbar" : ""}`}
      data-testid="workspace-topbar"
    >
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
                {...textInputAssistanceProps}
                data-testid="skill-search-input"
                placeholder="搜索 skill、路径或来源"
                value={skillSearchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </label>
          )}
        </div>
        <div className="redesign-top-actions" data-testid="workspace-topbar-actions">
          {activeWorkspace === "skills" && (
            <button
              aria-busy={actionBusy === "check-updates"}
              className={`ghost-button topbar-secondary-action metis-action-button${
                actionBusy === "check-updates" ? " is-busy" : ""
              }`}
              data-testid="check-all-updates"
              disabled={isLoading || actionBusy === "check-updates" || skillCount === 0}
              onClick={onCheckAllUpdates}
            >
              {actionBusy === "check-updates" ? (
                <>
                  <span className="metis-action-spinner" aria-hidden="true" />
                  正在检查
                </>
              ) : (
                "检查全部 Skill"
              )}
            </button>
          )}
          <button
            aria-busy={isLoading}
            className={`scan-button metis-action-button${isLoading ? " is-busy" : ""}`}
            data-testid="scan-skills"
            disabled={isLoading}
            onClick={onScan}
          >
            {isLoading ? (
              <>
                <span className="metis-action-spinner" aria-hidden="true" />
                正在扫描
              </>
            ) : (
              "重新扫描"
            )}
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
