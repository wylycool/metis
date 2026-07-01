import { useEffect, useRef, useState } from "react";
import {
  applySkillUpdate,
  bindSkillSource,
  checkTeamManifestCompliance,
  checkSkillUpdates,
  exportAuditLogReportToFile,
  exportEnvironmentReport,
  exportEnvironmentReportToFile,
  exportTeamComplianceReportToFile,
  getSkillDiff,
  getDesktopSettings,
  getSkillTargetsForSource,
  getTeamPolicyAuditReport,
  getTeamPolicySummary,
  installRemoteSkillToTargets,
  listSkillBackups,
  listAgents,
  listIndexedSkills,
  loadTeamManifestFromFile,
  previewRemoteSkillSource,
  restoreSkillBackup,
  saveDesktopSettings,
  scanSkills,
  unbindSkillSource,
} from "./api";
import type { RemoteSyncDraft } from "./AddSkillPage";
import { remoteTargetId, SkillsWorkspace } from "./SkillsWorkspace";
import { InlineError, type BindDraft } from "./SkillRow";
import { UiRedesignPreview } from "./UiRedesignPreview";
import type {
  DesktopAgentStatus,
  DesktopBackupSummary,
  DesktopDiffDetail,
  DesktopError,
  DesktopEnvironmentReport,
  DesktopInstallRemoteSkillResult,
  DesktopRemoteSkillPreview,
  DesktopScanWarning,
  DesktopSettings,
  DesktopSkill,
  DesktopSource,
  DesktopSkillTarget,
  DesktopTeamManifestComplianceReport,
  DesktopTeamManifestComplianceItem,
  DesktopTeamPolicyAuditReport,
  DesktopTeamPolicyAuditItem,
  DesktopTeamPolicySummary,
  DesktopUpdateCheckResult,
  LoadState,
} from "./types";

type WorkspaceKey = "skills" | "governance" | "settings";
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
  const [backupPanels, setBackupPanels] = useState<Record<string, boolean>>({});
  const [backups, setBackups] = useState<Record<string, DesktopBackupSummary[]>>({});
  const [backupError, setBackupError] = useState<Record<string, DesktopError>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<DesktopSettings>({
    custom_scan_paths: [],
    team_policy_path: null,
    enterprise_network: emptyEnterpriseNetworkSettings(),
  });
  const [settingsDraft, setSettingsDraft] = useState("");
  const [teamPolicyPathDraft, setTeamPolicyPathDraft] = useState("");
  const [enterpriseProxyUrlDraft, setEnterpriseProxyUrlDraft] = useState("");
  const [enterpriseNoProxyDraft, setEnterpriseNoProxyDraft] = useState("");
  const [enterpriseCaBundlePathDraft, setEnterpriseCaBundlePathDraft] = useState("");
  const [teamPolicySummary, setTeamPolicySummary] = useState<DesktopTeamPolicySummary | null>(
    null,
  );
  const [teamPolicyAuditReport, setTeamPolicyAuditReport] =
    useState<DesktopTeamPolicyAuditReport | null>(null);
  const [bindingSkillId, setBindingSkillId] = useState<string | null>(null);
  const [bindDraft, setBindDraft] = useState<BindDraft>(emptyBindDraft());
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
  const [detailTargets, setDetailTargets] = useState<Record<string, DesktopSkillTarget[]>>({});
  const [detailTargetErrors, setDetailTargetErrors] = useState<Record<string, DesktopError>>({});
  const [selectedDetailTargetIds, setSelectedDetailTargetIds] = useState<Record<string, string[]>>(
    {},
  );
  const [detailInstallResults, setDetailInstallResults] = useState<
    Record<string, DesktopInstallRemoteSkillResult>
  >({});
  const totalExistingPaths = agents.reduce(
    (count, agent) => count + agent.paths.filter((path) => path.exists).length,
    0,
  );
  const modifiedCount = skills.filter((skill) => skill.local_modified).length;
  const boundCount = skills.filter((skill) => skill.source).length;
  const trustedSourceCount = skills.filter((skill) => skill.source?.trusted).length;
  const autoUpdateCount = skills.filter((skill) => skill.source?.auto_update).length;
  const trustedAutoUpdateSkills = skills.filter(
    (skill) => skill.source?.trusted && skill.source.auto_update && skill.local_modified !== true,
  );
  const [environmentReport, setEnvironmentReport] = useState<DesktopEnvironmentReport | null>(
    null,
  );
  const [teamManifestDraft, setTeamManifestDraft] = useState("");
  const [teamManifestFilePath, setTeamManifestFilePath] = useState("");
  const [teamComplianceExportPath, setTeamComplianceExportPath] = useState("");
  const [environmentReportExportPath, setEnvironmentReportExportPath] = useState("");
  const [auditLogExportPath, setAuditLogExportPath] = useState("");
  const [teamComplianceReport, setTeamComplianceReport] =
    useState<DesktopTeamManifestComplianceReport | null>(null);
  const didBootstrap = useRef(false);

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
      setTeamPolicyPathDraft(settingsResult.team_policy_path ?? "");
      syncEnterpriseNetworkDrafts(settingsResult);

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
      setActionMessage("已重新扫描本机 skill 路径");
    } catch (caught) {
      setError(desktopError(caught));
      setState("error");
    }
  }

  function settingsRequestFromDrafts(): DesktopSettings {
    return {
      custom_scan_paths: settingsDraft.split("\n"),
      team_policy_path: teamPolicyPathDraft.trim() || null,
      enterprise_network: {
        proxy_url: enterpriseProxyUrlDraft.trim() || null,
        no_proxy: enterpriseNoProxyDraft.trim() || null,
        certificate_authority_bundle_path: enterpriseCaBundlePathDraft.trim() || null,
      },
    };
  }

  function syncEnterpriseNetworkDrafts(nextSettings: DesktopSettings) {
    const network = nextSettings.enterprise_network ?? emptyEnterpriseNetworkSettings();
    setEnterpriseProxyUrlDraft(network.proxy_url ?? "");
    setEnterpriseNoProxyDraft(network.no_proxy ?? "");
    setEnterpriseCaBundlePathDraft(network.certificate_authority_bundle_path ?? "");
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
      setError(desktopError(caught));
      setState("error");
    }
  }

  async function handleSaveSettings(scanAfterSave: boolean) {
    setActionBusy("settings");
    setActionError(null);
    setActionMessage(null);

    try {
      const saved = await saveDesktopSettings({
        ...settingsRequestFromDrafts(),
      });
      setSettings(saved);
      setSettingsDraft(saved.custom_scan_paths.join("\n"));
      setTeamPolicyPathDraft(saved.team_policy_path ?? "");
      syncEnterpriseNetworkDrafts(saved);
      setTeamPolicySummary(null);
      setTeamPolicyAuditReport(null);
      setActionMessage("设置已保存");
      if (scanAfterSave) {
        await handleScan();
      } else {
        setAgents(await listAgents());
      }
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  function removeCustomPath(path: string) {
    const nextPaths = settings.custom_scan_paths.filter((item) => item !== path);
    const nextDraft = nextPaths.join("\n");
    setSettings({ ...settings, custom_scan_paths: nextPaths });
    setSettingsDraft(nextDraft);
  }

  function openBindForm(skill: DesktopSkill) {
    const source = skill.source ?? reusableSourceForSkill(skill);
    setBindingSkillId(skill.id);
    setActionError(null);
    setBindDraft({
      url: source?.url ?? "",
      repo_path: source?.repo_path ?? "",
      ref_: source?.ref_ ?? "main",
      credential_ref: source?.credential_ref ?? "",
      trusted: source?.trusted ?? false,
      auto_update: source?.auto_update ?? false,
    });
  }

  async function handlePreviewTeamPolicy() {
    setActionBusy("team-policy");
    setActionError(null);
    setActionMessage(null);

    try {
      if (teamPolicyPathDraft.trim() !== (settings.team_policy_path ?? "")) {
        const saved = await saveDesktopSettings({
          ...settingsRequestFromDrafts(),
        });
        setSettings(saved);
        setSettingsDraft(saved.custom_scan_paths.join("\n"));
        setTeamPolicyPathDraft(saved.team_policy_path ?? "");
        syncEnterpriseNetworkDrafts(saved);
      }
      const summary = await getTeamPolicySummary();
      setTeamPolicySummary(summary);
      setTeamPolicyAuditReport(null);
      setActionMessage(summary ? "团队策略已载入" : "未配置团队策略文件");
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleRunTeamPolicyAudit() {
    setActionBusy("team-policy-audit");
    setActionError(null);
    setActionMessage(null);

    try {
      if (teamPolicyPathDraft.trim() !== (settings.team_policy_path ?? "")) {
        const saved = await saveDesktopSettings({
          ...settingsRequestFromDrafts(),
        });
        setSettings(saved);
        setSettingsDraft(saved.custom_scan_paths.join("\n"));
        setTeamPolicyPathDraft(saved.team_policy_path ?? "");
        syncEnterpriseNetworkDrafts(saved);
      }
      const report = await getTeamPolicyAuditReport();
      setTeamPolicyAuditReport(report);
      setActionMessage("策略审计已生成");
    } catch (caught) {
      setActionError(desktopError(caught));
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
      await refreshIndexedSkills();
      const updateCount = results.filter((result) => result.status === "UpdateAvailable").length;
      setActionMessage(`检查完成：${updateCount} 个 skill 待更新`);
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleCheckDetailUpdates(skill: DesktopSkill) {
    setActionBusy("check-updates");
    setActionError(null);
    setActionMessage(null);

    try {
      const readySkill = await ensureReusableSourceBound(skill);
      if (!readySkill.source) {
        const results = await checkSkillUpdates({ skill_ids: [skill.id] });
        setUpdateResults((current) => ({ ...current, [skill.id]: results[0] }));
        return;
      }
      const results = await checkSkillUpdates({ skill_ids: [readySkill.id] });
      setUpdateResults((current) => {
        const next = { ...current };
        for (const result of results) {
          next[result.skill_id] = result;
        }
        return next;
      });
      setDiffError({});
      await refreshIndexedSkills();
      setActionMessage("检查完成：远端更新状态已刷新");
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

  async function loadDetailTargets(skill: DesktopSkill) {
    const source = skill.source ?? reusableSourceForSkill(skill);
    if (!source) {
      return;
    }

    setActionBusy(`detail-targets:${skill.id}`);
    setActionError(null);
    setDetailTargetErrors((current) => {
      const next = { ...current };
      delete next[skill.id];
      return next;
    });

    try {
      const preview = await previewRemoteSkillSource({
        url: source.url,
        repo_path: source.repo_path,
        ref_: source.ref_ || "main",
      });
      const targets = await getSkillTargetsForSource({
        url: source.url,
        repo_path: preview.repo_path === "." ? "" : preview.repo_path,
        ref_: source.ref_ || "main",
        commit: preview.commit,
        install_name: preview.install_name,
      });
      setDetailTargets((current) => ({ ...current, [skill.id]: targets }));
      setSelectedDetailTargetIds((current) => ({ ...current, [skill.id]: [] }));
    } catch (caught) {
      setDetailTargetErrors((current) => ({ ...current, [skill.id]: desktopError(caught) }));
    } finally {
      setActionBusy(null);
    }
  }

  function toggleDetailTarget(skillId: string, target: DesktopSkillTarget) {
    const id = remoteTargetId(target);
    setSelectedDetailTargetIds((current) => {
      const selected = current[skillId] ?? [];
      return {
        ...current,
        [skillId]: selected.includes(id)
          ? selected.filter((item) => item !== id)
          : [...selected, id],
      };
    });
  }

  async function handleInstallDetailTargets(skill: DesktopSkill) {
    const source = skill.source ?? reusableSourceForSkill(skill);
    if (!source || !detailTargets[skill.id]) {
      return;
    }
    const selectedIds = selectedDetailTargetIds[skill.id] ?? [];
    const selectedTargets = detailTargets[skill.id].filter((target) =>
      selectedIds.includes(remoteTargetId(target)),
    );
    if (selectedTargets.length === 0) {
      return;
    }

    setActionBusy(`detail-install:${skill.id}`);
    setActionError(null);
    setActionMessage(null);

    try {
      const preview = await previewRemoteSkillSource({
        url: source.url,
        repo_path: source.repo_path,
        ref_: source.ref_ || "main",
      });
      const result = await installRemoteSkillToTargets({
        url: source.url,
        repo_path: preview.repo_path === "." ? "" : preview.repo_path,
        ref_: source.ref_ || "main",
        commit: preview.commit,
        install_name: preview.install_name,
        targets: selectedTargets.map((target) => ({
          agent_id: target.agent_id,
          agent_name: target.agent_name,
          install_path: target.install_path,
        })),
      });
      setDetailInstallResults((current) => ({ ...current, [skill.id]: result }));
      setActionMessage("跨 Agent 同步已完成");
      await refreshIndexedSkills();
      setDetailTargets((current) => {
        const next = { ...current };
        delete next[skill.id];
        return next;
      });
      await loadDetailTargets(skill);
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

  async function handleExportEnvironmentReport() {
    setActionBusy("environment-report");
    setActionError(null);
    setActionMessage(null);

    try {
      const report = await exportEnvironmentReport();
      setEnvironmentReport(report);
      setActionMessage("环境报告已生成");
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleExportEnvironmentReportToFile() {
    setActionBusy("environment-report-file");
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await exportEnvironmentReportToFile(environmentReportExportPath.trim());
      setActionMessage(`环境报告已写出：${result.output_path}`);
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleLoadTeamManifestFromFile() {
    setActionBusy("team-manifest-file");
    setActionError(null);
    setActionMessage(null);

    try {
      const manifest = await loadTeamManifestFromFile(teamManifestFilePath.trim());
      setTeamManifestDraft(manifest);
      setTeamComplianceReport(null);
      setActionMessage("团队清单文件已载入");
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleCheckTeamCompliance() {
    setActionBusy("team-compliance");
    setActionError(null);
    setActionMessage(null);

    try {
      const report = await checkTeamManifestCompliance({
        manifest_json: teamManifestDraft.trim(),
      });
      setTeamComplianceReport(report);
      setActionMessage("团队合规报告已生成");
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleExportTeamComplianceReport() {
    if (!teamComplianceReport) {
      return;
    }

    setActionBusy("team-compliance-export");
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await exportTeamComplianceReportToFile({
        output_path: teamComplianceExportPath.trim(),
        report: teamComplianceReport,
      });
      setActionMessage(`团队合规报告已写出：${result.output_path}`);
    } catch (caught) {
      setActionError(desktopError(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function handleExportAuditLogReport() {
    setActionBusy("audit-log-export");
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await exportAuditLogReportToFile({
        output_path: auditLogExportPath.trim(),
        limit: 200,
        offset: 0,
      });
      setActionMessage(`审计日志已写出：${result.output_path}`);
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
        setActionMessage(`受控自动更新完成：已更新 0 个，跳过 ${skippedByPolicy} 个`);
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
      for (const result of results) {
        if (result.status !== "UpdateAvailable" || result.local_modified) {
          continue;
        }
        try {
          await applySkillUpdate(result.skill_id);
          applied += 1;
          clearSkillRuntimeState(result.skill_id);
        } catch {
          failed += 1;
        }
      }

      await refreshIndexedSkills();
      const skipped =
        skippedByPolicy +
        results.filter((result) => result.status !== "UpdateAvailable" || result.local_modified)
          .length;
      const failureText = failed > 0 ? `，失败 ${failed} 个` : "";
      setActionMessage(`受控自动更新完成：已更新 ${applied} 个，跳过 ${skipped} 个${failureText}`);
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

  async function handleToggleDetailDiff(skill: DesktopSkill) {
    if (diffDetails[skill.id]) {
      setDiffDetails((current) => {
        const next = { ...current };
        delete next[skill.id];
        return next;
      });
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
      const result = await restoreSkillBackup({ skill_id: skillId, backup_id: backupId });
      setActionMessage(
        `已回滚到 ${result.restored_from_backup_id}，回滚前状态已备份为 ${result.previous_state_backup_id}`,
      );
      clearSkillRuntimeState(skillId);
      setBackupPanels((current) => ({ ...current, [skillId]: true }));
      await refreshIndexedSkills();
      await loadBackups(skillId);
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

  const settingsAgentRows = agentPathRows(agents);
  const isSkillDetailView = activeWorkspace === "skills" && skillsViewKind === "detail";

  return (
    <div className="metis-window redesign-preview-shell" data-theme="frost">
      <div className="metis-shell redesign-app-window" data-testid="metis-reference-shell">
        <aside className="metis-sidebar redesign-sidebar" data-testid="metis-reference-sidebar">
          <button
            className="metis-sidebar-brand redesign-brand"
            data-testid="metis-brand-home"
            aria-label="打开 Metis GitHub 主页"
            onClick={() => {
              setActiveWorkspace("skills");
              if (navigator.userAgent.toLowerCase().includes("jsdom")) {
                return;
              }
              try {
                window.open("https://github.com/example/metis", "_blank", "noopener,noreferrer");
              } catch {
                // jsdom does not implement window.open; the app still returns home.
              }
            }}
          >
            <span className="metis-brand-mark redesign-logo-mark" aria-hidden="true">
              <span>M</span>
            </span>
            <span>
              <strong>Metis</strong>
              <small>Skill Manager</small>
            </span>
          </button>
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
              aria-pressed={activeWorkspace === "governance"}
              className={activeWorkspace === "governance" ? "active" : ""}
              data-testid="workspace-tab-governance-sidebar"
              onClick={() => setActiveWorkspace("governance")}
            >
              <RefreshIcon />
              Updates
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
          <div className="metis-sidebar-status redesign-side-summary">
            <span>Local library</span>
            <strong>{skills.length} skills</strong>
            <small>{agents.length} agents · {trustedSourceCount} trusted sources · {totalExistingPaths} ready paths</small>
          </div>
        </aside>
        <div className="app-shell redesign-main">
          {!isSkillDetailView && <header className="topbar redesign-page-topbar">
            <div className="topbar-title">
              <p>{activeWorkspace === "settings" ? "Settings" : activeWorkspace === "governance" ? "Updates" : "Skill Dashboard"}</p>
              <h1>{activeWorkspace === "settings" ? "Agent 路径设置" : activeWorkspace === "governance" ? "更新与治理" : "Skills"}</h1>
            </div>
            <div className="topbar-actions">
              {activeWorkspace === "skills" && (
                <label className="topbar-search redesign-search-field" aria-label="搜索 skills">
                  <SearchIcon />
                  <input
                    data-testid="skill-search-input"
                    placeholder="搜索 skill、路径或来源"
                    value={skillSearchQuery}
                    onChange={(event) => setSkillSearchQuery(event.target.value)}
                  />
                  <span>{skills.length} results</span>
                </label>
              )}
              <div className="redesign-top-actions">
              <button
                className="ghost-button topbar-secondary-action"
                data-testid="check-all-updates"
                disabled={
                  state === "loading" || actionBusy === "check-updates" || skills.length === 0
                }
                onClick={() => handleCheckUpdates(skills.map((skill) => skill.id))}
              >
                {actionBusy === "check-updates" ? "检查中" : "检查更新"}
              </button>
              <button
                className="scan-button"
                data-testid="scan-skills"
                disabled={state === "loading"}
                onClick={handleScan}
              >
                {state === "loading" ? "扫描中" : "重新扫描"}
              </button>
              </div>
              <button
                aria-label="Settings"
                aria-pressed={activeWorkspace === "settings"}
                className="settings-icon-button"
                data-testid="workspace-tab-settings"
                onClick={() => setActiveWorkspace("settings")}
              >
                <span aria-hidden="true" />
              </button>
            </div>
          </header>}

          <nav className="workspace-tabs" aria-hidden="true" hidden>
            <WorkspaceTab
              active={activeWorkspace === "skills"}
              count={skills.length}
              label="Skills"
              testId="workspace-tab-skills-legacy"
              onClick={() => setActiveWorkspace("skills")}
            />
            <WorkspaceTab
              active={activeWorkspace === "governance"}
              count={boundCount}
              label="Governance"
              testId="workspace-tab-governance-legacy"
              onClick={() => setActiveWorkspace("governance")}
            />
            <WorkspaceTab
              active={activeWorkspace === "settings"}
              label="Settings"
              testId="workspace-tab-settings-legacy"
              onClick={() => setActiveWorkspace("settings")}
            />
          </nav>

      {activeWorkspace !== "skills" && (
        <section className="summary-strip" aria-label="扫描摘要">
          <SummaryMetric label="已发现 skills" value={skills.length.toString()} />
          <SummaryMetric label="已绑定来源" value={boundCount.toString()} />
          <SummaryMetric label="存在的路径" value={totalExistingPaths.toString()} />
          <SummaryMetric label="本地修改" value={modifiedCount.toString()} />
        </section>
      )}

      {actionError && <InlineError error={actionError} />}
      {actionMessage && (
        <div className="redesign-toast" data-testid="redesign-toast">
          {actionMessage}
        </div>
      )}

      {activeWorkspace === "governance" && (
        <section className="workspace-pane" data-testid="workspace-governance">
          <section className="beta-panel" aria-label="Beta 稳定化">
            <div>
              <h2>Beta 稳定化</h2>
              <p>
                Trusted source {trustedSourceCount} 个，Auto update {autoUpdateCount} 个，候选{" "}
                {trustedAutoUpdateSkills.length} 个。
              </p>
            </div>
            <div className="beta-actions">
              <button
                className="ghost-button compact"
                data-testid="export-environment-report"
                disabled={actionBusy === "environment-report"}
                onClick={handleExportEnvironmentReport}
              >
                {actionBusy === "environment-report" ? "生成中" : "导出环境报告"}
              </button>
              <button
                className="compact"
                data-testid="run-auto-update"
                disabled={actionBusy === "auto-update" || skills.length === 0}
                onClick={handleRunAutoUpdate}
              >
                {actionBusy === "auto-update" ? "更新中" : "受控自动更新"}
              </button>
            </div>
            <div className="file-action-row">
              <input
                data-testid="environment-report-export-path"
                value={environmentReportExportPath}
                placeholder="/tmp/metis-environment-report.json"
                onChange={(event) => setEnvironmentReportExportPath(event.target.value)}
              />
              <button
                className="ghost-button compact"
                data-testid="export-environment-report-to-file"
                disabled={
                  actionBusy === "environment-report-file" ||
                  environmentReportExportPath.trim().length === 0
                }
                onClick={handleExportEnvironmentReportToFile}
              >
                {actionBusy === "environment-report-file" ? "写出中" : "写出环境报告"}
              </button>
            </div>
            {environmentReport ? (
              <ReportPreview title="环境报告预览" subtitle="不包含 token 或 credential_ref 值。">
                {JSON.stringify(environmentReport, null, 2)}
              </ReportPreview>
            ) : (
              <ReportEmptyState
                testId="environment-report-empty"
                title="暂无环境报告"
                description="先生成环境报告，再决定是否写出到文件。"
              />
            )}
          </section>

          <section className="team-compliance-panel" aria-label="团队清单合规">
            <div className="team-compliance-header">
              <div>
                <h2>团队清单合规</h2>
                <p>版本锁定、来源绑定和本地修改状态。</p>
              </div>
              <button
                className="compact"
                data-testid="check-team-compliance"
                disabled={actionBusy === "team-compliance" || teamManifestDraft.trim().length === 0}
                onClick={handleCheckTeamCompliance}
              >
                {actionBusy === "team-compliance" ? "校验中" : "校验清单"}
              </button>
            </div>
            <div className="file-action-row">
              <input
                data-testid="team-manifest-file-path"
                value={teamManifestFilePath}
                placeholder="/tmp/team-manifest.json"
                onChange={(event) => setTeamManifestFilePath(event.target.value)}
              />
              <button
                className="ghost-button compact"
                data-testid="load-team-manifest-from-file"
                disabled={
                  actionBusy === "team-manifest-file" || teamManifestFilePath.trim().length === 0
                }
                onClick={handleLoadTeamManifestFromFile}
              >
                {actionBusy === "team-manifest-file" ? "载入中" : "从文件载入"}
              </button>
            </div>
            <textarea
              className="team-manifest-input"
              data-testid="team-manifest-input"
              value={teamManifestDraft}
              placeholder='{"version":"1","skills":[]}'
              onChange={(event) => setTeamManifestDraft(event.target.value)}
            />
            {teamComplianceReport ? (
              <div className="team-compliance-result">
                <div className="team-compliance-summary">
                  <SummaryMetric
                    label="清单 skills"
                    value={teamComplianceReport.summary.total.toString()}
                  />
                  <SummaryMetric
                    label="符合版本"
                    value={teamComplianceReport.summary.installed.toString()}
                  />
                  <SummaryMetric
                    label="缺失"
                    value={teamComplianceReport.summary.missing.toString()}
                  />
                  <SummaryMetric
                    label="版本不一致"
                    value={teamComplianceReport.summary.version_mismatch.toString()}
                  />
                  <SummaryMetric
                    label="本地修改"
                    value={teamComplianceReport.summary.local_modified.toString()}
                  />
                  <SummaryMetric
                    label="来源不一致"
                    value={teamComplianceReport.summary.source_mismatch.toString()}
                  />
                </div>
                <div className="team-compliance-list">
                  {teamComplianceReport.items.map((item) => (
                    <TeamComplianceRow key={`${item.agent_id}:${item.name}`} item={item} />
                  ))}
                </div>
                <ReportPreview title="团队合规报告预览" subtitle="用于提交给团队或归档审计。">
                  {JSON.stringify(teamComplianceReport, null, 2)}
                </ReportPreview>
                <div className="file-action-row">
                  <input
                    data-testid="team-compliance-export-path"
                    value={teamComplianceExportPath}
                    placeholder="/tmp/metis-team-compliance-report.json"
                    onChange={(event) => setTeamComplianceExportPath(event.target.value)}
                  />
                  <button
                    className="ghost-button compact"
                    data-testid="export-team-compliance-report"
                    disabled={
                      actionBusy === "team-compliance-export" ||
                      teamComplianceExportPath.trim().length === 0
                    }
                    onClick={handleExportTeamComplianceReport}
                  >
                    {actionBusy === "team-compliance-export" ? "写出中" : "写出合规报告"}
                  </button>
                </div>
              </div>
            ) : (
              <ReportEmptyState
                testId="team-compliance-empty"
                title="暂无团队合规报告"
                description="粘贴或载入团队清单后再校验合规状态。"
              />
            )}
          </section>

          <section className="governance-audit-panel" aria-label="本地审计导出">
            <div>
              <h2>本地审计导出</h2>
              <p>导出最近 200 条本机审计事件，用于团队只读审计和问题追溯。</p>
            </div>
            <div className="file-action-row">
              <input
                data-testid="audit-log-export-path"
                value={auditLogExportPath}
                placeholder="/tmp/metis-audit-log-report.json"
                onChange={(event) => setAuditLogExportPath(event.target.value)}
              />
              <button
                className="ghost-button compact"
                data-testid="export-audit-log-report"
                disabled={actionBusy === "audit-log-export" || auditLogExportPath.trim().length === 0}
                onClick={handleExportAuditLogReport}
              >
                {actionBusy === "audit-log-export" ? "写出中" : "写出审计日志"}
              </button>
            </div>
          </section>
        </section>
      )}

      {activeWorkspace === "settings" && (
        <section className="settings-panel workspace-pane redesign-settings-page" aria-label="配置" data-testid="workspace-settings">
          <div className="settings-agent-path-table redesign-agent-path-table" data-testid="settings-agent-path-table">
            {settingsAgentRows.map((row) => (
              <label
                className="settings-agent-path-row redesign-agent-path-row"
                data-testid={`settings-agent-path-${row.agent_id}`}
                key={row.agent_id}
              >
                <span className={row.exists ? "ready" : "missing"}>{row.agent_name}</span>
                <input readOnly value={row.path} />
                <small>{row.exists ? "可读写" : "路径不存在"}</small>
              </label>
            ))}
          </div>
          <div className="settings-summary">
            <span>{settings.custom_scan_paths.length || "默认"} 个扫描路径</span>
            <span>{settings.team_policy_path ? "已配置团队策略" : "未配置团队策略"}</span>
            <span>{settings.enterprise_network?.proxy_url ? "已配置企业代理" : "未配置企业代理"}</span>
            <span>
              {settings.enterprise_network?.certificate_authority_bundle_path
                ? "已配置企业 CA bundle"
                : "未配置企业 CA bundle"}
            </span>
            <span>凭据使用本机 Git / SSH 配置</span>
          </div>
          <div className="settings-editor">
            <div className="settings-section" data-testid="settings-section-scan-paths">
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
            <div className="settings-section" data-testid="settings-section-team-policy">
              <div>
                <h3>团队策略</h3>
                <p>本地 JSON 策略可预配置 trusted source，并限制未信任来源自动更新。</p>
              </div>
              <input
                data-testid="team-policy-path"
                value={teamPolicyPathDraft}
                placeholder="/Users/me/team-policy.json"
                onChange={(event) => setTeamPolicyPathDraft(event.target.value)}
              />
              <div className="form-actions">
                <button
                  className="ghost-button compact"
                  data-testid="preview-team-policy"
                  disabled={actionBusy === "team-policy" || teamPolicyPathDraft.trim().length === 0}
                  onClick={handlePreviewTeamPolicy}
                >
                  {actionBusy === "team-policy" ? "读取中" : "预览策略"}
                </button>
                <button
                  className="ghost-button compact"
                  data-testid="run-team-policy-audit"
                  disabled={
                    actionBusy === "team-policy-audit" || teamPolicyPathDraft.trim().length === 0
                  }
                  onClick={handleRunTeamPolicyAudit}
                >
                  {actionBusy === "team-policy-audit" ? "审计中" : "审计现有来源"}
                </button>
              </div>
              {teamPolicySummary && (
                <div className="policy-summary">
                  <span>策略版本 {teamPolicySummary.version}</span>
                  <span>可信来源 {teamPolicySummary.trusted_sources} 个</span>
                  <span>
                    {teamPolicySummary.allow_auto_update ? "允许自动更新" : "禁止自动更新"}
                  </span>
                  <span>
                    {teamPolicySummary.require_trusted_source
                      ? "自动更新要求 trusted source"
                      : "自动更新不要求 trusted source"}
                  </span>
                </div>
              )}
              {teamPolicyAuditReport && (
                <div className="policy-audit-result">
                  <div className="policy-summary">
                    <span>已绑定来源 {teamPolicyAuditReport.total_bound_sources} 个</span>
                    <span>合规 {teamPolicyAuditReport.compliant} 个</span>
                    <span>建议标记 trusted {teamPolicyAuditReport.should_mark_trusted} 个</span>
                    <span>需关闭 auto update {teamPolicyAuditReport.auto_update_disallowed} 个</span>
                  </div>
                  <div className="policy-audit-list">
                    {teamPolicyAuditReport.items.map((item) => (
                      <PolicyAuditRow key={`${item.skill_id}:${item.source_id}`} item={item} />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="settings-section" data-testid="settings-section-enterprise-network">
              <div>
                <h3>企业网络</h3>
                <p>代理和企业 CA bundle 仅用于 Metis 发起的 Git 子进程。</p>
              </div>
              <div className="network-field-grid">
                <input
                  data-testid="enterprise-proxy-url"
                  value={enterpriseProxyUrlDraft}
                  placeholder="http://proxy.corp.example:8080"
                  onChange={(event) => setEnterpriseProxyUrlDraft(event.target.value)}
                />
                <input
                  data-testid="enterprise-no-proxy"
                  value={enterpriseNoProxyDraft}
                  placeholder="localhost,127.0.0.1,.corp.example"
                  onChange={(event) => setEnterpriseNoProxyDraft(event.target.value)}
                />
                <input
                  data-testid="enterprise-ca-bundle-path"
                  value={enterpriseCaBundlePathDraft}
                  placeholder="/Users/me/certs/corp-ca.pem"
                  onChange={(event) => setEnterpriseCaBundlePathDraft(event.target.value)}
                />
              </div>
              <div className="policy-summary">
                <span>
                  {settings.enterprise_network?.proxy_url ? "企业代理已配置" : "企业代理未配置"}
                </span>
                <span>
                  {settings.enterprise_network?.no_proxy ? "NO_PROXY 已配置" : "NO_PROXY 未配置"}
                </span>
                <span>
                  {settings.enterprise_network?.certificate_authority_bundle_path
                    ? "企业 CA bundle 已配置"
                    : "企业 CA bundle 未配置"}
                </span>
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
          detailInstallResults={detailInstallResults}
          detailTargetErrors={detailTargetErrors}
          detailTargets={detailTargets}
          diffDetails={diffDetails}
          diffError={diffError}
          error={error}
          remoteInstallResult={remoteInstallResult}
          remotePreview={remotePreview}
          remoteSyncDraft={remoteSyncDraft}
          remoteTargets={remoteTargets}
          selectedDetailTargetIds={selectedDetailTargetIds}
          selectedRemoteTargetIds={selectedRemoteTargetIds}
          skillSearchQuery={skillSearchQuery}
          skills={skills}
          state={state}
          updateResults={updateResults}
          onApplyUpdate={handleApplyUpdate}
          onBackupsDetailToggle={handleToggleDetailBackups}
          onBackupsToggle={handleToggleBackups}
          onBind={handleBindSource}
          onCancelBind={() => setBindingSkillId(null)}
          onCheckUpdates={handleCheckUpdates}
          onCheckDetailUpdates={handleCheckDetailUpdates}
          onDraftChange={setBindDraft}
          onInstallDetailTargets={handleInstallDetailTargets}
          onInstallRemoteTargets={handleInstallRemoteTargets}
          onLoadDetailTargets={loadDetailTargets}
          onOpenBind={openBindForm}
          onOpenSettings={() => setActiveWorkspace("settings")}
          onPreviewRemoteSync={handlePreviewRemoteSync}
          onRestoreBackup={handleRestoreBackup}
          onScan={handleScan}
          onSetRemoteSyncDraft={setRemoteSyncDraft}
          onRouteKindChange={setSkillsViewKind}
          onToggleDetailTarget={toggleDetailTarget}
          onToggleDetailDiff={handleToggleDetailDiff}
          onToggleDiff={handleToggleDiff}
          onToggleRemoteTarget={toggleRemoteTarget}
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

function TeamComplianceRow({ item }: { item: DesktopTeamManifestComplianceItem }) {
  return (
    <article className="team-compliance-row">
      <div>
        <div className="skill-title compact-title">
          <h3>{item.name}</h3>
          <span>{item.agent_id}</span>
        </div>
        <div className="team-compliance-meta">
          <span>expected {item.expected_commit ? shortCommit(item.expected_commit) : "unlocked"}</span>
          <span>local {item.local_commit ? shortCommit(item.local_commit) : "none"}</span>
          <span>{item.local_modified ? "local modified" : "local clean"}</span>
        </div>
        <div className="team-compliance-source">
          <code>{item.expected_source_url ?? "no expected source"}</code>
          <code>{item.local_source_url ?? "no local source"}</code>
        </div>
      </div>
      <span className={`status-badge ${teamComplianceTone(item.status)}`}>{item.status}</span>
    </article>
  );
}

function PolicyAuditRow({ item }: { item: DesktopTeamPolicyAuditItem }) {
  return (
    <article className="policy-audit-row">
      <div>
        <div className="skill-title compact-title">
          <h3>{item.skill_name}</h3>
          <span>{item.source_ref}</span>
        </div>
        <div className="team-compliance-meta">
          <span>{item.current_trusted ? "trusted" : "untrusted"}</span>
          <span>{item.current_auto_update ? "auto update on" : "auto update off"}</span>
          <span>{item.policy_trusted ? "policy trusted" : "policy untrusted"}</span>
        </div>
        <div className="team-compliance-source">
          <code>{item.source_url}</code>
          <code>{item.source_repo_path}</code>
        </div>
        <p className="policy-recommendation">{item.recommendation}</p>
      </div>
      <span className={`status-badge ${policyAuditTone(item.status)}`}>{item.status}</span>
    </article>
  );
}

function ReportPreview({
  children,
  subtitle,
  title,
}: {
  children: string;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="report-preview-shell">
      <div className="report-preview-header">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <pre className="environment-report-preview">{children}</pre>
    </div>
  );
}

function ReportEmptyState({
  description,
  testId,
  title,
}: {
  description: string;
  testId: string;
  title: string;
}) {
  return (
    <div className="report-empty-state" data-testid={testId}>
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function teamComplianceTone(status: string): "good" | "danger" | "warning" | "muted" {
  if (status === "installed") {
    return "good";
  }
  if (status === "missing" || status === "source_mismatch") {
    return "danger";
  }
  if (status === "version_mismatch" || status === "local_modified") {
    return "warning";
  }
  return "muted";
}

function policyAuditTone(status: string): "good" | "danger" | "warning" | "muted" {
  if (status === "compliant") {
    return "good";
  }
  if (status === "auto_update_disallowed") {
    return "danger";
  }
  if (status === "should_mark_trusted") {
    return "warning";
  }
  return "muted";
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

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M18 9a6.5 6.5 0 0 0-11-2" />
      <path d="M6 15a6.5 6.5 0 0 0 11 2" />
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

export default App;
