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
  const source: DesktopSource = {
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
  const settings: DesktopSettings = { custom_scan_paths: [] };

  return {
    async invoke(command: string, args?: unknown) {
      switch (command) {
        case "list_agents":
          return agents;
        case "list_indexed_skills":
          return indexedSkills;
        case "get_desktop_settings":
          return settings;
        case "scan_skills":
          indexedSkills = [skill];
          return { skills: [skill], warnings: [] };
        case "bind_skill_source":
          skill = { ...skill, source_id: source.id, source };
          indexedSkills = [skill];
          return source;
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
