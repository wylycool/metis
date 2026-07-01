import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App";
import type {
  DesktopAgentStatus,
  DesktopApplyUpdateResult,
  DesktopBackupSummary,
  DesktopDiffDetail,
  DesktopSettings,
  DesktopSkill,
  DesktopSource,
  DesktopUpdateCheckResult,
} from "./types";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("Metis desktop GUI main flow", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    const scenario = createMainFlowScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );
  });

  test("runs scan, bind, check, diff, and rollback from the UI", async () => {
    const user = userEvent.setup();

    render(<App />);

    const skillRow = await screen.findByTestId("skill-row-e2e-skill");
    expect(invokeMock).toHaveBeenCalledWith("scan_skills");
    expect(within(skillRow).getByText("e2e-skill")).toBeTruthy();
    expect(within(skillRow).getByText("未绑定来源")).toBeTruthy();

    await user.click(skillRow);
    expect(await screen.findByTestId("skill-detail-e2e-skill")).toBeTruthy();
    expect(screen.getByText("返回")).toBeTruthy();
    expect(screen.queryByText("Skills / e2e-skill")).toBeNull();
    expect(screen.queryByText("未检测更新")).toBeNull();
    const unboundSourceSummary = within(screen.getByTestId("skill-source-summary-e2e-skill"));
    expect(unboundSourceSummary.getByText("来源")).toBeTruthy();
    expect(unboundSourceSummary.getByText("未绑定来源")).toBeTruthy();
    expect(unboundSourceSummary.getByTestId("open-bind-source-e2e-skill").textContent).toContain(
      "添加来源",
    );
    expect(screen.queryByTestId("apply-update-e2e-skill")).toBeNull();
    expect((screen.getByTestId("check-updates-e2e-skill") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId("toggle-diff-e2e-skill") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("toggle-backups-e2e-skill") as HTMLButtonElement).disabled).toBe(
      true,
    );

    await user.click(screen.getByTestId("open-bind-source-e2e-skill"));
    await user.type(screen.getByTestId("bind-url-e2e-skill"), "file:///tmp/metis-e2e-repo");
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.clear(screen.getByTestId("bind-ref-e2e-skill"));
    await user.type(screen.getByTestId("bind-ref-e2e-skill"), "main");
    await user.click(screen.getByTestId("submit-bind-source-e2e-skill"));

    expect(await screen.findByText("修改来源")).toBeTruthy();
    const boundSourceSummary = within(screen.getByTestId("skill-source-summary-e2e-skill"));
    expect(boundSourceSummary.getByText("file:///tmp/metis-e2e-repo")).toBeTruthy();
    expect(boundSourceSummary.getByText("skills/e2e-skill · main")).toBeTruthy();
    expect(
      boundSourceSummary.getByTestId("open-bind-source-e2e-skill").className,
    ).toContain("redesign-source-action");

    await user.click(screen.getByTestId("check-updates-e2e-skill"));

    expect((await screen.findAllByText("待更新")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("~1")).toBeTruthy();
    expect(screen.getByText("2 commits behind")).toBeTruthy();
    expect(await screen.findByTestId("apply-update-e2e-skill")).toBeTruthy();

    await user.click(screen.getByTestId("toggle-diff-e2e-skill"));

    expect(
      await screen.findByText((content) => content.includes("diff --git a/SKILL.md b/SKILL.md")),
    ).toBeTruthy();
    expect(
      screen.getByText((content) => content.includes("+description: Updated skill")),
    ).toBeTruthy();

    await user.click(screen.getByTestId("apply-update-e2e-skill"));
    expect(await screen.findByText(/更新完成：aaa111 -> bbb222/)).toBeTruthy();
    expect(await screen.findByText("pre-update")).toBeTruthy();

    await user.click(screen.getByTestId("restore-backup-e2e-skill-backup-pre-update"));

    expect(await screen.findByText(/已回滚到 backup-pre-update/)).toBeTruthy();
    expect(await screen.findByText("pre-rollback")).toBeTruthy();
  });

  test("previews a remote skill and syncs it to selected agents", async () => {
    const user = userEvent.setup();

    render(<App />);

    await screen.findByTestId("skill-row-e2e-skill");
    await user.click(screen.getByTestId("open-add-skill"));
    expect(await screen.findByTestId("add-skill-page")).toBeTruthy();
    await user.type(
      screen.getByTestId("add-skill-url"),
      "https://github.com/example/metis-skills.git",
    );
    await user.type(screen.getByTestId("add-skill-repo-path"), "skills/remote");
    await user.clear(screen.getByTestId("add-skill-ref"));
    await user.type(screen.getByTestId("add-skill-ref"), "main");
    await user.click(screen.getByTestId("add-skill-preview"));

    expect(await screen.findByText("Remote Skill")).toBeTruthy();
    expect(await screen.findByTestId("target-row-codex")).toBeTruthy();
    await user.click(screen.getByTestId("target-checkbox-codex"));
    await user.click(screen.getByTestId("install-selected-targets"));

    expect(await screen.findByText(/Codex：Installed/)).toBeTruthy();
  });

  test("exports environment report and runs trusted auto updates only", async () => {
    const user = userEvent.setup();
    const scenario = createBetaReadinessScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("workspace-tab-governance-legacy"));
    expect(await screen.findByText("Beta 稳定化")).toBeTruthy();
    await user.click(screen.getByTestId("export-environment-report"));

    expect(await screen.findByText("环境报告已生成")).toBeTruthy();
    expect(screen.getByText(/\"total_skills\": 2/)).toBeTruthy();
    expect(screen.getByText(/\"trusted_sources\": 1/)).toBeTruthy();
    expect(screen.queryByText("secret-token")).toBeNull();

    await user.click(screen.getByTestId("run-auto-update"));

    expect(await screen.findByText(/受控自动更新完成：已更新 1 个，跳过 1 个/)).toBeTruthy();
    expect(scenario.appliedSkillIds()).toEqual(["trusted-skill"]);
  });

  test("checks pasted team manifest compliance and previews a read-only report", async () => {
    const user = userEvent.setup();
    const scenario = createBetaReadinessScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );
    const manifest = {
      version: "1",
      exported_at: "2026-06-20T12:00:00Z",
      skills: [
        {
          name: "Trusted Skill",
          agent_id: "generic",
          source_url: "file:///tmp/metis-trusted",
          source_repo_path: "skills/trusted",
          source_ref: "main",
          source_commit: "aaa111",
          install_path_hint: null,
        },
      ],
    };

    render(<App />);

    await user.click(await screen.findByTestId("workspace-tab-governance-legacy"));
    expect(await screen.findByText("团队清单合规")).toBeTruthy();
    fireEvent.change(screen.getByTestId("team-manifest-input"), {
      target: { value: JSON.stringify(manifest) },
    });
    await user.click(screen.getByTestId("check-team-compliance"));

    expect(await screen.findByText("团队合规报告已生成")).toBeTruthy();
    expect(screen.getByText("installed")).toBeTruthy();
    expect(screen.getByText("version_mismatch")).toBeTruthy();
    expect(screen.getByText("local_modified")).toBeTruthy();
    expect(screen.getByText("source_mismatch")).toBeTruthy();
    expect(screen.getByText("missing")).toBeTruthy();
    expect(screen.getByText(/"total": 5/)).toBeTruthy();
  });

  test("phase4 imports and exports local governance reports", async () => {
    const user = userEvent.setup();
    const scenario = createBetaReadinessScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("workspace-tab-governance-legacy"));
    expect(await screen.findByText("团队清单合规")).toBeTruthy();
    await user.type(screen.getByTestId("team-manifest-file-path"), "/tmp/team-manifest.json");
    await user.click(screen.getByTestId("load-team-manifest-from-file"));

    expect(await screen.findByText("团队清单文件已载入")).toBeTruthy();
    expect((screen.getByTestId("team-manifest-input") as HTMLTextAreaElement).value).toContain(
      "Trusted Skill",
    );

    await user.click(screen.getByTestId("check-team-compliance"));
    expect(await screen.findByText("团队合规报告已生成")).toBeTruthy();

    await user.type(
      screen.getByTestId("team-compliance-export-path"),
      "/tmp/reports/compliance.json",
    );
    await user.click(screen.getByTestId("export-team-compliance-report"));
    expect(await screen.findByText(/团队合规报告已写出/)).toBeTruthy();

    await user.click(screen.getByTestId("export-environment-report"));
    expect(await screen.findByText("环境报告已生成")).toBeTruthy();
    await user.type(
      screen.getByTestId("environment-report-export-path"),
      "/tmp/reports/environment.json",
    );
    await user.click(screen.getByTestId("export-environment-report-to-file"));
    expect(await screen.findByText(/环境报告已写出/)).toBeTruthy();

    await user.type(screen.getByTestId("audit-log-export-path"), "/tmp/reports/audit.json");
    await user.click(screen.getByTestId("export-audit-log-report"));
    expect(await screen.findByText(/审计日志已写出/)).toBeTruthy();
    expect(scenario.exportedPaths()).toEqual([
      "/tmp/reports/compliance.json",
      "/tmp/reports/environment.json",
      "/tmp/reports/audit.json",
    ]);
  });

  test("phase4 team policy previews trusted sources and applies binding defaults", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByTestId("workspace-tab-settings"));
    await user.type(screen.getByTestId("team-policy-path"), "/tmp/team-policy.json");
    await user.click(screen.getByText("保存"));
    expect(await screen.findByText("设置已保存")).toBeTruthy();
    await user.click(screen.getByTestId("preview-team-policy"));

    expect(await screen.findByText("策略版本 1")).toBeTruthy();
    expect(screen.getByText("可信来源 1 个")).toBeTruthy();
    expect(screen.getByText("自动更新要求 trusted source")).toBeTruthy();

    await user.click(screen.getByTestId("workspace-tab-skills-legacy"));
    const skillRow = await screen.findByTestId("skill-row-e2e-skill");
    await user.click(skillRow);
    expect(await screen.findByTestId("skill-detail-e2e-skill")).toBeTruthy();
    await user.click(screen.getByTestId("open-bind-source-e2e-skill"));
    await user.type(
      screen.getByTestId("bind-url-e2e-skill"),
      "https://github.com/example/team-skills.git",
    );
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.clear(screen.getByTestId("bind-ref-e2e-skill"));
    await user.type(screen.getByTestId("bind-ref-e2e-skill"), "main");
    await user.click(screen.getByTestId("bind-auto-update-e2e-skill"));
    await user.click(screen.getByTestId("submit-bind-source-e2e-skill"));

    expect(await screen.findByText("修改来源")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("save_desktop_settings", {
      settings: expect.objectContaining({
        team_policy_path: "/tmp/team-policy.json",
      }),
    });
  });

  test("phase4 policy audit reports existing source recommendations", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByTestId("workspace-tab-settings"));
    await user.type(screen.getByTestId("team-policy-path"), "/tmp/team-policy.json");
    await user.click(screen.getByText("保存"));
    expect(await screen.findByText("设置已保存")).toBeTruthy();
    await user.click(screen.getByTestId("run-team-policy-audit"));

    expect(await screen.findByText("策略审计已生成")).toBeTruthy();
    expect(screen.getByText("已绑定来源 3 个")).toBeTruthy();
    expect(screen.getByText("合规 1 个")).toBeTruthy();
    expect(screen.getByText("建议标记 trusted 1 个")).toBeTruthy();
    expect(screen.getByText("需关闭 auto update 1 个")).toBeTruthy();
    expect(screen.getByText("Needs Trusted")).toBeTruthy();
    expect(screen.getByText("should_mark_trusted")).toBeTruthy();
    expect(screen.getByText("Untrusted Auto")).toBeTruthy();
    expect(screen.getByText("auto_update_disallowed")).toBeTruthy();
    expect(screen.queryByText("secret-token")).toBeNull();
  });

  test("phase4 enterprise network settings save proxy and certificate paths", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByTestId("workspace-tab-settings"));
    await user.type(
      screen.getByTestId("enterprise-proxy-url"),
      "http://proxy.corp.example:8080",
    );
    await user.type(
      screen.getByTestId("enterprise-no-proxy"),
      "localhost,127.0.0.1,.corp.example",
    );
    await user.type(
      screen.getByTestId("enterprise-ca-bundle-path"),
      "/Users/me/certs/corp-ca.pem",
    );
    await user.click(screen.getByText("保存"));

    expect(await screen.findByText("设置已保存")).toBeTruthy();
    expect(screen.getByText("已配置企业代理")).toBeTruthy();
    expect(screen.getByText("已配置企业 CA bundle")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("save_desktop_settings", {
      settings: expect.objectContaining({
        enterprise_network: {
          proxy_url: "http://proxy.corp.example:8080",
          no_proxy: "localhost,127.0.0.1,.corp.example",
          certificate_authority_bundle_path: "/Users/me/certs/corp-ca.pem",
        },
      }),
    });
  });

  test("organizes the home screen around the Metis brand, top actions, and skill categories", async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByTestId("workspace-skills")).toBeTruthy();
    expect(screen.queryByTestId("workspace-rail")).toBeNull();
    expect(screen.getByTestId("metis-reference-shell")).toBeTruthy();
    expect(screen.getByTestId("metis-reference-sidebar")).toBeTruthy();
    expect(screen.getByTestId("metis-reference-shell").className).toContain("redesign-app-window");
    expect(screen.getByTestId("metis-reference-sidebar").className).toContain("redesign-sidebar");
    expect(screen.queryByTestId("formal-redesign-theme-switcher")).toBeNull();
    expect(screen.getByTestId("workspace-skills").className).toContain("redesign-home");
    expect(screen.getByTestId("workspace-topbar")).toBeTruthy();
    expect(screen.getByTestId("workspace-topbar-middle")).toBeTruthy();
    expect(screen.getByTestId("workspace-topbar-actions")).toBeTruthy();
    expect(screen.getByTestId("metis-brand-home")).toBeTruthy();
    expect(screen.getByTestId("metis-brand-crystal-logo")).toBeTruthy();
    expect(screen.queryByTestId("metis-brand-letter-logo")).toBeNull();
    expect(screen.getByTestId("skill-search-input")).toBeTruthy();
    expect(screen.queryByText(/\d+ results/)).toBeNull();
    expect(screen.getByTestId("check-all-updates")).toBeTruthy();
    expect(screen.getByTestId("scan-skills")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Skills" })).toBeTruthy();
    expect(screen.queryByText("本机 Skill 工作台")).toBeNull();
    expect(screen.getByTestId("workspace-tab-skills").textContent).toBe("Skills");
    expect(screen.getByTestId("workspace-tab-governance-sidebar").textContent).toBe("Updates");
    expect(screen.getByTestId("workspace-tab-settings").textContent).toBe("");
    expect(screen.queryByTestId("workspace-tab-governance")).toBeNull();
    expect(screen.queryByText("Skill 索引")).toBeNull();
    expect(screen.queryByText("本机 Skill 索引")).toBeNull();
    expect(screen.queryByText("LOCAL WORKSPACE")).toBeNull();
    expect(screen.queryByText("来自本机 SQLite 索引和最新扫描结果")).toBeNull();
    expect(screen.queryByLabelText("扫描摘要")).toBeNull();
    expect(screen.queryByText("团队清单合规")).toBeNull();
    expect(screen.queryByTestId("skill-status-filters")).toBeNull();
    expect(screen.queryByTestId("agent-category-bar")).toBeNull();
    expect(screen.getByTestId("skill-dashboard-stats")).toBeTruthy();
    expect(screen.getByTestId("skill-card-grid")).toBeTruthy();
    expect(screen.getByTestId("skill-card-grid").className).toContain("redesign-skill-grid");
    expect(screen.getByTestId("skill-card-e2e-skill")).toBeTruthy();
    expect(screen.getByTestId("skill-row-e2e-skill").className).toContain("redesign-skill-card");
    expect(within(screen.getByTestId("skill-row-e2e-skill")).queryByText("Generic Agent Skills")).toBeNull();

    await user.click(screen.getByTestId("workspace-tab-settings"));
    expect(await screen.findByTestId("workspace-settings")).toBeTruthy();
    expect(screen.getByTestId("workspace-topbar")).toBeTruthy();
    expect(screen.getByTestId("workspace-topbar-middle")).toBeTruthy();
    expect(screen.getByTestId("workspace-topbar-actions")).toBeTruthy();
    expect(screen.getByTestId("check-all-updates").className).toContain("topbar-secondary-action");
    expect(screen.getByTestId("scan-skills").className).toContain("scan-button");
    expect(screen.getByTestId("settings-agent-path-table")).toBeTruthy();
    expect(screen.getByTestId("settings-agent-path-table").className).toContain(
      "redesign-agent-path-table",
    );
    expect(screen.getByTestId("settings-agent-path-codex")).toBeTruthy();
    expect(screen.getByText("扫描路径")).toBeTruthy();
    expect(screen.getByText("企业网络")).toBeTruthy();
    expect(screen.queryByText("团队清单合规")).toBeNull();

    await user.click(screen.getByTestId("metis-brand-home"));
    expect(await screen.findByTestId("workspace-skills")).toBeTruthy();
    expect(screen.queryByTestId("skill-status-filters")).toBeNull();
  });

  test("reuses the formal topbar layout across Skills, Updates, and Settings", async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByTestId("workspace-skills")).toBeTruthy();
    expect(screen.getByTestId("workspace-topbar").className).toContain("redesign-page-topbar");
    expect(screen.getByTestId("workspace-topbar-middle").className).toContain(
      "topbar-middle-slot",
    );
    expect(screen.getByTestId("workspace-topbar-actions").className).toContain(
      "redesign-top-actions",
    );
    expect(screen.getByTestId("workspace-topbar-actions").children).toHaveLength(2);
    expect(screen.getByTestId("skill-search-input")).toBeTruthy();
    expect(within(screen.getByTestId("workspace-topbar-middle")).queryByText(/\d+ results/)).toBeNull();

    await user.click(screen.getByTestId("workspace-tab-governance-sidebar"));
    expect(await screen.findByTestId("workspace-governance")).toBeTruthy();
    expect(screen.getByTestId("workspace-topbar-middle").className).toContain("is-empty");
    expect(screen.getByTestId("workspace-topbar-actions").children).toHaveLength(2);
    expect(screen.getByTestId("check-all-updates").className).toContain("topbar-secondary-action");
    expect(screen.getByTestId("scan-skills").className).toContain("scan-button");

    await user.click(screen.getByTestId("workspace-tab-settings"));
    expect(await screen.findByTestId("workspace-settings")).toBeTruthy();
    expect(screen.getByTestId("workspace-topbar-middle").className).toContain("is-empty");
    expect(screen.getByTestId("workspace-topbar-actions").children).toHaveLength(2);
    expect(screen.getByTestId("check-all-updates").className).toContain("topbar-secondary-action");
    expect(screen.getByTestId("scan-skills").className).toContain("scan-button");
  });

  test("limits the formal home first screen and expands with show more", async () => {
    const user = userEvent.setup();
    const scenario = createAgentDetailScenario({ extraSkillCount: 8 });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    expect(await screen.findByTestId("skill-card-grid")).toBeTruthy();
    expect(screen.getAllByTestId(/^skill-row-/)).toHaveLength(6);
    expect(screen.queryByTestId("skill-row-extra-skill-6")).toBeNull();
    expect(screen.queryByText("Codex")).toBeNull();
    expect(screen.queryByText("Claude Code")).toBeNull();

    await user.click(screen.getByTestId("show-more-skills"));

    expect(await screen.findByTestId("skill-row-extra-skill-6")).toBeTruthy();
    expect(screen.getAllByTestId(/^skill-row-/).length).toBeGreaterThan(6);
    expect(screen.getByTestId("collapse-skills")).toBeTruthy();

    await user.click(screen.getByTestId("collapse-skills"));

    expect(screen.getAllByTestId(/^skill-row-/)).toHaveLength(6);
    expect(screen.queryByTestId("skill-row-extra-skill-6")).toBeNull();
    expect(screen.getByTestId("show-more-skills")).toBeTruthy();
  });

  test("renders the static UI redesign preview without backend commands", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/ui-redesign-preview";

    render(<App />);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId("ui-redesign-preview")).toBeTruthy();
    expect(screen.getByTestId("redesign-app-window")).toBeTruthy();
    expect(screen.getByTestId("redesign-brand-logo")).toBeTruthy();
    expect(screen.getByTestId("redesign-brand-crystal-logo")).toBeTruthy();
    expect(screen.queryByTestId("redesign-brand-letter-logo")).toBeNull();
    expect(screen.getByTestId("redesign-home")).toBeTruthy();
    expect(screen.getByTestId("redesign-search-input")).toBeTruthy();
    expect(screen.getByTestId("redesign-stat-total")).toBeTruthy();
    expect(screen.getByTestId("redesign-stat-updates")).toBeTruthy();
    expect(screen.getByTestId("redesign-stat-latest")).toBeTruthy();
    expect(screen.getByTestId("redesign-skill-grid")).toBeTruthy();
    expect(screen.getByTestId("redesign-skill-card-memory-weaver")).toBeTruthy();
    expect(screen.getByTestId("redesign-agent-stack-memory-weaver")).toBeTruthy();
    expect(screen.queryByTestId("workspace-skills")).toBeNull();

    await user.type(screen.getByTestId("redesign-search-input"), "release");
    expect(screen.queryByTestId("redesign-skill-card-memory-weaver")).toBeNull();
    expect(screen.getByTestId("redesign-skill-card-release-sentinel")).toBeTruthy();
    await user.clear(screen.getByTestId("redesign-search-input"));

    await user.click(screen.getByTestId("redesign-check-updates"));
    expect(await screen.findByTestId("redesign-toast")).toBeTruthy();
    await user.click(screen.getByTestId("redesign-rescan"));
    expect(await screen.findByText("已重新扫描本机 skill 路径")).toBeTruthy();

    await user.click(screen.getByTestId("redesign-skill-card-memory-weaver"));

    expect(await screen.findByTestId("redesign-skill-detail-memory-weaver")).toBeTruthy();
    expect(screen.getByTestId("redesign-detail-summary")).toBeTruthy();
    expect(screen.getByTestId("redesign-update-workbench")).toBeTruthy();

    await user.click(screen.getByTestId("redesign-open-source-drawer"));
    expect(await screen.findByTestId("redesign-source-drawer")).toBeTruthy();
    expect(screen.getByTestId("redesign-source-url")).toBeTruthy();
    expect(screen.getByTestId("redesign-source-repo-path")).toBeTruthy();
    expect(screen.getByTestId("redesign-source-ref")).toBeTruthy();
    expect(screen.getByTestId("redesign-source-trusted")).toBeTruthy();
    expect(screen.getByTestId("redesign-source-auto-update")).toBeTruthy();
    await user.click(screen.getByTestId("redesign-save-source"));
    expect(await screen.findByText("来源设置已保存")).toBeTruthy();

    await user.click(screen.getByTestId("redesign-action-check"));
    expect(await screen.findByTestId("redesign-check-panel")).toBeTruthy();
    await user.click(screen.getByTestId("redesign-action-diff"));
    expect(await screen.findByTestId("redesign-diff-viewer")).toBeTruthy();
    expect(screen.getByText("SKILL.md")).toBeTruthy();
    await user.click(screen.getByTestId("redesign-action-backups"));
    expect(await screen.findByTestId("redesign-backup-panel")).toBeTruthy();
    await user.click(screen.getByTestId("redesign-rollback-latest"));
    expect(await screen.findByText("已回滚到 pre-update-2026-06-30")).toBeTruthy();

    await user.click(screen.getByTestId("redesign-back-home"));
    expect(await screen.findByTestId("redesign-home")).toBeTruthy();

    await user.click(screen.getByTestId("redesign-nav-settings"));
    expect(await screen.findByTestId("redesign-settings-page")).toBeTruthy();
    expect(screen.getByTestId("redesign-agent-path-codex")).toBeTruthy();
    expect(screen.getByTestId("redesign-agent-path-claude-code")).toBeTruthy();
    expect(screen.getByTestId("redesign-add-custom-path")).toBeTruthy();
    await user.click(screen.getByTestId("redesign-add-custom-path"));
    expect(await screen.findByText("已添加额外扫描路径")).toBeTruthy();

    window.location.hash = "";
  });

  test("switches the static UI redesign preview across non-purple background themes", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/ui-redesign-preview";

    render(<App />);

    const preview = await screen.findByTestId("ui-redesign-preview");
    expect(preview.getAttribute("data-theme")).toBe("frost");
    expect(screen.getByTestId("redesign-theme-frost")).toBeTruthy();
    expect(screen.getByTestId("redesign-theme-sage")).toBeTruthy();
    expect(screen.getByTestId("redesign-theme-dawn")).toBeTruthy();
    expect(screen.getByTestId("redesign-theme-graphite")).toBeTruthy();

    await user.click(screen.getByTestId("redesign-theme-sage"));
    expect(preview.getAttribute("data-theme")).toBe("sage");

    await user.click(screen.getByTestId("redesign-theme-dawn"));
    expect(preview.getAttribute("data-theme")).toBe("dawn");

    await user.click(screen.getByTestId("redesign-theme-graphite"));
    expect(preview.getAttribute("data-theme")).toBe("graphite");
    expect(invokeMock).not.toHaveBeenCalled();

    window.location.hash = "";
  });

  test("Command Sheet aligns Settings sections and keeps top update action compact", async () => {
    const user = userEvent.setup();

    render(<App />);

    const checkAllButton = await screen.findByTestId("check-all-updates");
    expect(checkAllButton.className).toContain("topbar-secondary-action");

    await user.click(screen.getByTestId("workspace-tab-settings"));

    expect(await screen.findByTestId("workspace-settings")).toBeTruthy();
    expect(screen.getByTestId("settings-section-scan-paths")).toBeTruthy();
    expect(screen.getByTestId("settings-section-team-policy")).toBeTruthy();
    expect(screen.getByTestId("settings-section-enterprise-network")).toBeTruthy();
  });

  test("phase5 shows actionable empty states and report placeholders", async () => {
    const user = userEvent.setup();
    const scenario = createEmptyWorkspaceScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    const emptyState = await screen.findByTestId("skills-empty-state");
    expect(emptyState).toBeTruthy();
    expect(within(emptyState).getByText("还没有发现 skills")).toBeTruthy();
    expect(within(emptyState).getByText("重新扫描")).toBeTruthy();
    await user.click(within(emptyState).getByText("添加扫描路径"));

    expect(await screen.findByTestId("workspace-settings")).toBeTruthy();
    expect(screen.getByText("扫描路径")).toBeTruthy();

    await user.click(screen.getByTestId("workspace-tab-governance-legacy"));
    expect(await screen.findByTestId("environment-report-empty")).toBeTruthy();
    expect(screen.getByText("先生成环境报告，再决定是否写出到文件。")).toBeTruthy();
    expect(screen.getByTestId("team-compliance-empty")).toBeTruthy();
    expect(screen.getByText("粘贴或载入团队清单后再校验合规状态。")).toBeTruthy();
  });

  test("agent detail filters skills and checks only the selected agent", async () => {
    const user = userEvent.setup();
    const scenario = createAgentDetailScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    const { container } = render(<App />);

    expect(await screen.findByTestId("workspace-skills")).toBeTruthy();
    expect(container.querySelectorAll(".agent-detail-summary")).toHaveLength(0);
    expect(screen.queryByTestId("agent-category-bar")).toBeNull();
    expect(screen.getByText("codex-planner")).toBeTruthy();
    expect(screen.getByText("claude-writer")).toBeTruthy();

    await user.click(screen.getByTestId("check-all-updates"));

    expect((await screen.findAllByText("待更新")).length).toBeGreaterThanOrEqual(1);
    expect(scenario.checkedSkillIds()).toEqual([["codex-planner", "claude-writer"]]);
  });

  test("local search stays global while showing each result agent", async () => {
    const user = userEvent.setup();
    const scenario = createAgentDetailScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    expect(await screen.findByTestId("skill-row-codex-planner")).toBeTruthy();

    await user.type(screen.getByTestId("skill-search-input"), "claude");

    const resultRow = await screen.findByTestId("skill-row-claude-writer");
    expect(within(resultRow).getByText("claude-writer")).toBeTruthy();
    expect(within(resultRow).queryByText("Claude Code")).toBeNull();
    expect(
      within(resultRow)
        .getByTestId("skill-agent-stack-claude-writer")
        .getAttribute("aria-label"),
    ).toBe("存在于 Claude Code");
    expect(screen.queryByText("codex-planner")).toBeNull();

    await user.clear(screen.getByTestId("skill-search-input"));

    expect(await screen.findByTestId("skill-row-codex-planner")).toBeTruthy();
    expect(screen.getByText("claude-writer")).toBeTruthy();
  });

  test("search deduplicates the same skill across agents and updates agent counts", async () => {
    const user = userEvent.setup();
    const scenario = createSearchDedupeScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await screen.findByTestId("skill-row-shared-codex");

    await user.type(screen.getByTestId("skill-search-input"), "shared");

    expect(await screen.findByTestId("skill-row-shared-codex")).toBeTruthy();
    expect(screen.queryByTestId("skill-row-shared-claude")).toBeNull();
    expect(screen.queryByTestId("agent-category-bar")).toBeNull();

    await user.clear(screen.getByTestId("skill-search-input"));
    await user.type(screen.getByTestId("skill-search-input"), "claude-only");

    expect(await screen.findByTestId("skill-row-claude-only")).toBeTruthy();
    expect(screen.queryByTestId("skill-row-shared-codex")).toBeNull();
    expect(screen.queryByTestId("skill-row-shared-claude")).toBeNull();
  });

  test("phase6 shows a cross-agent matrix on a bound skill detail page", async () => {
    const user = userEvent.setup();
    const scenario = createAgentDetailScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-codex-planner"));
    expect(await screen.findByTestId("skill-detail-codex-planner")).toBeTruthy();
    expect(screen.queryByText("本机 Skill 工作台")).toBeNull();
    expect(screen.queryByTestId("skill-search-input")).toBeNull();
    expect(screen.queryByTestId("check-all-updates")).toBeNull();
    expect(screen.queryByTestId("scan-skills")).toBeNull();
    expect(screen.getByTestId("skill-intro-card-codex-planner").className).toContain(
      "redesign-detail-summary",
    );
    expect(screen.queryByText("Name")).toBeNull();
    expect(screen.queryByText("Description")).toBeNull();
    expect(screen.queryByText("Paths")).toBeNull();
    expect(screen.queryByText("跨 Agent 安装状态")).toBeNull();
  });

  test("detail check action gives the redesign toast feedback", async () => {
    const user = userEvent.setup();
    const scenario = createAgentDetailScenario({ slowTargets: true, codexLocalModified: true });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-codex-planner"));
    expect(await screen.findByTestId("skill-detail-codex-planner")).toBeTruthy();

    await user.click(screen.getByTestId("check-updates-codex-planner"));

    expect(await screen.findByTestId("redesign-toast")).toBeTruthy();
    expect(await screen.findByTestId("check-panel-codex-planner")).toBeTruthy();
  });

  test("reuses an existing source when opening the same skill from another agent", async () => {
    const user = userEvent.setup();
    const scenario = createAgentDetailScenario({ includeUnboundDuplicate: true });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-claude-codex-planner"));

    expect(await screen.findByTestId("skill-detail-claude-codex-planner")).toBeTruthy();
    expect(screen.getByText("修改来源")).toBeTruthy();
    expect(screen.queryByText("跨 Agent 安装状态")).toBeNull();

    await user.click(screen.getByTestId("check-updates-claude-codex-planner"));

    expect(scenario.boundSkillIds()).toContain("claude-codex-planner");
    expect(scenario.checkedSkillIds()).toContainEqual(["claude-codex-planner"]);
  });

  test("keeps slow source save and diff buttons busy to prevent repeated clicks", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ slowBind: true, slowDiff: true });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    await user.click(screen.getByTestId("open-bind-source-e2e-skill"));
    await user.type(screen.getByTestId("bind-url-e2e-skill"), "file:///tmp/metis-e2e-repo");
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    const saveButton = screen.getByTestId("submit-bind-source-e2e-skill").closest("button");

    await user.click(saveButton as HTMLButtonElement);

    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expect(saveButton?.textContent).toContain("保存中");
    expect(scenario.commandCalls("bind_skill_source")).toBe(1);

    expect(await screen.findByText("修改来源")).toBeTruthy();
    await user.click(screen.getByTestId("toggle-diff-e2e-skill"));
    const diffButton = screen.getByTestId("toggle-diff-e2e-skill");

    expect((diffButton as HTMLButtonElement).disabled).toBe(true);
    expect(diffButton.textContent).toContain("加载 diff");
    expect(scenario.commandCalls("get_skill_diff")).toBe(1);

    expect(
      await screen.findByText((content) => content.includes("diff --git a/SKILL.md b/SKILL.md")),
    ).toBeTruthy();
  });

  test("B direction keeps list browsing compact and opens a dedicated Push detail page", async () => {
    const user = userEvent.setup();
    const scenario = createAgentDetailScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    expect(await screen.findByTestId("workspace-skills")).toBeTruthy();
    expect(screen.queryByTestId("skill-status-filters")).toBeNull();
    const row = await screen.findByTestId("skill-row-codex-planner");
    expect(within(row).queryByText("备份/回滚")).toBeNull();
    expect(within(row).queryByText(/metadata:/)).toBeNull();
    expect(within(row).queryByText("Codex")).toBeNull();
    expect(
      within(row)
        .getByTestId("skill-agent-stack-codex-planner")
        .getAttribute("aria-label"),
    ).toBe("存在于 Codex");

    await user.click(row);

    expect(await screen.findByTestId("skill-detail-codex-planner")).toBeTruthy();
    expect(screen.queryByText("本机 Skill 工作台")).toBeNull();
    expect(screen.queryByTestId("skill-search-input")).toBeNull();
    expect(screen.queryByTestId("check-all-updates")).toBeNull();
    expect(screen.getByTestId("skill-detail-codex-planner").className).toContain(
      "redesign-detail",
    );
    expect(screen.getByTestId("skill-intro-card-codex-planner")).toBeTruthy();
    expect(screen.getByTestId("skill-intro-card-codex-planner").className).toContain(
      "redesign-detail-summary",
    );
    expect(screen.getByTestId("skill-detail-reference-summary-codex-planner")).toBeTruthy();
    expect(screen.getByTestId("skill-operations-card-codex-planner").className).toContain(
      "redesign-update-workbench",
    );
    const introCard = within(screen.getByTestId("skill-intro-card-codex-planner"));
    expect(introCard.queryByText("Name")).toBeNull();
    expect(introCard.queryByText("Description")).toBeNull();
    expect(introCard.queryByText("Paths")).toBeNull();
    expect(introCard.getByText("codex-planner")).toBeTruthy();
    expect(introCard.getByText("Codex managed skill")).toBeTruthy();
    expect(introCard.queryByText("Codex")).toBeNull();
    expect(introCard.queryByText("/Users/me/.codex/skills/codex-planner")).toBeNull();
    expect(introCard.queryByText("opencode")).toBeNull();
    expect(introCard.queryByText("/Users/me/.opencode/skills/codex-planner")).toBeNull();
    expect(introCard.queryByText("/Users/me/.claude/skills/codex-planner")).toBeNull();
    expect(screen.getByTestId("skill-operations-card-codex-planner")).toBeTruthy();
    const sourceSummary = within(screen.getByTestId("skill-source-summary-codex-planner"));
    expect(sourceSummary.getByText("来源")).toBeTruthy();
    expect(sourceSummary.getByText("file:///tmp/metis-agent-detail")).toBeTruthy();
    expect(sourceSummary.getByText("skills/codex-planner · main")).toBeTruthy();
    expect(sourceSummary.getByTestId("open-bind-source-codex-planner").textContent).toContain(
      "修改来源",
    );
    expect(sourceSummary.getByTestId("open-bind-source-codex-planner").className).toContain(
      "redesign-source-action",
    );
    expect(screen.getByText("返回")).toBeTruthy();
    expect(screen.queryByText("Skills / codex-planner")).toBeNull();
    expect(screen.queryByTestId("apply-update-codex-planner")).toBeNull();
    expect(screen.queryByText("跨 Agent 安装状态")).toBeNull();

    await user.click(screen.getByTestId("open-bind-source-codex-planner"));
    expect(await screen.findByTestId("source-drawer-codex-planner")).toBeTruthy();
    expect(screen.getByText("修改来源信息")).toBeTruthy();

    await user.click(screen.getByText("返回"));

    expect(await screen.findByTestId("skill-row-codex-planner")).toBeTruthy();
    expect(screen.queryByTestId("skill-detail-codex-planner")).toBeNull();
  });
});

describe("Metis desktop GUI error paths", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("exposes the apply update action only after an update is available", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    expect(await screen.findByTestId("skill-detail-e2e-skill")).toBeTruthy();
    expect(screen.queryByTestId("apply-update-e2e-skill")).toBeNull();

    await user.click(screen.getByTestId("open-bind-source-e2e-skill"));
    await user.type(screen.getByTestId("bind-url-e2e-skill"), "file:///tmp/metis-e2e-repo");
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.click(screen.getByTestId("submit-bind-source-e2e-skill"));
    await user.click(await screen.findByTestId("check-updates-e2e-skill"));

    expect(await screen.findByTestId("apply-update-e2e-skill")).toBeTruthy();
  });

  test("keeps manual apply update available when local files are modified", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ localModifiedAfterCheck: true });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    await user.click(screen.getByTestId("open-bind-source-e2e-skill"));
    await user.type(screen.getByTestId("bind-url-e2e-skill"), "file:///tmp/metis-e2e-repo");
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.click(screen.getByTestId("submit-bind-source-e2e-skill"));
    await user.click(await screen.findByTestId("check-updates-e2e-skill"));

    const applyButton = await screen.findByTestId("apply-update-e2e-skill");
    expect(screen.getByText("本地修改，可手动覆盖")).toBeTruthy();
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);

    await user.click(applyButton);
    expect(await screen.findByText(/更新完成：aaa111 -> bbb222/)).toBeTruthy();
    expect(await screen.findByText("pre-update")).toBeTruthy();
  });

  test("shows manual apply update when remote is current but local files are modified", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({
      localModifiedAfterCheck: true,
      upToDateAfterCheck: true,
    });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    await user.click(screen.getByTestId("open-bind-source-e2e-skill"));
    await user.type(screen.getByTestId("bind-url-e2e-skill"), "file:///tmp/metis-e2e-repo");
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.click(screen.getByTestId("submit-bind-source-e2e-skill"));
    await user.click(await screen.findByTestId("check-updates-e2e-skill"));

    const applyButton = await screen.findByTestId("apply-update-e2e-skill");
    expect(screen.getByText("本地修改，可手动覆盖")).toBeTruthy();
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);
  });
});

function createMainFlowScenario(
  options: {
    localModifiedAfterCheck?: boolean;
    slowBind?: boolean;
    slowDiff?: boolean;
    upToDateAfterCheck?: boolean;
  } = {},
) {
  let source: DesktopSource = {
    id: "source-e2e-skill",
    source_type: "git",
    url: "file:///tmp/metis-e2e-repo",
    repo_path: "skills/e2e-skill",
    ref_: "main",
    current_commit: "aaa111",
    remote_commit: null,
    last_checked_at: null,
    trusted: false,
    auto_update: false,
    credential_ref: null,
  };
  let skill: DesktopSkill = {
    id: "e2e-skill",
    agent_id: "generic",
    agent_name: "Generic Agent Skills",
    name: "e2e-skill",
    description: "Baseline skill",
    install_path: "/tmp/metis-e2e/skills/e2e-skill",
    metadata_path: "/tmp/metis-e2e/skills/e2e-skill/SKILL.md",
    metadata_status: "found",
    metadata_error: null,
    source_id: null,
    source: null,
    local_modified: false,
    last_scanned_at: "2026-06-20T10:00:00Z",
  };
  let backups: DesktopBackupSummary[] = [backup("backup-pre-update", "pre-update", "aaa111")];
  let indexedSkills: DesktopSkill[] = [];
  const calls = new Map<string, number>();

  const agents: DesktopAgentStatus[] = [
    {
      agent_id: "generic",
      agent_name: "Generic Agent Skills",
      enabled: true,
      paths: [
        {
          path: "/tmp/metis-e2e/skills",
          scope: "custom",
          exists: true,
          readable: true,
          writable: true,
        },
      ],
    },
  ];
  let settings: DesktopSettings = { custom_scan_paths: [], team_policy_path: null };

  return {
    commandCalls: (command: string) => calls.get(command) ?? 0,
    async invoke(command: string, args?: unknown) {
      calls.set(command, (calls.get(command) ?? 0) + 1);
      switch (command) {
        case "list_agents":
          return agents;
        case "list_indexed_skills":
          return indexedSkills;
        case "get_desktop_settings":
          return settings;
        case "save_desktop_settings": {
          const request = args as { settings: DesktopSettings };
          settings = request.settings;
          return settings;
        }
        case "get_team_policy_summary":
          return settings.team_policy_path
            ? {
                version: "1",
                trusted_sources: 1,
                allow_auto_update: true,
                require_trusted_source: true,
              }
            : null;
        case "get_team_policy_audit_report":
          return {
            generated_at: "2026-06-20T11:00:00Z",
            total_bound_sources: 3,
            compliant: 1,
            should_mark_trusted: 1,
            auto_update_disallowed: 1,
            items: [
              {
                skill_id: "skill-compliant",
                skill_name: "Compliant",
                source_id: "source-compliant",
                source_url: "https://github.com/example/team.git",
                source_repo_path: "skills/compliant",
                source_ref: "main",
                current_trusted: true,
                current_auto_update: true,
                policy_trusted: true,
                auto_update_allowed: true,
                status: "compliant",
                recommendation: "当前 source 与团队策略一致。",
              },
              {
                skill_id: "skill-needs-trusted",
                skill_name: "Needs Trusted",
                source_id: "source-needs-trusted",
                source_url: "https://github.com/example/team.git",
                source_repo_path: "skills/needs-trusted",
                source_ref: "main",
                current_trusted: false,
                current_auto_update: true,
                policy_trusted: true,
                auto_update_allowed: true,
                status: "should_mark_trusted",
                recommendation: "该 source 命中团队 trusted source，建议标记为 trusted。",
              },
              {
                skill_id: "skill-untrusted-auto",
                skill_name: "Untrusted Auto",
                source_id: "source-untrusted-auto",
                source_url: "https://github.com/example/personal.git",
                source_repo_path: "skills/untrusted",
                source_ref: "main",
                current_trusted: false,
                current_auto_update: true,
                policy_trusted: false,
                auto_update_allowed: false,
                status: "auto_update_disallowed",
                recommendation: "关闭 auto update，或将该 source 加入团队 trusted_sources。",
              },
            ],
          };
        case "scan_skills":
          indexedSkills = [skill];
          return { skills: [skill], warnings: [] };
        case "bind_skill_source": {
          if (options.slowBind) {
            await delay(80);
          }
          const request = args as {
            request: {
              url: string;
              repo_path: string;
              ref_: string;
              auto_update: boolean;
              trusted: boolean;
            };
          };
          const policyTrusted =
            settings.team_policy_path &&
            request.request.url === "https://github.com/example/team-skills.git" &&
            request.request.repo_path === "skills/e2e-skill" &&
            request.request.ref_ === "main";
          source = {
            ...source,
            url: request.request.url,
            repo_path: request.request.repo_path,
            ref_: request.request.ref_,
            trusted: Boolean(request.request.trusted || policyTrusted),
            auto_update: request.request.auto_update && Boolean(policyTrusted),
          };
          skill = { ...skill, source_id: source.id, source };
          indexedSkills = [skill];
          return source;
        }
        case "preview_remote_skill_source":
          return {
            name: "Remote Skill",
            description: "Remote sync candidate",
            install_name: "remote",
            commit: "abc123",
            repo_path: "skills/remote",
          };
        case "get_skill_targets_for_source":
          return [
            {
              agent_id: "codex",
              agent_name: "Codex",
              root_path: "/tmp/codex-skills",
              install_path: "/tmp/codex-skills/remote",
              status: "NotInstalled",
              local_modified: false,
              skill_id: null,
              source_id: null,
              root_available: true,
              root_status: "available",
            },
            {
              agent_id: "claude-code",
              agent_name: "Claude Code",
              root_path: "/tmp/claude-skills",
              install_path: "/tmp/claude-skills/remote",
              status: "AgentRootUnavailable",
              local_modified: false,
              skill_id: null,
              source_id: null,
              root_available: false,
              root_status: "missing",
            },
          ];
        case "install_remote_skill_to_targets":
          return {
            targets: [
              {
                agent_id: "codex",
                install_path: "/tmp/codex-skills/remote",
                status: "Installed",
                reason: null,
                skill_id: "codex-remote",
                backup_id: null,
              },
            ],
          };
        case "check_skill_updates":
          return [
            updateResult(
              skill,
              source,
              options.localModifiedAfterCheck === true,
              options.upToDateAfterCheck === true ? "UpToDate" : "UpdateAvailable",
            ),
          ];
        case "get_skill_diff":
          if (options.slowDiff) {
            await delay(80);
          }
          return diffDetail();
        case "apply_skill_update": {
          const result: DesktopApplyUpdateResult = {
            skill_id: "e2e-skill",
            previous_commit: "aaa111",
            new_commit: "bbb222",
            backup_id: "backup-pre-update",
            security_findings: [],
            warnings: [],
          };
          source = {
            ...source,
            current_commit: "bbb222",
            remote_commit: "bbb222",
          };
          skill = {
            ...skill,
            description: "Updated skill",
            source_id: source.id,
            source,
            local_modified: false,
          };
          backups = [backup("backup-pre-update", "pre-update", "aaa111")];
          indexedSkills = [skill];
          return result;
        }
        case "list_skill_backups":
          return backups;
        case "restore_skill_backup":
          backups = [
            backup("backup-pre-rollback", "pre-rollback", "bbb222"),
            backup("backup-pre-update", "pre-update", "aaa111"),
          ];
          skill = {
            ...skill,
            description: "Baseline skill",
            source: {
              ...source,
              current_commit: "aaa111",
              remote_commit: "bbb222",
            },
          };
          indexedSkills = [skill];
          return {
            skill_id: "e2e-skill",
            restored_from_backup_id: "backup-pre-update",
            previous_state_backup_id: "backup-pre-rollback",
          };
        default:
          throw new Error(`Unexpected invoke command: ${command} ${JSON.stringify(args)}`);
      }
    },
  };
}

function createBetaReadinessScenario() {
  const trustedSource: DesktopSource = {
    id: "source-trusted-skill",
    source_type: "git",
    url: "file:///tmp/metis-trusted-repo",
    repo_path: "skills/trusted-skill",
    ref_: "main",
    current_commit: "aaa111",
    remote_commit: "bbb222",
    last_checked_at: "2026-06-20T10:00:00Z",
    trusted: true,
    auto_update: true,
    credential_ref: "secret-token",
  };
  const untrustedSource: DesktopSource = {
    id: "source-untrusted-skill",
    source_type: "git",
    url: "file:///tmp/metis-untrusted-repo",
    repo_path: "skills/untrusted-skill",
    ref_: "main",
    current_commit: "ccc333",
    remote_commit: "ddd444",
    last_checked_at: "2026-06-20T10:00:00Z",
    trusted: false,
    auto_update: true,
    credential_ref: "secret-token",
  };
  let skills: DesktopSkill[] = [
    betaSkill("trusted-skill", "Trusted Skill", trustedSource),
    betaSkill("untrusted-skill", "Untrusted Skill", untrustedSource),
  ];
  const applied: string[] = [];
  const exported: string[] = [];
  const agents: DesktopAgentStatus[] = [
    {
      agent_id: "generic",
      agent_name: "Generic Agent Skills",
      enabled: true,
      paths: [
        {
          path: "/tmp/metis-beta/skills",
          scope: "custom",
          exists: true,
          readable: true,
          writable: true,
        },
      ],
    },
  ];

  return {
    appliedSkillIds: () => applied,
    exportedPaths: () => exported,
    async invoke(command: string, args?: unknown) {
      switch (command) {
        case "list_agents":
          return agents;
        case "list_indexed_skills":
          return skills;
        case "get_desktop_settings":
          return { custom_scan_paths: ["/tmp/metis-beta/skills"] };
        case "export_environment_report":
          return {
            generated_at: "2026-06-20T10:02:00Z",
            total_skills: 2,
            bound_sources: 2,
            trusted_sources: 1,
            auto_update_sources: 2,
            local_modified_skills: 0,
            agents,
            skills: skills.map((skill) => ({
              id: skill.id,
              name: skill.name,
              agent_id: skill.agent_id,
              install_path: skill.install_path,
              metadata_status: skill.metadata_status,
              local_modified: skill.local_modified,
              source: skill.source
                ? {
                    url: skill.source.url,
                    repo_path: skill.source.repo_path,
                    ref_: skill.source.ref_,
                    current_commit: skill.source.current_commit,
                    trusted: skill.source.trusted,
                    auto_update: skill.source.auto_update,
                    has_credential_ref: Boolean(skill.source.credential_ref),
                  }
                : null,
            })),
          };
        case "load_team_manifest_from_file":
          return JSON.stringify({
            version: "1",
            exported_at: "2026-06-20T12:00:00Z",
            skills: [
              {
                name: "Trusted Skill",
                agent_id: "generic",
                source_url: "file:///tmp/metis-trusted",
                source_repo_path: "skills/trusted",
                source_ref: "main",
                source_commit: "aaa111",
                install_path_hint: null,
              },
            ],
          });
        case "export_team_compliance_report_to_file": {
          const request = args as { request: { output_path: string } };
          exported.push(request.request.output_path);
          return {
            output_path: request.request.output_path,
            bytes_written: 2048,
          };
        }
        case "export_environment_report_to_file": {
          const request = args as { outputPath: string };
          exported.push(request.outputPath);
          return {
            output_path: request.outputPath,
            bytes_written: 1024,
          };
        }
        case "export_audit_log_report_to_file": {
          const request = args as { request: { output_path: string } };
          exported.push(request.request.output_path);
          return {
            output_path: request.request.output_path,
            bytes_written: 512,
          };
        }
        case "check_team_manifest_compliance":
          return {
            generated_at: "2026-06-20T10:03:00Z",
            manifest_version: "1",
            summary: {
              total: 5,
              installed: 1,
              missing: 1,
              version_mismatch: 1,
              local_modified: 1,
              source_mismatch: 1,
            },
            items: [
              {
                name: "Trusted Skill",
                agent_id: "generic",
                status: "installed",
                expected_source_url: "file:///tmp/metis-trusted",
                expected_source_repo_path: "skills/trusted",
                expected_source_ref: "main",
                expected_commit: "aaa111",
                local_skill_id: "trusted-skill",
                local_install_path: "/tmp/metis-beta/skills/trusted",
                local_source_url: "file:///tmp/metis-trusted",
                local_source_repo_path: "skills/trusted",
                local_source_ref: "main",
                local_commit: "aaa111",
                local_modified: false,
                trusted_source: true,
              },
              {
                name: "Outdated Skill",
                agent_id: "generic",
                status: "version_mismatch",
                expected_source_url: "file:///tmp/metis-trusted",
                expected_source_repo_path: "skills/outdated",
                expected_source_ref: "main",
                expected_commit: "bbb222",
                local_skill_id: "outdated-skill",
                local_install_path: "/tmp/metis-beta/skills/outdated",
                local_source_url: "file:///tmp/metis-trusted",
                local_source_repo_path: "skills/outdated",
                local_source_ref: "main",
                local_commit: "aaa111",
                local_modified: false,
                trusted_source: true,
              },
              {
                name: "Edited Skill",
                agent_id: "generic",
                status: "local_modified",
                expected_source_url: "file:///tmp/metis-trusted",
                expected_source_repo_path: "skills/edited",
                expected_source_ref: "main",
                expected_commit: "ccc333",
                local_skill_id: "edited-skill",
                local_install_path: "/tmp/metis-beta/skills/edited",
                local_source_url: "file:///tmp/metis-trusted",
                local_source_repo_path: "skills/edited",
                local_source_ref: "main",
                local_commit: "ccc333",
                local_modified: true,
                trusted_source: true,
              },
              {
                name: "Wrong Source",
                agent_id: "generic",
                status: "source_mismatch",
                expected_source_url: "file:///tmp/metis-trusted",
                expected_source_repo_path: "skills/wrong",
                expected_source_ref: "main",
                expected_commit: "ddd444",
                local_skill_id: "wrong-source-skill",
                local_install_path: "/tmp/metis-beta/skills/wrong",
                local_source_url: "file:///tmp/personal",
                local_source_repo_path: "skills/wrong",
                local_source_ref: "main",
                local_commit: "ddd444",
                local_modified: false,
                trusted_source: false,
              },
              {
                name: "Missing Skill",
                agent_id: "generic",
                status: "missing",
                expected_source_url: "file:///tmp/metis-trusted",
                expected_source_repo_path: "skills/missing",
                expected_source_ref: "main",
                expected_commit: "eee555",
                local_skill_id: null,
                local_install_path: null,
                local_source_url: null,
                local_source_repo_path: null,
                local_source_ref: null,
                local_commit: null,
                local_modified: null,
                trusted_source: null,
              },
            ],
          };
        case "check_skill_updates": {
          const request = args as { request: { skill_ids: string[] } };
          return skills
            .filter((skill) => request.request.skill_ids.includes(skill.id))
            .map((skill) => updateResult(skill, skill.source as DesktopSource));
        }
        case "apply_skill_update": {
          const request = args as { skillId: string };
          applied.push(request.skillId);
          skills = skills.map((skill) =>
            skill.id === request.skillId && skill.source
              ? {
                  ...skill,
                  source: {
                    ...skill.source,
                    current_commit: skill.source.remote_commit,
                  },
                }
              : skill,
          );
          return {
            ...applyResult(),
            skill_id: request.skillId,
            previous_commit: request.skillId === "trusted-skill" ? "aaa111" : "ccc333",
            new_commit: request.skillId === "trusted-skill" ? "bbb222" : "ddd444",
          };
        }
        default:
          throw new Error(`Unexpected invoke command: ${command}`);
      }
    },
  };
}

function createEmptyWorkspaceScenario() {
  const agents: DesktopAgentStatus[] = [
    {
      agent_id: "generic",
      agent_name: "Generic Agent Skills",
      enabled: true,
      paths: [
        {
          path: "/tmp/metis-empty/skills",
          scope: "custom",
          exists: true,
          readable: true,
          writable: true,
        },
      ],
    },
  ];

  return {
    async invoke(command: string, _args?: unknown) {
      switch (command) {
        case "list_agents":
          return agents;
        case "list_indexed_skills":
          return [];
        case "get_desktop_settings":
          return { custom_scan_paths: [] };
        case "scan_skills":
          return { skills: [], warnings: [] };
        default:
          throw new Error(`Unexpected invoke command: ${command}`);
      }
    },
  };
}

function createAgentDetailScenario(
  options: {
    codexLocalModified?: boolean;
    extraSkillCount?: number;
    includeUnboundDuplicate?: boolean;
    slowTargets?: boolean;
  } = {},
) {
  const codexSource: DesktopSource = {
    id: "source-codex-planner",
    source_type: "git",
    url: "file:///tmp/metis-agent-detail",
    repo_path: "skills/codex-planner",
    ref_: "main",
    current_commit: "aaa111",
    remote_commit: "bbb222",
    last_checked_at: null,
    trusted: true,
    auto_update: false,
    credential_ref: null,
  };
  const claudeSource: DesktopSource = {
    id: "source-claude-writer",
    source_type: "git",
    url: "file:///tmp/metis-agent-detail",
    repo_path: "skills/claude-writer",
    ref_: "main",
    current_commit: "ccc333",
    remote_commit: "ddd444",
    last_checked_at: null,
    trusted: true,
    auto_update: false,
    credential_ref: null,
  };
  const skills: DesktopSkill[] = [
    agentDetailSkill("codex-planner", "codex", "Codex", codexSource),
    agentDetailSkill("claude-writer", "claude-code", "Claude Code", claudeSource),
  ];
  for (let index = 0; index < (options.extraSkillCount ?? 0); index += 1) {
    skills.push(
      agentDetailSkill(
        `extra-skill-${index}`,
        index % 2 === 0 ? "codex" : "claude-code",
        index % 2 === 0 ? "Codex" : "Claude Code",
        index % 2 === 0 ? codexSource : claudeSource,
      ),
    );
  }
  if (options.includeUnboundDuplicate) {
    skills.push({
      ...agentDetailSkill("claude-codex-planner", "claude-code", "Claude Code", null),
      name: "codex-planner",
      description: "Codex managed skill",
      install_path: "/Users/me/.claude/skills/codex-planner",
      metadata_path: "/Users/me/.claude/skills/codex-planner/SKILL.md",
    });
  }
  const agents: DesktopAgentStatus[] = [
    {
      agent_id: "codex",
      agent_name: "Codex",
      enabled: true,
      paths: [
        {
          path: "/Users/me/.codex/skills",
          scope: "user",
          exists: true,
          readable: true,
          writable: true,
        },
      ],
    },
    {
      agent_id: "claude-code",
      agent_name: "Claude Code",
      enabled: true,
      paths: [
        {
          path: "/Users/me/.claude/skills",
          scope: "user",
          exists: true,
          readable: true,
          writable: true,
        },
      ],
    },
  ];
  const checked: string[][] = [];
  const bound: string[] = [];

  return {
    checkedSkillIds: () => checked,
    boundSkillIds: () => bound,
    async invoke(command: string, args?: unknown) {
      switch (command) {
        case "list_agents":
          return agents;
        case "list_indexed_skills":
          return skills;
        case "get_desktop_settings":
          return { custom_scan_paths: [] };
        case "check_skill_updates": {
          const request = args as { request: { skill_ids: string[] } };
          checked.push(request.request.skill_ids);
          return skills
            .filter((skill) => request.request.skill_ids.includes(skill.id))
            .map((skill) => updateResult(skill, (skill.source ?? codexSource) as DesktopSource));
        }
        case "bind_skill_source": {
          const request = args as { request: { skill_id: string } };
          const skill = skills.find((item) => item.id === request.request.skill_id);
          if (!skill) {
            throw new Error(`missing skill ${request.request.skill_id}`);
          }
          skill.source_id = codexSource.id;
          skill.source = codexSource;
          bound.push(skill.id);
          return codexSource;
        }
        case "preview_remote_skill_source":
          if (options.slowTargets) {
            await delay(80);
          }
          return {
            name: "codex-planner",
            description: "Codex managed skill",
            install_name: "codex-planner",
            commit: "bbb222",
            repo_path: "skills/codex-planner",
          };
        case "get_skill_targets_for_source":
          return [
            {
              agent_id: "codex",
              agent_name: "Codex",
              root_path: "/Users/me/.codex/skills",
              install_path: "/Users/me/.codex/skills/codex-planner",
              status: "UpToDate",
              local_modified: options.codexLocalModified === true,
              skill_id: "codex-planner",
              source_id: "source-codex-planner",
              root_available: true,
              root_status: "available",
            },
            {
              agent_id: "claude-code",
              agent_name: "Claude Code",
              root_path: "/Users/me/.claude/skills",
              install_path: "/Users/me/.claude/skills/codex-planner",
              status: "NotInstalled",
              local_modified: false,
              skill_id: null,
              source_id: null,
              root_available: true,
              root_status: "available",
            },
            {
              agent_id: "opencode",
              agent_name: "opencode",
              root_path: "/Users/me/.opencode/skills",
              install_path: "/Users/me/.opencode/skills/codex-planner",
              status: "UpToDate",
              local_modified: false,
              skill_id: "opencode-codex-planner",
              source_id: "source-opencode-codex-planner",
              root_available: true,
              root_status: "available",
            },
          ];
        default:
          throw new Error(`Unexpected invoke command: ${command}`);
      }
    },
  };
}

function createSearchDedupeScenario() {
  const sharedSource: DesktopSource = {
    id: "source-shared",
    source_type: "git",
    url: "file:///tmp/metis-shared",
    repo_path: "skills/shared-tool",
    ref_: "main",
    current_commit: "aaa111",
    remote_commit: "aaa111",
    last_checked_at: null,
    trusted: true,
    auto_update: false,
    credential_ref: null,
  };
  const claudeOnlySource: DesktopSource = {
    id: "source-claude-only",
    source_type: "git",
    url: "file:///tmp/metis-claude-only",
    repo_path: "skills/claude-only",
    ref_: "main",
    current_commit: "ccc333",
    remote_commit: "ccc333",
    last_checked_at: null,
    trusted: true,
    auto_update: false,
    credential_ref: null,
  };
  const agents: DesktopAgentStatus[] = [
    {
      agent_id: "codex",
      agent_name: "Codex",
      enabled: true,
      paths: [
        {
          path: "/Users/me/.codex/skills",
          scope: "user",
          exists: true,
          readable: true,
          writable: true,
        },
      ],
    },
    {
      agent_id: "claude-code",
      agent_name: "Claude Code",
      enabled: true,
      paths: [
        {
          path: "/Users/me/.claude/skills",
          scope: "user",
          exists: true,
          readable: true,
          writable: true,
        },
      ],
    },
  ];
  const skills: DesktopSkill[] = [
    {
      ...agentDetailSkill("shared-codex", "codex", "Codex", sharedSource),
      name: "shared-tool",
      description: "Shared skill across agents",
      install_path: "/Users/me/.codex/skills/shared-tool",
      metadata_path: "/Users/me/.codex/skills/shared-tool/SKILL.md",
    },
    {
      ...agentDetailSkill("shared-claude", "claude-code", "Claude Code", sharedSource),
      name: "shared-tool",
      description: "Shared skill across agents",
      install_path: "/Users/me/.claude/skills/shared-tool",
      metadata_path: "/Users/me/.claude/skills/shared-tool/SKILL.md",
    },
    {
      ...agentDetailSkill("claude-only", "claude-code", "Claude Code", claudeOnlySource),
      name: "claude-only",
      description: "Claude-only helper",
      install_path: "/Users/me/.claude/skills/claude-only",
      metadata_path: "/Users/me/.claude/skills/claude-only/SKILL.md",
    },
  ];

  return {
    async invoke(command: string, _args?: unknown) {
      switch (command) {
        case "list_agents":
          return agents;
        case "list_indexed_skills":
          return skills;
        case "get_desktop_settings":
          return { custom_scan_paths: [] };
        default:
          throw new Error(`Unexpected invoke command: ${command}`);
      }
    },
  };
}

function agentDetailSkill(
  id: string,
  agentId: string,
  agentName: string,
  source: DesktopSource | null,
): DesktopSkill {
  return {
    id,
    agent_id: agentId,
    agent_name: agentName,
    name: id,
    description: `${agentName} managed skill`,
    install_path: `/Users/me/.${agentId}/skills/${id}`,
    metadata_path: `/Users/me/.${agentId}/skills/${id}/SKILL.md`,
    metadata_status: "found",
    metadata_error: null,
    source_id: source?.id ?? null,
    source,
    local_modified: false,
    last_scanned_at: "2026-06-20T10:00:00Z",
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function betaSkill(id: string, name: string, source: DesktopSource): DesktopSkill {
  return {
    id,
    agent_id: "generic",
    agent_name: "Generic Agent Skills",
    name,
    description: "Beta managed skill",
    install_path: `/tmp/metis-beta/skills/${id}`,
    metadata_path: `/tmp/metis-beta/skills/${id}/SKILL.md`,
    metadata_status: "found",
    metadata_error: null,
    source_id: source.id,
    source,
    local_modified: false,
    last_scanned_at: "2026-06-20T10:00:00Z",
  };
}

function updateResult(
  skill: DesktopSkill,
  source: DesktopSource,
  localModified = false,
  status: DesktopUpdateCheckResult["status"] = "UpdateAvailable",
): DesktopUpdateCheckResult {
  return {
    skill_id: skill.id,
    skill_name: skill.name,
    status,
    failure_reason: null,
    local_modified: localModified,
    commits_behind: status === "UpdateAvailable" ? 2 : null,
    diff_summary:
      status === "UpdateAvailable"
        ? {
            files_added: 1,
            files_modified: 1,
            files_deleted: 0,
            total_changes: 2,
          }
        : null,
    source: {
      ...source,
      remote_commit: status === "UpdateAvailable" ? "bbb222" : source.current_commit,
    },
  };
}

function diffDetail(): DesktopDiffDetail {
  return {
    skill_id: "e2e-skill",
    current_commit: "aaa111",
    target_commit: "bbb222",
    files: [
      {
        path: "SKILL.md",
        old_path: null,
        status: "Modified",
        patch: "diff --git a/SKILL.md b/SKILL.md\n+description: Updated skill",
      },
    ],
  };
}

function applyResult(): DesktopApplyUpdateResult {
  return {
    skill_id: "e2e-skill",
    previous_commit: "aaa111",
    new_commit: "bbb222",
    backup_id: "backup-pre-update",
    security_findings: [],
    warnings: [],
  };
}

function backup(
  backup_id: string,
  reason: string,
  source_commit: string,
): DesktopBackupSummary {
  return {
    backup_id,
    skill_id: "e2e-skill",
    source_commit,
    backup_path: `/tmp/metis-e2e/backups/${backup_id}`,
    created_at: "2026-06-20T10:01:00Z",
    reason,
    file_count: 1,
    total_size_bytes: 128,
  };
}
