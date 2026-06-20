import { render, screen, within } from "@testing-library/react";
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
          return [skill];
        case "get_desktop_settings":
          return settings;
        case "scan_skills":
          return { skills: [skill], warnings: [] };
        case "bind_skill_source":
          skill = { ...skill, source_id: source.id, source };
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
