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

  test("runs scan, bind, check, diff, apply, and rollback from the UI", async () => {
    const user = userEvent.setup();

    render(<App />);

    const skillRow = await screen.findByTestId("skill-row-e2e-skill");
    expect(invokeMock).toHaveBeenCalledWith("scan_skills");
    expect(within(skillRow).getByText("e2e-skill")).toBeTruthy();
    expect(within(skillRow).getByText("未绑定来源")).toBeTruthy();

    await user.click(within(skillRow).getByTestId("open-bind-source-e2e-skill"));
    await user.type(screen.getByTestId("bind-url-e2e-skill"), "file:///tmp/metis-e2e-repo");
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.clear(screen.getByTestId("bind-ref-e2e-skill"));
    await user.type(screen.getByTestId("bind-ref-e2e-skill"), "main");
    await user.click(screen.getByTestId("submit-bind-source-e2e-skill"));

    expect(await screen.findByText("file:///tmp/metis-e2e-repo")).toBeTruthy();

    const boundRow = await screen.findByTestId("skill-row-e2e-skill");
    await user.click(within(boundRow).getByTestId("check-updates-e2e-skill"));

    expect(await screen.findByText("有更新")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("~1")).toBeTruthy();
    expect(screen.getByText("2 commits behind")).toBeTruthy();

    await user.click(
      within(await screen.findByTestId("skill-row-e2e-skill")).getByTestId(
        "toggle-diff-e2e-skill",
      ),
    );

    expect(
      await screen.findByText((content) => content.includes("diff --git a/SKILL.md b/SKILL.md")),
    ).toBeTruthy();
    expect(
      screen.getByText((content) => content.includes("+description: Updated skill")),
    ).toBeTruthy();

    await user.click(
      within(await screen.findByTestId("skill-row-e2e-skill")).getByTestId(
        "apply-update-e2e-skill",
      ),
    );

    expect(await screen.findByText(/更新完成：aaa111 -> bbb222/)).toBeTruthy();
    expect(await screen.findByText("pre-update")).toBeTruthy();

    await user.click(screen.getByTestId("restore-backup-e2e-skill-backup-pre-update"));

    expect(await screen.findByText(/已回滚到 backup-pre-update/)).toBeTruthy();
    expect(await screen.findByText("pre-rollback")).toBeTruthy();
  });

  test("exports environment report and runs trusted auto updates only", async () => {
    const user = userEvent.setup();
    const scenario = createBetaReadinessScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("workspace-tab-governance"));
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

    await user.click(await screen.findByTestId("workspace-tab-governance"));
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

    await user.click(await screen.findByTestId("workspace-tab-governance"));
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

    await user.click(screen.getByTestId("workspace-tab-skills"));
    const skillRow = await screen.findByTestId("skill-row-e2e-skill");
    await user.click(within(skillRow).getByTestId("open-bind-source-e2e-skill"));
    await user.type(
      screen.getByTestId("bind-url-e2e-skill"),
      "https://github.com/example/team-skills.git",
    );
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.clear(screen.getByTestId("bind-ref-e2e-skill"));
    await user.type(screen.getByTestId("bind-ref-e2e-skill"), "main");
    await user.click(screen.getByTestId("bind-auto-update-e2e-skill"));
    await user.click(screen.getByTestId("submit-bind-source-e2e-skill"));

    const boundRow = await screen.findByTestId("skill-row-e2e-skill");
    expect(within(boundRow).getByText("trusted source")).toBeTruthy();
    expect(within(boundRow).getByText("auto update on")).toBeTruthy();
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

  test("phase5 organizes features into skills governance and settings workspaces", async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByTestId("workspace-skills")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Skills/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Governance/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Settings/ })).toBeTruthy();
    expect(screen.getByTestId("workspace-tab-skills").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Skill 索引")).toBeTruthy();
    expect(screen.queryByText("团队清单合规")).toBeNull();

    await user.click(screen.getByTestId("workspace-tab-governance"));
    expect(await screen.findByTestId("workspace-governance")).toBeTruthy();
    expect(screen.getByTestId("workspace-tab-governance").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText("团队清单合规")).toBeTruthy();
    expect(screen.getByText("本地审计导出")).toBeTruthy();
    expect(screen.queryByText("Skill 索引")).toBeNull();

    await user.click(screen.getByTestId("workspace-tab-settings"));
    expect(await screen.findByTestId("workspace-settings")).toBeTruthy();
    expect(screen.getByTestId("workspace-tab-settings").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("扫描路径")).toBeTruthy();
    expect(screen.getByText("企业网络")).toBeTruthy();
    expect(screen.queryByText("团队清单合规")).toBeNull();
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

    await user.click(screen.getByTestId("workspace-tab-governance"));
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

    render(<App />);

    await user.click(await screen.findByTestId("agent-row-codex"));

    expect(await screen.findByTestId("agent-detail-codex")).toBeTruthy();
    expect(screen.getByText("Codex 工作区")).toBeTruthy();
    expect(screen.getByText("codex-planner")).toBeTruthy();
    expect(screen.queryByText("claude-writer")).toBeNull();

    await user.click(screen.getByTestId("check-agent-updates-codex"));

    expect(await screen.findByText("有更新")).toBeTruthy();
    expect(scenario.checkedSkillIds()).toEqual([["codex-planner"]]);
  });

  test("local search stays global while showing each result agent", async () => {
    const user = userEvent.setup();
    const scenario = createAgentDetailScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("agent-row-codex"));
    expect(screen.queryByText("claude-writer")).toBeNull();

    await user.type(screen.getByTestId("skill-search-input"), "claude");

    expect(await screen.findByText("搜索结果")).toBeTruthy();
    const resultRow = await screen.findByTestId("skill-row-claude-writer");
    expect(within(resultRow).getByText("claude-writer")).toBeTruthy();
    expect(within(resultRow).getByText("Claude Code")).toBeTruthy();
    expect(screen.queryByText("codex-planner")).toBeNull();
  });
});

describe("Metis desktop GUI error paths", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("shows structured apply errors with category, suggestion, and debug detail", async () => {
    const user = userEvent.setup();
    const scenario = createApplyErrorScenario({
      category: "security_blocked",
      title: "安全检查阻断",
      message: "更新内容触发 High 风险安全检查，Metis 没有覆盖本地文件。",
      suggestion: "请人工检查 diff 和安全发现，确认可信后再考虑手动处理。",
      debug_detail: "security blocked",
    });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    const skillRow = await screen.findByTestId("skill-row-e2e-skill");
    await user.click(within(skillRow).getByTestId("check-updates-e2e-skill"));
    await user.click(
      within(await screen.findByTestId("skill-row-e2e-skill")).getByTestId(
        "apply-update-e2e-skill",
      ),
    );

    expect(await screen.findByText("安全检查阻断")).toBeTruthy();
    expect(
      screen.getByText("更新内容触发 High 风险安全检查，Metis 没有覆盖本地文件。"),
    ).toBeTruthy();
    expect(
      screen.getByText("请人工检查 diff 和安全发现，确认可信后再考虑手动处理。"),
    ).toBeTruthy();
    expect(screen.getByText("security_blocked")).toBeTruthy();
    expect(screen.getByText("security blocked")).toBeTruthy();
  });

  test("parses structured errors encoded as Tauri string rejections", async () => {
    const user = userEvent.setup();
    const scenario = createApplyErrorScenario(
      JSON.stringify({
        category: "apply_rollback_succeeded",
        title: "更新失败，已自动回滚",
        message: "应用更新时发生错误，Metis 已恢复到更新前备份。",
        suggestion: "确认本地目录可写、磁盘空间充足后重新检查更新；如问题重复，请保留调试详情。",
        debug_detail: "apply failed and rollback succeeded: permission denied",
      }),
    );
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(
      within(await screen.findByTestId("skill-row-e2e-skill")).getByTestId(
        "check-updates-e2e-skill",
      ),
    );
    await user.click(
      within(await screen.findByTestId("skill-row-e2e-skill")).getByTestId(
        "apply-update-e2e-skill",
      ),
    );

    expect(await screen.findByText("更新失败，已自动回滚")).toBeTruthy();
    expect(screen.getByText("apply_rollback_succeeded")).toBeTruthy();
    expect(screen.getByText("应用更新时发生错误，Metis 已恢复到更新前备份。")).toBeTruthy();
    expect(
      screen.getByText("apply failed and rollback succeeded: permission denied"),
    ).toBeTruthy();
  });
});

function createMainFlowScenario() {
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
  let backups: DesktopBackupSummary[] = [];
  let indexedSkills: DesktopSkill[] = [];

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
    async invoke(command: string, args?: unknown) {
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
        case "check_skill_updates":
          return [updateResult(skill, source)];
        case "get_skill_diff":
          return diffDetail();
        case "apply_skill_update":
          backups = [backup("backup-pre-update", "pre-update", "aaa111")];
          skill = {
            ...skill,
            description: "Updated skill",
            source: {
              ...source,
              current_commit: "bbb222",
              remote_commit: "bbb222",
            },
          };
          indexedSkills = [skill];
          return applyResult();
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

function createApplyErrorScenario(error: unknown) {
  const source: DesktopSource = {
    id: "source-e2e-skill",
    source_type: "git",
    url: "file:///tmp/metis-e2e-repo",
    repo_path: "skills/e2e-skill",
    ref_: "main",
    current_commit: "aaa111",
    remote_commit: "bbb222",
    last_checked_at: "2026-06-20T10:00:00Z",
    trusted: false,
    auto_update: false,
    credential_ref: null,
  };
  const skill: DesktopSkill = {
    id: "e2e-skill",
    agent_id: "generic",
    agent_name: "Generic Agent Skills",
    name: "e2e-skill",
    description: "Baseline skill",
    install_path: "/tmp/metis-e2e/skills/e2e-skill",
    metadata_path: "/tmp/metis-e2e/skills/e2e-skill/SKILL.md",
    metadata_status: "found",
    metadata_error: null,
    source_id: source.id,
    source,
    local_modified: false,
    last_scanned_at: "2026-06-20T10:00:00Z",
  };
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

  return {
    async invoke(command: string, _args?: unknown) {
      switch (command) {
        case "list_agents":
          return agents;
        case "list_indexed_skills":
          return [skill];
        case "get_desktop_settings":
          return { custom_scan_paths: [] };
        case "check_skill_updates":
          return [updateResult(skill, source)];
        case "apply_skill_update":
          throw error;
        case "list_skill_backups":
          return [];
        default:
          throw new Error(`Unexpected invoke command: ${command}`);
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

function createAgentDetailScenario() {
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

  return {
    checkedSkillIds: () => checked,
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
            .map((skill) => updateResult(skill, skill.source as DesktopSource));
        }
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
  source: DesktopSource,
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
    source_id: source.id,
    source,
    local_modified: false,
    last_scanned_at: "2026-06-20T10:00:00Z",
  };
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

function updateResult(skill: DesktopSkill, source: DesktopSource): DesktopUpdateCheckResult {
  return {
    skill_id: skill.id,
    skill_name: skill.name,
    status: "UpdateAvailable",
    failure_reason: null,
    local_modified: false,
    commits_behind: 2,
    diff_summary: {
      files_added: 1,
      files_modified: 1,
      files_deleted: 0,
      total_changes: 2,
    },
    source: {
      ...source,
      remote_commit: "bbb222",
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
