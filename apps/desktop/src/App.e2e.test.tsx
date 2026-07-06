import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import App from "./App";
import type {
  DesktopAgentStatus,
  DesktopApplyUpdateResult,
  DesktopBackupSummary,
  DesktopDiffDetail,
  DesktopSettings,
  DesktopSkill,
  DesktopSource,
  DesktopSourceConnectionTestResult,
  DesktopUpdateCheckResult,
} from "./types";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

afterEach(() => {
  vi.useRealTimers();
});

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
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    render(<App />);

    const skillRow = await screen.findByTestId("skill-row-e2e-skill");
    expect(invokeMock).toHaveBeenCalledWith("scan_skills");
    expect(within(skillRow).getByText("e2e-skill")).toBeTruthy();
    expect(within(skillRow).getByText("未绑定来源")).toBeTruthy();

    await user.click(skillRow);
    await waitFor(() =>
      expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" }),
    );
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
      false,
    );
    expect((screen.getByTestId("toggle-diff-e2e-skill") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("toggle-backups-e2e-skill") as HTMLButtonElement).disabled).toBe(
      true,
    );

    await user.click(screen.getByTestId("check-updates-e2e-skill"));
    const sourceRequiredNotice = within(await screen.findByTestId("source-required-toast"));
    expect(sourceRequiredNotice.getByText("需要先绑定来源")).toBeTruthy();
    expect(
      sourceRequiredNotice.getByText("当前 Skill 还没有 Git 来源，绑定后才能检查远端更新。"),
    ).toBeTruthy();
    expect(sourceRequiredNotice.getByTestId("source-required-toast-action")).toBeTruthy();
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "check_skill_updates"),
    ).toHaveLength(0);
    expect(screen.queryByText(/0 个 Agent 需要更新/)).toBeNull();

    await user.click(screen.getByTestId("source-required-toast-action"));
    const sourceDrawer = within(await screen.findByTestId("source-drawer-e2e-skill"));
    expect(sourceDrawer.getByTestId("source-form-body-e2e-skill")).toBeTruthy();
    const sourceUrlHelp = within(sourceDrawer.getByTestId("source-url-help-e2e-skill"));
    const sourceHelpButton = sourceDrawer.getByLabelText("仓库地址填写说明");
    expect(sourceHelpButton.getAttribute("aria-expanded")).toBe("false");
    await user.click(sourceHelpButton);
    expect(sourceHelpButton.getAttribute("aria-expanded")).toBe("true");
    expect(sourceUrlHelp.getByText("HTTPS")).toBeTruthy();
    expect(sourceUrlHelp.getByText("公开仓库通常可直接访问；私有仓库需要本机 Git 已登录或配置 token。")).toBeTruthy();
    expect(sourceUrlHelp.getByText("git@")).toBeTruthy();
    expect(sourceUrlHelp.getByText("如果你已经在本机配置好 SSH key，也可以使用这个地址。")).toBeTruthy();
    expect(sourceUrlHelp.getByText("https://github.com/xx/xx.git")).toBeTruthy();
    expect(sourceUrlHelp.getByText("git@github.com:xx/xx.git")).toBeTruthy();
    await user.click(sourceDrawer.getByText("Skill 在仓库内的路径"));
    expect(sourceHelpButton.getAttribute("aria-expanded")).toBe("false");
    expect((screen.getByTestId("bind-url-e2e-skill") as HTMLInputElement).placeholder).toBe(
      "https://github.com/xx/xx.git",
    );
    expect(sourceDrawer.queryByText(/multica-ai|andrej-karpathy/)).toBeNull();
    const sourceSettings = within(sourceDrawer.getByTestId("source-settings-grid-e2e-skill"));
    expect(sourceDrawer.getByText("主分支名")).toBeTruthy();
    expect(sourceDrawer.queryByText("分支 / Tag / Commit")).toBeNull();
    expect(sourceDrawer.queryByText("凭据引用（可选）")).toBeNull();
    const repoPathHelpButton = sourceDrawer.getByLabelText("仓库内路径填写说明");
    await user.click(repoPathHelpButton);
    expect(repoPathHelpButton.getAttribute("aria-expanded")).toBe("true");
    expect(sourceDrawer.getByText("如果 SKILL.md 就在仓库根目录，这里可以不填。")).toBeTruthy();
    expect(sourceDrawer.getByText("skills/example")).toBeTruthy();
    const refHelpButton = sourceDrawer.getByLabelText("主分支名填写说明");
    await user.click(refHelpButton);
    expect(repoPathHelpButton.getAttribute("aria-expanded")).toBe("false");
    expect(refHelpButton.getAttribute("aria-expanded")).toBe("true");
    expect(sourceDrawer.getByText("多数仓库使用 main，较早的仓库可能使用 master。")).toBeTruthy();
    expect((screen.getByTestId("bind-ref-e2e-skill") as HTMLInputElement).placeholder).toBe(
      "一般为 main 或者 master",
    );
    await user.click(sourceDrawer.getByText("Skill 在仓库内的路径"));
    expect(document.activeElement).not.toBe(screen.getByTestId("bind-repo-path-e2e-skill"));
    await user.click(sourceDrawer.getByText("主分支名"));
    expect(document.activeElement).not.toBe(screen.getByTestId("bind-ref-e2e-skill"));
    expect(sourceSettings.getByText("信任此来源并加入自动更新列表")).toBeTruthy();
    expect(sourceSettings.queryByText("开启后，Metis 只会在本地无修改时自动更新这个 Skill。")).toBeNull();
    expect(sourceSettings.queryByText("可信来源")).toBeNull();
    const sourceVerification = within(
      sourceDrawer.getByTestId("source-verification-panel-e2e-skill"),
    );
    expect(sourceVerification.getByText("测试连接")).toBeTruthy();
    expect(sourceVerification.queryByText("连接验证")).toBeNull();
    expect(sourceDrawer.getByTestId("source-form-actions-e2e-skill")).toBeTruthy();
    expect(
      sourceVerification.getByText("检测当前已填来源是否可访问。不会安装、更新或修改任何文件。"),
    ).toBeTruthy();
    await user.type(screen.getByTestId("bind-url-e2e-skill"), "file:///tmp/metis-e2e-repo");
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.clear(screen.getByTestId("bind-ref-e2e-skill"));
    await user.type(screen.getByTestId("bind-ref-e2e-skill"), "main");
    await user.click(screen.getByTestId("bind-auto-update-e2e-skill"));
    await user.click(screen.getByTestId("test-source-connection-e2e-skill"));

    expect(await screen.findByText("连接成功，可以保存来源。")).toBeTruthy();
    expect(screen.getByText("已找到 e2e-skill")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("test_source_connection", {
      request: {
        url: "file:///tmp/metis-e2e-repo",
        repo_path: "skills/e2e-skill",
        ref_: "main",
      },
    });
    await user.click(screen.getByTestId("submit-bind-source-e2e-skill"));
    expect(invokeMock).toHaveBeenCalledWith("bind_skill_source", {
      request: expect.objectContaining({
        trusted: true,
        auto_update: true,
        ref_: "main",
      }),
    });

    expect(await screen.findByText("修改来源")).toBeTruthy();
    const boundSourceSummary = within(screen.getByTestId("skill-source-summary-e2e-skill"));
    expect(boundSourceSummary.getByText("file:///tmp/metis-e2e-repo")).toBeTruthy();
    expect(boundSourceSummary.getByText("skills/e2e-skill · main")).toBeTruthy();
    expect(
      boundSourceSummary.getByTestId("open-bind-source-e2e-skill").className,
    ).toContain("redesign-source-action");
    await user.click(screen.getByText("返回"));
    const boundHomeCard = within(await screen.findByTestId("skill-row-e2e-skill"));
    expect(boundHomeCard.getByText("已绑定来源")).toBeTruthy();
    expect(boundHomeCard.queryByText("skills/e2e-skill")).toBeNull();

    await user.click(screen.getByTestId("skill-row-e2e-skill"));
    expect(await screen.findByTestId("skill-detail-e2e-skill")).toBeTruthy();
    const uncheckedPanel = within(screen.getByTestId("check-panel-e2e-skill"));
    expect(uncheckedPanel.getByText("本地版本")).toBeTruthy();
    expect(uncheckedPanel.getByText("aaa111")).toBeTruthy();
    expect(uncheckedPanel.getByText("远端版本")).toBeTruthy();
    expect(uncheckedPanel.getAllByText("等待检查")).toHaveLength(2);
    expect(uncheckedPanel.queryByText("old999")).toBeNull();
    expect(uncheckedPanel.queryByText("main")).toBeNull();
    expect((screen.getByTestId("toggle-diff-e2e-skill") as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByTestId("toggle-diff-e2e-skill"));
    expect(invokeMock.mock.calls.filter(([command]) => command === "get_skill_diff")).toHaveLength(
      0,
    );

    await user.click(screen.getByTestId("check-updates-e2e-skill"));

    expect(await screen.findByText("有 Agent 需要更新")).toBeTruthy();
    await user.click(screen.getByTestId("skill-detail-agent-toggle-e2e-skill"));
    expect(within(screen.getByTestId("skill-detail-agent-path-e2e-skill-generic")).getByText("需要更新")).toBeTruthy();
    expect(screen.queryByTestId("detail-update-summary-e2e-skill")).toBeNull();
    const checkPanel = within(screen.getByTestId("check-panel-e2e-skill"));
    expect(checkPanel.getByText("远端版本")).toBeTruthy();
    expect(checkPanel.getByText("bbb222")).toBeTruthy();
    expect(checkPanel.getByText("差异")).toBeTruthy();
    expect(checkPanel.getByText("新增 1 个文件")).toBeTruthy();
    expect(checkPanel.getByText("修改 1 个文件")).toBeTruthy();
    expect(checkPanel.queryByText("新增 1 个文件 · 修改 1 个文件")).toBeNull();
    expect(screen.queryByText("2 个文件有更新")).toBeNull();
    expect(screen.queryByText("+1")).toBeNull();
    expect(screen.queryByText("~1")).toBeNull();
    expect(screen.queryByText("2 commits behind")).toBeNull();
    expect(screen.queryByText(/展开安装位置查看哪些 Agent/)).toBeNull();
    expect(screen.queryByText(/安全检查通过/)).toBeNull();
    expect(await screen.findByTestId("apply-needed-agent-updates-e2e-skill")).toBeTruthy();
    expect(screen.getByTestId("check-updates-e2e-skill").className).not.toContain("active");
    expect((screen.getByTestId("toggle-diff-e2e-skill") as HTMLButtonElement).disabled).toBe(
      false,
    );

    await user.click(screen.getByTestId("toggle-diff-e2e-skill"));

    expect(await screen.findByTestId("diff-file-SKILL.md")).toBeTruthy();
    expect(await screen.findByTestId("diff-file-references/mysql-tables.md")).toBeTruthy();
    expect(screen.getByTestId("diff-file-SKILL.md").textContent).toBe("SKILL.md");
    expect(screen.getByTestId("diff-file-references/mysql-tables.md").textContent).toBe(
      "references/mysql-tables.md",
    );
    expect(
      screen.getByText((content) => content.includes("+description: Updated skill")),
    ).toBeTruthy();
    expect(screen.queryByText((content) => content.includes("+table: example_records"))).toBeNull();
    expect(screen.queryByText((content) => content.includes("diff --git"))).toBeNull();
    expect(screen.queryByText((content) => content.includes("index 77f0ae8"))).toBeNull();
    expect(screen.queryByText((content) => content.includes("--- a/"))).toBeNull();
    expect(screen.queryByText((content) => content.includes("+++ b/"))).toBeNull();
    expect(screen.getByTestId("toggle-diff-e2e-skill").className).toContain("active");

    await user.click(screen.getByTestId("diff-file-references/mysql-tables.md"));
    expect(
      await screen.findByText((content) => content.includes("+table: example_records")),
    ).toBeTruthy();
    expect(screen.queryByText((content) => content.includes("+description: Updated skill"))).toBeNull();
    expect(screen.getByTestId("diff-file-references/mysql-tables.md").className).toContain("active");

    await user.click(screen.getByTestId("toggle-diff-e2e-skill"));
    expect(screen.queryByTestId("redesign-diff-viewer")).toBeNull();
    expect(screen.getByTestId("check-updates-e2e-skill").className).not.toContain("active");

    await user.click(screen.getByTestId("apply-needed-agent-updates-e2e-skill"));
    expect(await screen.findByText(/已更新 1 个需要更新的 Agent/)).toBeTruthy();
    await user.click(screen.getByTestId("toggle-backups-e2e-skill"));
    const backupPanel = within(await screen.findByTestId("backup-panel-e2e-skill"));
    expect(backupPanel.getByText("上一个版本")).toBeTruthy();
    expect(backupPanel.queryByText("备份")).toBeNull();
    expect(backupPanel.queryByText("共 1 个备份")).toBeNull();
    expect(backupPanel.getByText("2026-07-04 22:14:00")).toBeTruthy();
    expect(backupPanel.getByText("aaa111")).toBeTruthy();
    expect(backupPanel.getByText("14.8 KB")).toBeTruthy();
    expect(backupPanel.getByRole("button", { name: "回退" })).toBeTruthy();
    expect(backupPanel.queryByText("可回滚到 aaa111")).toBeNull();
    expect(backupPanel.queryByText("更新前备份")).toBeNull();
    expect(backupPanel.queryByText("pre-update")).toBeNull();
    expect(backupPanel.queryByText("backup-pre-update")).toBeNull();
    expect(backupPanel.queryByText(/2026-07-04T14:14:00/)).toBeNull();
    expect(backupPanel.queryByText(/5 files/)).toBeNull();

    await user.click(screen.getByTestId("restore-backup-e2e-skill-backup-pre-update"));

    expect(await screen.findByText("已回滚到备份版本，回滚前状态已自动备份")).toBeTruthy();
    expect(await screen.findByText("回退前版本")).toBeTruthy();
  });

  test("previews a remote skill and syncs it to selected agents", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({
      includeCustomInstallTarget: true,
      slowRemotePreview: true,
    });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await screen.findByTestId("skill-row-e2e-skill");
    await user.click(screen.getByTestId("open-add-skill"));
    expect(await screen.findByTestId("add-skill-page")).toBeTruthy();
    expect(screen.getByText("Skill 来源信息")).toBeTruthy();
    expect(
      screen.getByText("填写 Git URL、Skill 路径和分支名，填好后可以点击预览查看确认后，再选择安装"),
    ).toBeTruthy();
    expect(screen.queryByText("Remote source")).toBeNull();
    expect(screen.queryByText("远端信息")).toBeNull();
    expect(screen.queryByText("填写仓库 URL、Skill 目录和 ref，先预览再选择安装目标。")).toBeNull();
    await user.type(
      screen.getByTestId("add-skill-url"),
      "https://github.com/example/metis-skills.git",
    );
    await user.type(screen.getByTestId("add-skill-repo-path"), "skills/remote");
    await user.clear(screen.getByTestId("add-skill-ref"));
    await user.type(screen.getByTestId("add-skill-ref"), "main");
    await user.click(screen.getByTestId("add-skill-preview"));

    expect(await screen.findByText("正在读取远端 Git，并计算可安装的 Agent / 目录")).toBeTruthy();
    expect(await screen.findByText("Remote Skill")).toBeTruthy();
    expect(screen.getByText("远端版本")).toBeTruthy();
    expect(screen.getByText("abc123")).toBeTruthy();
    expect(screen.getByText("安装到以下 Agent / 目录")).toBeTruthy();
    expect((await screen.findByTestId("target-row-codex")).className).toContain(
      "redesign-detail-agent-path-row",
    );
    expect((await screen.findByTestId("target-row-custom-team-memory")).className).toContain(
      "redesign-detail-agent-path-row",
    );
    expect(screen.getByText("团队记忆")).toBeTruthy();
    expect(screen.getByText("/tmp/team-memory-skills/remote")).toBeTruthy();
    await user.click(screen.getByTestId("target-checkbox-custom-team-memory"));
    await user.click(screen.getByTestId("install-selected-targets"));

    expect(await screen.findByText(/团队记忆：Updated/)).toBeTruthy();
    expect(screen.queryByText(/custom-team-memory：Updated/)).toBeNull();
  });

  test("explains source connection test failures in user language", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ sourceConnectionFails: true });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    await user.click(await screen.findByTestId("open-bind-source-e2e-skill"));
    await user.type(
      screen.getByTestId("bind-url-e2e-skill"),
      "https://gitlab.example/private/sdd.git",
    );
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/missing");
    await user.click(screen.getByTestId("test-source-connection-e2e-skill"));

    expect(await screen.findByText("Metis 访问不了这个仓库")).toBeTruthy();
    expect(
      screen.getByText(
        "Metis 已自动尝试当前地址及可推导的 HTTPS / git@ 地址，仍然无法访问。请检查仓库地址、主分支名、仓库内路径，以及本机 Git 登录、token 或 SSH key 配置。",
      ),
    ).toBeTruthy();
  });

  test("automatically tests the HTTPS variant when the SSH source URL fails", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ sshSourceConnectionFails: true });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    await user.click(await screen.findByTestId("open-bind-source-e2e-skill"));
    await user.type(
      screen.getByTestId("bind-url-e2e-skill"),
      "git@github.com:xx/xx.git",
    );
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.click(screen.getByTestId("test-source-connection-e2e-skill"));

    expect(await screen.findByText("已自动切换为可访问的 HTTPS 地址，可以保存来源。")).toBeTruthy();
    expect((screen.getByTestId("bind-url-e2e-skill") as HTMLInputElement).value).toBe(
      "https://github.com/xx/xx.git",
    );
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "test_source_connection"),
    ).toHaveLength(2);
  });

  test("explains when both the current URL and derived variants fail", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ sourceConnectionFails: true });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    await user.click(await screen.findByTestId("open-bind-source-e2e-skill"));
    await user.type(
      screen.getByTestId("bind-url-e2e-skill"),
      "git@github.com:xx/xx.git",
    );
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.click(screen.getByTestId("test-source-connection-e2e-skill"));

    expect(await screen.findByText("Metis 访问不了这个仓库")).toBeTruthy();
    expect(
      screen.getByText(
        "Metis 已自动尝试当前地址及可推导的 HTTPS / git@ 地址，仍然无法访问。请检查仓库地址、主分支名、仓库内路径，以及本机 Git 登录、token 或 SSH key 配置。",
      ),
    ).toBeTruthy();
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "test_source_connection"),
    ).toHaveLength(2);
  });

  test("does not derive variants from ssh URL source input", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ sourceConnectionFails: true });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    await user.click(await screen.findByTestId("open-bind-source-e2e-skill"));
    await user.type(
      screen.getByTestId("bind-url-e2e-skill"),
      "ssh://git@github.com/xx/xx.git",
    );
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.click(screen.getByTestId("test-source-connection-e2e-skill"));

    expect(await screen.findByText("Metis 访问不了这个仓库")).toBeTruthy();
    expect(screen.getByText("请确认你有访问权限，或先在本机 Git 工具中完成登录。")).toBeTruthy();
    expect(
      screen.queryByText(
        "Metis 已自动尝试当前地址及可推导的 HTTPS / git@ 地址，仍然无法访问。请检查仓库地址、主分支名、仓库内路径，以及本机 Git 登录、token 或 SSH key 配置。",
      ),
    ).toBeNull();
    const sourceConnectionCalls = invokeMock.mock.calls.filter(
      ([command]) => command === "test_source_connection",
    );
    expect(sourceConnectionCalls).toHaveLength(1);
    expect(sourceConnectionCalls[0]?.[1]).toEqual({
      request: {
        url: "ssh://git@github.com/xx/xx.git",
        repo_path: "skills/e2e-skill",
        ref_: "main",
      },
    });
  });

  test("tests the repository root when source path is empty", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    await user.click(await screen.findByTestId("open-bind-source-e2e-skill"));
    await user.type(screen.getByTestId("bind-url-e2e-skill"), "https://github.com/xx/xx.git");

    const testButton = screen.getByTestId("test-source-connection-e2e-skill") as HTMLButtonElement;
    expect(testButton.disabled).toBe(false);
    await user.click(testButton);

    expect(await screen.findByText("连接成功，可以保存来源。")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("test_source_connection", {
      request: {
        url: "https://github.com/xx/xx.git",
        repo_path: ".",
        ref_: "main",
      },
    });
    await user.click(screen.getByTestId("submit-bind-source-e2e-skill"));
    expect(invokeMock).toHaveBeenCalledWith("bind_skill_source", {
      request: expect.objectContaining({
        url: "https://github.com/xx/xx.git",
        repo_path: ".",
        ref_: "main",
      }),
    });
  });

  test("removes Updates workspace and runs controlled auto update from Settings", async () => {
    const user = userEvent.setup();
    const scenario = createBetaReadinessScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    expect(screen.queryByTestId("workspace-tab-governance-sidebar")).toBeNull();
    expect(screen.queryByText("Updates")).toBeNull();

    await user.click(await screen.findByTestId("workspace-tab-settings"));
    expect(await screen.findByText("自动更新")).toBeTruthy();
    expect(screen.getByText("只会更新已加入自动更新列表、且本地没有修改的 Skill。")).toBeTruthy();
    const autoUpdateList = within(screen.getByTestId("auto-update-source-list"));
    expect(autoUpdateList.getByText("Trusted Skill")).toBeTruthy();
    expect(autoUpdateList.getByText("file:///tmp/metis-trusted-repo")).toBeTruthy();
    expect(autoUpdateList.queryByText("Untrusted Skill")).toBeNull();
    expect(screen.getByTestId("run-auto-update").textContent).toBe("开启自动更新");
    expect(screen.queryByText("团队清单合规")).toBeNull();
    expect(screen.queryByText("企业网络")).toBeNull();
    expect(screen.queryByText("凭据引用")).toBeNull();
    const gitHealthSection = within(screen.getByTestId("settings-section-git-health"));
    expect(gitHealthSection.getByText("Git 环境检查")).toBeTruthy();
    expect(gitHealthSection.getByText("检测本机 Git 是否可运行，并确认能访问公开 Git 仓库。")).toBeTruthy();
    await user.click(gitHealthSection.getByTestId("test-git-environment"));
    expect(await screen.findByText("本机 Git 可以正常访问公开仓库。")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("test_git_environment");

    await user.click(screen.getByTestId("run-auto-update"));

    expect(await screen.findByText(/自动更新完成：已更新 1 个，跳过 1 个/)).toBeTruthy();
    expect(scenario.appliedSkillIds()).toEqual(["trusted-skill"]);

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await user.click(screen.getByTestId("remove-auto-update-trusted-skill"));
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "bind_skill_source"),
    ).toHaveLength(0);
    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByTestId("remove-auto-update-trusted-skill"));
    await waitFor(() => expect(screen.queryByTestId("auto-update-source-row-trusted-skill")).toBeNull());
    expect(invokeMock).toHaveBeenCalledWith("bind_skill_source", {
      request: expect.objectContaining({
        skill_id: "trusted-skill",
        url: "file:///tmp/metis-trusted-repo",
        trusted: false,
        auto_update: false,
      }),
    });
    await user.click(screen.getByTestId("workspace-tab-skills"));
    await user.click(await screen.findByTestId("skill-row-trusted-skill"));
    await user.click(screen.getByTestId("open-bind-source-trusted-skill"));
    expect((await screen.findByTestId("bind-auto-update-trusted-skill") as HTMLInputElement).checked).toBe(false);
    confirmSpy.mockRestore();
  });

  test("guides the user when auto update has no trusted source candidates", async () => {
    const user = userEvent.setup();
    const scenario = createBetaReadinessScenario({
      trustedSources: false,
      autoUpdateSources: false,
    });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("workspace-tab-settings"));
    expect(await screen.findByText("自动更新")).toBeTruthy();
    expect(screen.getByText("自动更新列表 0 个")).toBeTruthy();
    expect(screen.getByText("本次可更新候选 0 个")).toBeTruthy();

    await user.click(screen.getByTestId("run-auto-update"));

    const autoUpdateNotice = within(await screen.findByTestId("source-required-toast"));
    expect(autoUpdateNotice.getByText("没有可自动更新的 Skill")).toBeTruthy();
    expect(
      autoUpdateNotice.getByText(
        "请先在来源里开启「信任此来源并加入自动更新列表」。",
      ),
    ).toBeTruthy();
    expect(autoUpdateNotice.queryByText(/当前没有可用的自动更新 Skill/)).toBeNull();
    expect(screen.queryByTestId("redesign-toast")).toBeNull();
    expect(screen.queryByText(/自动更新完成：已更新 0 个，跳过 0 个/)).toBeNull();
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "check_skill_updates"),
    ).toHaveLength(0);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "apply_skill_update"),
    ).toHaveLength(0);
  });

  test("Settings manages built-in agent paths and named custom monitored paths", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("workspace-tab-settings"));
    expect(await screen.findByText("内置 Agent 路径管理")).toBeTruthy();
    const pathSummary = screen.getByLabelText("路径摘要");
    expect(pathSummary.textContent).toContain("内置有效路径3");
    expect(pathSummary.textContent).toContain("内置无效路径1");
    expect(pathSummary.textContent).toContain("自定义有效路径0");
    expect(pathSummary.textContent).toContain("自定义无效路径0");
    expect(screen.queryByText("路径可用的内置 Agent")).toBeNull();
    expect(screen.queryByText("路径未配置的内置 Agent")).toBeNull();
    expect(screen.queryByText("可用自定义路径")).toBeNull();
    expect(screen.queryByText("缺失自定义路径")).toBeNull();
    expect(screen.queryByText("内置可用 Agent")).toBeNull();
    expect(screen.queryByText("内置未配置 Agent")).toBeNull();
    expect(screen.queryByText("内置可用")).toBeNull();
    expect(screen.queryByText("内置缺失")).toBeNull();
    expect(screen.queryByText("自定义可用")).toBeNull();
    expect(screen.queryByText("自定义缺失")).toBeNull();
    expect(screen.queryByText("可用路径")).toBeNull();
    expect(screen.queryByText("缺失路径")).toBeNull();
    expect(screen.queryByText("自定义路径")).toBeNull();
    expect(screen.queryByText("已绑定来源")).toBeNull();
    expect(screen.queryByText("存在的路径")).toBeNull();
    expect(screen.queryByText("已发现 skills")).toBeNull();
    expect(screen.getByText("列出 Metis 当前用于扫描各 Agent skill 的目录，路径不对时可以直接修改。")).toBeTruthy();
    expect(screen.getByText("自定义路径管理")).toBeTruthy();
    expect(screen.getByTestId("custom-monitor-name-new").getAttribute("placeholder")).toBe(
      "自定义路径名称",
    );
    const hermesPathRow = screen.getByTestId("settings-agent-path-hermes");
    expect(hermesPathRow.className).toContain("missing");
    expect(within(hermesPathRow).getByText("路径不存在")).toBeTruthy();

    await user.clear(screen.getByTestId("agent-path-codex"));
    await user.type(screen.getByTestId("agent-path-codex"), "/tmp/my-codex-skills");
    await user.type(screen.getByTestId("custom-monitor-name-new"), "团队记忆");
    await user.type(screen.getByTestId("custom-monitor-path-new"), "/tmp/team-memory-skills");
    expect(screen.getByTestId("custom-monitor-new-row").className).toContain(
      "redesign-agent-path-row",
    );
    const scanCallsBeforeSave = scenario.commandCalls("scan_skills");
    await user.click(screen.getByText("保存"));
    expect(await screen.findByText("设置已保存")).toBeTruthy();
    expect(scenario.commandCalls("scan_skills")).toBe(scanCallsBeforeSave + 1);

    expect(invokeMock).toHaveBeenCalledWith("save_desktop_settings", {
      settings: expect.objectContaining({
        agent_path_overrides: [{ agent_id: "codex", path: "/tmp/my-codex-skills" }],
        custom_monitored_paths: expect.arrayContaining([
          expect.objectContaining({
            name: "团队记忆",
            path: "/tmp/team-memory-skills",
          }),
        ]),
      }),
    });
  });

  test("Settings validates duplicate custom monitor names and paths before saving", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("workspace-tab-settings"));
    await screen.findByText("内置 Agent 路径管理");

    await user.type(screen.getByTestId("custom-monitor-name-new"), "Codex");
    await user.type(screen.getByTestId("custom-monitor-path-new"), "/tmp/custom-codex");
    await user.click(screen.getByText("保存"));
    expect(await screen.findByText("自定义路径名称不能和内置 Agent 重复")).toBeTruthy();
    expect(scenario.commandCalls("save_desktop_settings")).toBe(0);

    await user.clear(screen.getByTestId("custom-monitor-name-new"));
    await user.type(screen.getByTestId("custom-monitor-name-new"), "团队记忆");
    await user.clear(screen.getByTestId("custom-monitor-path-new"));
    await user.type(screen.getByTestId("custom-monitor-path-new"), "/Users/me/.codex/skills");
    await user.click(screen.getByText("保存"));
    expect(await screen.findByText("自定义路径不能和已有路径重复")).toBeTruthy();
    expect(scenario.commandCalls("save_desktop_settings")).toBe(0);

    await user.clear(screen.getByTestId("custom-monitor-path-new"));
    await user.type(screen.getByTestId("custom-monitor-path-new"), "/tmp/team-memory-skills");
    await user.click(screen.getByText("保存"));
    expect(await screen.findByText("设置已保存")).toBeTruthy();
    expect(scenario.commandCalls("save_desktop_settings")).toBe(1);

    await user.type(screen.getByTestId("custom-monitor-name-new"), "团队记忆");
    await user.type(screen.getByTestId("custom-monitor-path-new"), "/tmp/another-team-memory");
    await user.click(screen.getByText("保存"));
    expect(await screen.findByText("自定义路径名称不能重复")).toBeTruthy();
    expect(scenario.commandCalls("save_desktop_settings")).toBe(1);

    await user.clear(screen.getByTestId("custom-monitor-name-new"));
    await user.type(screen.getByTestId("custom-monitor-name-new"), "其他路径");
    await user.clear(screen.getByTestId("custom-monitor-path-new"));
    await user.type(screen.getByTestId("custom-monitor-path-new"), "/tmp/team-memory-skills");
    await user.click(screen.getByText("保存"));
    expect(await screen.findByText("自定义路径不能和已有路径重复")).toBeTruthy();
    expect(scenario.commandCalls("save_desktop_settings")).toBe(1);
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
    expect(
      screen.getByTestId("metis-brand-row").contains(screen.getByTestId("metis-github-link")),
    ).toBe(false);
    expect(screen.getByTestId("metis-sidebar-footer").contains(screen.getByTestId("metis-github-link"))).toBe(
      true,
    );
    expect(screen.getByTestId("metis-brand-home").getAttribute("data-github-url")).toBe(
      "https://github.com/wylycool/metis",
    );
    expect(screen.getByTestId("metis-brand-crystal-logo")).toBeTruthy();
    expect(screen.queryByTestId("metis-brand-letter-logo")).toBeNull();
    expect(screen.queryByText("Local library")).toBeNull();
    expect(screen.queryByText(/trusted sources/)).toBeNull();
    expect(screen.getByTestId("metis-github-link").getAttribute("aria-label")).toBe(
      "打开 Metis GitHub 仓库",
    );
    expect(screen.getByTestId("metis-github-link").getAttribute("data-github-url")).toBe(
      "https://github.com/wylycool/metis",
    );
    await user.click(screen.getByTestId("metis-github-link"));
    expect(invokeMock).toHaveBeenCalledWith("open_external_url", {
      url: "https://github.com/wylycool/metis",
    });
    expect(screen.getByTestId("skill-search-input")).toBeTruthy();
    expect(screen.queryByText(/\d+ results/)).toBeNull();
    expect(screen.getByTestId("check-all-updates")).toBeTruthy();
    expect(screen.getByTestId("scan-skills")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Skills" })).toBeTruthy();
    expect(screen.queryByText("本机 Skill 工作台")).toBeNull();
    expect(screen.getByTestId("workspace-tab-skills").textContent).toBe("Skills");
    expect(screen.queryByTestId("workspace-tab-governance-sidebar")).toBeNull();
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
    expect(screen.getByText("内置 Agent 路径管理")).toBeTruthy();
    expect(screen.getByText("自定义路径管理")).toBeTruthy();
    expect(screen.getByText("自动更新")).toBeTruthy();
    expect(screen.queryByText("企业网络")).toBeNull();
    expect(screen.queryByText("团队清单合规")).toBeNull();

    await user.click(screen.getByTestId("metis-brand-home"));
    expect(await screen.findByTestId("workspace-skills")).toBeTruthy();
    expect(screen.queryByTestId("skill-status-filters")).toBeNull();
  });

  test("reuses the formal topbar layout across Skills and Settings", async () => {
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
    expect(
      screen.getByTestId("redesign-brand-row").contains(screen.getByTestId("redesign-github-link")),
    ).toBe(false);
    expect(
      screen.getByTestId("redesign-sidebar-footer").contains(screen.getByTestId("redesign-github-link")),
    ).toBe(true);
    expect(screen.getByTestId("redesign-brand-logo").getAttribute("href")).toBe(
      "https://github.com/wylycool/metis",
    );
    expect(screen.getByTestId("redesign-brand-crystal-logo")).toBeTruthy();
    expect(screen.queryByTestId("redesign-brand-letter-logo")).toBeNull();
    expect(screen.queryByText("Local library")).toBeNull();
    expect(screen.queryByText(/trusted sources/)).toBeNull();
    expect(screen.getByTestId("redesign-github-link").getAttribute("href")).toBe(
      "https://github.com/wylycool/metis",
    );
    expect(screen.getByTestId("redesign-home")).toBeTruthy();
    expect(screen.getByTestId("redesign-search-input")).toBeTruthy();
    expect(screen.getByTestId("redesign-stat-total")).toBeTruthy();
    expect(screen.getByTestId("redesign-stat-updates")).toBeTruthy();
    expect(screen.getByTestId("redesign-stat-latest")).toBeTruthy();
    expect(screen.getByTestId("redesign-skill-grid")).toBeTruthy();
    expect(screen.getByTestId("redesign-skill-card-memory-weaver")).toBeTruthy();
    expect(screen.getByTestId("redesign-agent-stack-memory-weaver")).toBeTruthy();
    expect(screen.getByTestId("redesign-skill-card-agent-palette-lab")).toBeTruthy();
    const previewAgentStack = within(screen.getByTestId("redesign-agent-stack-agent-palette-lab"));
    expect(previewAgentStack.getByTestId("agent-badge-codex")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-badge-claude-code")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-badge-cursor")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-badge-openclaw")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-badge-hermes")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-badge-opencode")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-badge-generic")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-codex")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-claude-code")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-cursor")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-openclaw")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-hermes")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-opencode")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-generic")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-codex-terminal-cloud")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-cursor-hollow-square")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-openclaw-round-mark")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-hermes-profile-headset")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-opencode-terminal-mark")).toBeTruthy();
    expect(previewAgentStack.getByTestId("agent-logo-generic-path-folder")).toBeTruthy();
    expect(
      previewAgentStack
        .getByTestId("agent-logo-codex-terminal-cloud")
        .querySelector(".agent-logo-codex-cloud"),
    ).toBeTruthy();
    expect(
      previewAgentStack
        .getByTestId("agent-logo-codex-terminal-cloud")
        .querySelectorAll(".agent-logo-codex-terminal"),
    ).toHaveLength(2);
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
    expect(screen.getByTestId("redesign-detail-summary").contains(screen.getByTestId("redesign-detail-agent-panel-memory-weaver"))).toBe(
      false,
    );
    expect(screen.getByTestId("redesign-detail-agent-toggle-memory-weaver").getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.queryByTestId("redesign-detail-agent-paths-memory-weaver")).toBeNull();
    await user.click(screen.getByTestId("redesign-detail-agent-toggle-memory-weaver"));
    expect(screen.getByTestId("redesign-detail-agent-toggle-memory-weaver").getAttribute("aria-expanded")).toBe(
      "true",
    );
    const detailAgentPaths = within(await screen.findByTestId("redesign-detail-agent-paths-memory-weaver"));
    const codexInstall = within(
      detailAgentPaths.getByTestId("redesign-detail-agent-path-memory-weaver-codex"),
    );
    expect(codexInstall.getByTestId("agent-logo-codex")).toBeTruthy();
    expect(codexInstall.getByText("Codex")).toBeTruthy();
    expect(codexInstall.getByText("~/.codex/skills/memory-weaver")).toBeTruthy();
    const claudeInstall = within(
      detailAgentPaths.getByTestId("redesign-detail-agent-path-memory-weaver-claude-code"),
    );
    expect(claudeInstall.getByTestId("agent-logo-claude-code")).toBeTruthy();
    expect(claudeInstall.getByText("Claude Code")).toBeTruthy();
    expect(claudeInstall.getByText("~/.claude/skills/memory-weaver")).toBeTruthy();
    const opencodeInstall = within(
      detailAgentPaths.getByTestId("redesign-detail-agent-path-memory-weaver-opencode"),
    );
    expect(opencodeInstall.getByTestId("agent-logo-opencode")).toBeTruthy();
    expect(opencodeInstall.getByText("opencode")).toBeTruthy();
    expect(opencodeInstall.getByText("~/.config/opencode/skills/memory-weaver")).toBeTruthy();
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
    expect(await screen.findByText("已回滚到备份版本，回滚前状态已自动备份")).toBeTruthy();

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
    expect(screen.getByTestId("settings-section-path-management")).toBeTruthy();
    expect(screen.getByTestId("settings-section-custom-monitors")).toBeTruthy();
    expect(screen.getByTestId("settings-section-auto-update")).toBeTruthy();
    expect(screen.queryByTestId("settings-section-enterprise-network")).toBeNull();
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
    expect(screen.getByText("内置 Agent 路径管理")).toBeTruthy();
    expect(screen.queryByTestId("workspace-tab-governance-legacy")).toBeNull();
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

    const defaultSharedRow = await screen.findByTestId("skill-row-shared-codex");
    expect(screen.queryByTestId("skill-row-shared-claude")).toBeNull();
    expect(screen.getAllByTestId(/^skill-row-/)).toHaveLength(2);
    expect(
      within(defaultSharedRow)
        .getByTestId("skill-agent-stack-shared-codex")
        .getAttribute("aria-label"),
    ).toBe("存在于 Codex、Claude Code");

    await user.type(screen.getByTestId("skill-search-input"), "shared");

    const sharedRow = await screen.findByTestId("skill-row-shared-codex");
    expect(screen.queryByTestId("skill-row-shared-claude")).toBeNull();
    expect(screen.queryByTestId("agent-category-bar")).toBeNull();
    const sharedAgentStack = within(sharedRow).getByTestId("skill-agent-stack-shared-codex");
    expect(sharedAgentStack.getAttribute("aria-label")).toBe("存在于 Codex、Claude Code");
    expect(within(sharedAgentStack).getByTestId("agent-logo-codex")).toBeTruthy();
    expect(within(sharedAgentStack).getByTestId("agent-logo-claude-code")).toBeTruthy();
    expect(within(sharedAgentStack).getByTestId("agent-badge-codex").className).toContain(
      "agent-badge-codex",
    );
    expect(within(sharedAgentStack).getByTestId("agent-badge-claude-code").className).toContain(
      "agent-badge-claude-code",
    );

    await user.clear(screen.getByTestId("skill-search-input"));
    await user.type(screen.getByTestId("skill-search-input"), "claude-only");

    expect(await screen.findByTestId("skill-row-claude-only")).toBeTruthy();
    expect(screen.queryByTestId("skill-row-shared-codex")).toBeNull();
    expect(screen.queryByTestId("skill-row-shared-claude")).toBeNull();
  });

  test("sorts home skill cards by recent discovery by default, name, and source state", async () => {
    const user = userEvent.setup();
    const scenario = createHomeSortScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    expect(await screen.findByTestId("skill-sort-select")).toHaveProperty("value", "recent");
    expect(homeSkillRowIds()).toEqual([
      "skill-row-alpha-tool",
      "skill-row-middle-tool",
      "skill-row-zeta-tool",
    ]);

    await user.selectOptions(screen.getByTestId("skill-sort-select"), "name");

    expect(homeSkillRowIds()).toEqual([
      "skill-row-alpha-tool",
      "skill-row-middle-tool",
      "skill-row-zeta-tool",
    ]);

    const headingActions = screen.getByTestId("skill-list-actions");
    expect(
      Array.from(headingActions.children).map((child) =>
        child.getAttribute("data-testid") ?? child.querySelector("[data-testid]")?.getAttribute("data-testid"),
      ),
    ).toEqual(["skill-sort-control", "open-add-skill"]);

    await user.selectOptions(screen.getByTestId("skill-sort-select"), "source");

    expect(homeSkillRowIds()).toEqual([
      "skill-row-middle-tool",
      "skill-row-alpha-tool",
      "skill-row-zeta-tool",
    ]);
  });

  test("backfills missing local update time cache on bootstrap before sorting", async () => {
    const scenario = createMissingLocalUpdatedAtScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await waitFor(() => expect(scenario.scanCalls()).toBe(1));
    expect(homeSkillRowIds()).toEqual([
      "skill-row-alpha-tool",
      "skill-row-zeta-tool",
    ]);
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

    expect((await screen.findByTestId("redesign-toast")).className).toContain("success-toast");
    expect(await screen.findByTestId("check-panel-codex-planner")).toBeTruthy();
  });

  test("keeps the source drawer mounted for its closing animation", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    await user.click(screen.getByTestId("open-bind-source-e2e-skill"));
    const drawer = await screen.findByTestId("source-drawer-e2e-skill");
    expect(drawer.className).not.toContain("is-closing");

    await user.click(within(drawer).getByText("取消"));

    expect(screen.getByTestId("source-drawer-e2e-skill").className).toContain("is-closing");
    await waitFor(() => expect(screen.queryByTestId("source-drawer-e2e-skill")).toBeNull());
  });

  test("redesign toast automatically dismisses after a short delay", async () => {
    render(<App />);

    expect(await screen.findByTestId("redesign-toast")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 3100));
    expect(screen.queryByTestId("redesign-toast")).toBeNull();
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
    expect(scenario.checkedSkillIds()).toContainEqual(["codex-planner", "claude-codex-planner"]);
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
    await user.click(screen.getByTestId("check-updates-e2e-skill"));
    expect(await screen.findByText("有 Agent 需要更新")).toBeTruthy();

    await user.click(screen.getByTestId("toggle-diff-e2e-skill"));
    const diffButton = screen.getByTestId("toggle-diff-e2e-skill");

    expect((diffButton as HTMLButtonElement).disabled).toBe(true);
    expect(diffButton.textContent).toContain("加载 diff");
    expect(scenario.commandCalls("get_skill_diff")).toBe(1);

    expect(await screen.findByTestId("diff-file-SKILL.md")).toBeTruthy();
    expect(screen.queryByText((content) => content.includes("diff --git"))).toBeNull();
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
    const rowAccentStyle = row.getAttribute("style");
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
    expect(screen.getByTestId("skill-intro-card-codex-planner").getAttribute("style")).toBe(
      rowAccentStyle,
    );
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
    expect(
      screen
        .getByTestId("skill-intro-card-codex-planner")
        .contains(screen.getByTestId("skill-detail-agent-panel-codex-planner")),
    ).toBe(false);
    expect(
      screen.getByTestId("skill-detail-agent-toggle-codex-planner").getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByTestId("skill-detail-agent-paths-codex-planner")).toBeNull();
    await user.click(screen.getByTestId("skill-detail-agent-toggle-codex-planner"));
    expect(
      screen.getByTestId("skill-detail-agent-toggle-codex-planner").getAttribute("aria-expanded"),
    ).toBe("true");
    const formalAgentPaths = within(
      await screen.findByTestId("skill-detail-agent-paths-codex-planner"),
    );
    expect(
      within(formalAgentPaths.getByTestId("skill-detail-agent-path-codex-planner-codex")).getByTestId(
        "agent-logo-codex",
      ),
    ).toBeTruthy();
    expect(formalAgentPaths.getByText("Codex")).toBeTruthy();
    expect(formalAgentPaths.getByText("/Users/me/.codex/skills/codex-planner")).toBeTruthy();
    expect(formalAgentPaths.queryByText("opencode")).toBeNull();
    expect(formalAgentPaths.queryByText("/Users/me/.opencode/skills/codex-planner")).toBeNull();
    expect(formalAgentPaths.queryByText("Claude Code")).toBeNull();
    expect(formalAgentPaths.queryByText("/Users/me/.claude/skills/codex-planner")).toBeNull();
    expect(screen.getByTestId("skill-operations-card-codex-planner")).toBeTruthy();
    expect(screen.queryByTestId("cross-agent-lazy-card-codex-planner")).toBeNull();
    expect(screen.queryByTestId("show-cross-agent-targets-codex-planner")).toBeNull();
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
    expect(screen.queryByTestId("target-row-opencode")).toBeNull();

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
    const scenario = createMainFlowScenario({ auditAfterUpdateCheck: true });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    expect(await screen.findByTestId("skill-detail-e2e-skill")).toBeTruthy();
    expect(screen.queryByTestId("apply-needed-agent-updates-e2e-skill")).toBeNull();

    await user.click(screen.getByTestId("open-bind-source-e2e-skill"));
    await user.type(screen.getByTestId("bind-url-e2e-skill"), "file:///tmp/metis-e2e-repo");
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.click(screen.getByTestId("submit-bind-source-e2e-skill"));
    const listCallsBeforeCheck = scenario.commandCalls("list_indexed_skills");
    const auditCallsBeforeCheck = scenario.commandCalls("list_skill_audit_events");
    await user.click(await screen.findByTestId("check-updates-e2e-skill"));

    const applyNeededButton = await screen.findByTestId("apply-needed-agent-updates-e2e-skill");
    const operationRow = applyNeededButton.closest(".redesign-operation-tabs");
    const rowButtons = Array.from(operationRow?.querySelectorAll("button") ?? []);
    expect(applyNeededButton).toBe(rowButtons[rowButtons.length - 1]);
    expect(applyNeededButton.className).toContain("pending");
    expect(applyNeededButton.className).not.toContain("attention");
    expect(scenario.commandCalls("list_indexed_skills")).toBe(listCallsBeforeCheck);
    expect(scenario.commandCalls("list_skill_audit_events")).toBe(auditCallsBeforeCheck + 1);
    expect(await screen.findByText("检查过更新")).toBeTruthy();
  });

  test("shows local modified agent status without including it in normal bulk updates", async () => {
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

    expect(await screen.findByText("有 Agent 存在本地修改")).toBeTruthy();
    await user.click(screen.getByTestId("skill-detail-agent-toggle-e2e-skill"));
    expect(within(screen.getByTestId("skill-detail-agent-path-e2e-skill-generic")).getByText("本地已修改")).toBeTruthy();
    expect(screen.queryByTestId("apply-needed-agent-updates-e2e-skill")).toBeNull();
  });

  test("allows a local modified agent row to be overwritten from source", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ localModifiedAfterCheck: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
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
    await user.click(screen.getByTestId("skill-detail-agent-toggle-e2e-skill"));

    const localModifiedRow = screen.getByTestId("skill-detail-agent-path-e2e-skill-generic");
    expect(within(localModifiedRow).getByText("本地已修改")).toBeTruthy();

    await user.click(within(localModifiedRow).getByTestId("overwrite-local-agent-e2e-skill"));

    expect(confirmSpy).toHaveBeenCalledWith(
      "覆盖更新会先创建备份，然后用来源版本覆盖这个 Agent 中的本地修改。确定继续吗？",
    );
    expect(invokeMock).toHaveBeenCalledWith("apply_skill_update", {
      skillId: "e2e-skill",
    });
    expect(await screen.findByText(/已用来源版本覆盖本地修改/)).toBeTruthy();
    expect(within(localModifiedRow).getByText("无需更新")).toBeTruthy();
    expect(within(localModifiedRow).queryByText("未检查")).toBeNull();
    confirmSpy.mockRestore();
  });

  test("does not overwrite local modifications when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ localModifiedAfterCheck: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
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
    await user.click(screen.getByTestId("skill-detail-agent-toggle-e2e-skill"));

    const localModifiedRow = screen.getByTestId("skill-detail-agent-path-e2e-skill-generic");
    await user.click(within(localModifiedRow).getByTestId("overwrite-local-agent-e2e-skill"));

    expect(confirmSpy).toHaveBeenCalledWith(
      "覆盖更新会先创建备份，然后用来源版本覆盖这个 Agent 中的本地修改。确定继续吗？",
    );
    expect(scenario.commandCalls("apply_skill_update")).toBe(0);
    expect(within(localModifiedRow).getByText("本地已修改")).toBeTruthy();
    confirmSpy.mockRestore();
  });

  test("shows a calm note when applied update includes security findings", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ securityFindingOnApply: true });
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
    await user.click(screen.getByTestId("skill-detail-agent-toggle-e2e-skill"));
    await user.click(await screen.findByTestId("apply-needed-agent-updates-e2e-skill"));

    expect(
      await screen.findByText(/更新内容包含需要留意的脚本或配置字段，来源可信时通常可以继续使用/),
    ).toBeTruthy();
    expect(screen.queryByText(/高危|阻断|疑似远程脚本执行|疑似硬编码密钥/)).toBeNull();
  });

  test("shows recent skill history on the detail page", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ auditHistory: true });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));

    expect(await screen.findByText("历史记录")).toBeTruthy();
    expect(screen.getByText("已应用更新")).toBeTruthy();
    expect(screen.getAllByText("aaa111 -> bbb222").length).toBeGreaterThan(0);
    expect(screen.getByText("检查过更新")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("list_skill_audit_events", {
      skillId: "e2e-skill",
      limit: 6,
    });
  });

  test("does not preload cross agent targets when opening a bound skill detail", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario();
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    await user.click(screen.getByTestId("open-bind-source-e2e-skill"));
    await user.type(screen.getByTestId("bind-url-e2e-skill"), "file:///tmp/metis-e2e-repo");
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.click(screen.getByTestId("submit-bind-source-e2e-skill"));

    expect(await screen.findByText("file:///tmp/metis-e2e-repo")).toBeTruthy();
    expect(scenario.commandCalls("preview_remote_skill_source")).toBe(0);
    expect(scenario.commandCalls("get_skill_targets_for_source")).toBe(0);
    expect(screen.queryByTestId("target-row-codex")).toBeNull();
    expect(screen.queryByTestId("cross-agent-lazy-card-e2e-skill")).toBeNull();
    expect(screen.queryByTestId("show-cross-agent-targets-e2e-skill")).toBeNull();
  });

  test("keeps installed agent update checks in the detail operations area", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario();
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

    expect(await screen.findByText("有 Agent 需要更新")).toBeTruthy();
    await user.click(screen.getByTestId("skill-detail-agent-toggle-e2e-skill"));
    expect(within(screen.getByTestId("skill-detail-agent-path-e2e-skill-generic")).getByText("需要更新")).toBeTruthy();
    expect(await screen.findByTestId("apply-needed-agent-updates-e2e-skill")).toBeTruthy();
    expect(screen.queryByTestId("cross-agent-lazy-card-e2e-skill")).toBeNull();
    expect(screen.queryByTestId("target-row-codex")).toBeNull();
    expect(scenario.commandCalls("preview_remote_skill_source")).toBe(0);
    expect(scenario.commandCalls("get_skill_targets_for_source")).toBe(0);
  });

  test("rechecks remote state on explicit detail update checks", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({
      updateCheckStatuses: ["UpToDate", "UpdateAvailable"],
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
    await screen.findByText("检查完成：0 个 Agent 需要更新");
    await user.click(screen.getByTestId("skill-detail-agent-toggle-e2e-skill"));
    expect(within(screen.getByTestId("skill-detail-agent-path-e2e-skill-generic")).getByText("无需更新")).toBeTruthy();

    await user.click(screen.getByTestId("check-updates-e2e-skill"));

    expect(await screen.findByText("检查完成：1 个 Agent 需要更新")).toBeTruthy();
    expect(within(screen.getByTestId("skill-detail-agent-path-e2e-skill-generic")).getByText("需要更新")).toBeTruthy();
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "check_skill_updates"),
    ).toHaveLength(2);
  });

  test("keeps checked update status after rescanning local skills", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ upToDateAfterCheck: true });
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
    await screen.findByText("检查完成：0 个 Agent 需要更新");
    await user.click(screen.getByText("返回"));

    expect(statValue("已最新")).toBe("1");

    const scanCallsBeforeRescan = scenario.commandCalls("scan_skills");
    await user.click(screen.getByTestId("scan-skills"));
    await waitFor(() => expect(scenario.commandCalls("scan_skills")).toBe(scanCallsBeforeRescan + 1));

    expect(statValue("已最新")).toBe("1");
  });

  test("shows local modified agent status when remote is current", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({
      localModifiedAfterCheck: true,
      sameCommitApply: true,
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

    expect(await screen.findByText("有 Agent 存在本地修改")).toBeTruthy();
    await user.click(screen.getByTestId("skill-detail-agent-toggle-e2e-skill"));
    expect(within(screen.getByTestId("skill-detail-agent-path-e2e-skill-generic")).getByText("本地已修改")).toBeTruthy();
    expect(screen.queryByTestId("apply-needed-agent-updates-e2e-skill")).toBeNull();
    expect(screen.queryByText(/aaa111 -> aaa111/)).toBeNull();
  });

  test("checks every installed agent path from the skill detail page and bulk updates only outdated agents", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ multiAgentSameSkill: true });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-claude-memory"));
    expect(await screen.findByTestId("skill-detail-claude-memory")).toBeTruthy();

    await user.click(screen.getByTestId("skill-detail-agent-toggle-claude-memory"));
    await user.click(screen.getByTestId("check-updates-claude-memory"));

    expect(await screen.findByText("有 Agent 需要更新")).toBeTruthy();
    expect(within(screen.getByTestId("skill-detail-agent-path-claude-memory-claude-code")).getByText("无需更新")).toBeTruthy();
    expect(within(screen.getByTestId("skill-detail-agent-path-claude-memory-codex")).getByText("需要更新")).toBeTruthy();

    expect(invokeMock).toHaveBeenCalledWith("check_skill_updates", {
      request: { skill_ids: ["claude-memory", "codex-memory"] },
    });
    await user.click(await screen.findByTestId("apply-needed-agent-updates-claude-memory"));

    expect(invokeMock).toHaveBeenCalledWith("apply_skill_update", {
      skillId: "codex-memory",
    });
    expect(invokeMock).not.toHaveBeenCalledWith("apply_skill_update", {
      skillId: "claude-memory",
    });
  });

  test("shows custom monitored paths in skill detail installed locations", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ multiAgentSameSkill: true, customMonitorSameSkill: true });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-claude-memory"));
    expect(await screen.findByTestId("skill-detail-claude-memory")).toBeTruthy();

    await user.click(screen.getByTestId("skill-detail-agent-toggle-claude-memory"));

    expect(screen.getByTestId("skill-detail-agent-path-claude-memory-claude-code")).toBeTruthy();
    expect(screen.getByTestId("skill-detail-agent-path-claude-memory-codex")).toBeTruthy();
    const customRow = within(
      screen.getByTestId("skill-detail-agent-path-claude-memory-custom-team-memory"),
    );
    expect(customRow.getByText("团队记忆")).toBeTruthy();
    expect(customRow.getByText("/tmp/team-memory-skills/shared-example-skill")).toBeTruthy();
    expect(customRow.getByText("未检查")).toBeTruthy();
    expect(customRow.queryByText("来源未绑定")).toBeNull();
  });

  test("uses Chinese check panel labels and shows the skill size in detail summary", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({ detailSkillSizeBytes: 12800 });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    const summary = within(await screen.findByTestId("skill-intro-card-e2e-skill"));
    expect(scenario.commandCalls("get_skill_size")).toBe(1);
    expect(summary.getByText("12.5 KB")).toBeTruthy();
    expect(summary.getByText("部分 Agent 暂无法判断")).toBeTruthy();

    const checkPanel = within(screen.getByTestId("check-panel-e2e-skill"));
    expect(checkPanel.getByText("本地版本")).toBeTruthy();
    expect(checkPanel.getByText("未绑定来源")).toBeTruthy();
    expect(checkPanel.getByText("远端版本")).toBeTruthy();
    expect(checkPanel.getByText("差异")).toBeTruthy();
    expect(checkPanel.getAllByText("等待检查")).toHaveLength(2);
    expect(checkPanel.queryByText("Local")).toBeNull();
    expect(checkPanel.queryByText("Diff summary")).toBeNull();
    expect(checkPanel.queryByText("未检查")).toBeNull();

    await user.click(screen.getByText("返回"));
    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    expect(scenario.commandCalls("get_skill_size")).toBe(1);
  });

  test("recalculates lazy skill size after applying an update", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({
      detailSkillSizeBytes: 12800,
      updatedSkillSizeBytes: 20480,
    });
    invokeMock.mockImplementation((command: string, args?: unknown) =>
      scenario.invoke(command, args),
    );

    render(<App />);

    await user.click(await screen.findByTestId("skill-row-e2e-skill"));
    const summary = within(await screen.findByTestId("skill-intro-card-e2e-skill"));
    expect(await summary.findByText("12.5 KB")).toBeTruthy();
    expect(scenario.commandCalls("get_skill_size")).toBe(1);

    await user.click(screen.getByTestId("open-bind-source-e2e-skill"));
    await user.type(screen.getByTestId("bind-url-e2e-skill"), "file:///tmp/metis-e2e-repo");
    await user.type(screen.getByTestId("bind-repo-path-e2e-skill"), "skills/e2e-skill");
    await user.click(screen.getByTestId("submit-bind-source-e2e-skill"));
    await user.click(await screen.findByTestId("check-updates-e2e-skill"));
    await screen.findByText("有 Agent 需要更新");
    await user.click(await screen.findByTestId("apply-needed-agent-updates-e2e-skill"));

    expect(await summary.findByText("20.0 KB")).toBeTruthy();
    expect(scenario.commandCalls("get_skill_size")).toBe(2);
  });

  test("displays source commit versions as 8 characters", async () => {
    const user = userEvent.setup();
    const scenario = createMainFlowScenario({
      localModifiedAfterCheck: true,
      longCommitHashes: true,
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
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

    const checkPanel = within(await screen.findByTestId("check-panel-e2e-skill"));
    expect(checkPanel.getByText("12345678")).toBeTruthy();
    expect(checkPanel.getByText("abcdef12")).toBeTruthy();
    expect(screen.queryByText("1234567890")).toBeNull();
    expect(screen.queryByText("abcdef1234")).toBeNull();

    await user.click(screen.getByTestId("skill-detail-agent-toggle-e2e-skill"));
    await user.click(
      within(screen.getByTestId("skill-detail-agent-path-e2e-skill-generic")).getByTestId(
        "overwrite-local-agent-e2e-skill",
      ),
    );

    expect(await screen.findByText(/已用来源版本覆盖本地修改：abcdef12/)).toBeTruthy();
    expect(screen.queryByText(/abcdef1234/)).toBeNull();
    confirmSpy.mockRestore();
  });
});

function createMainFlowScenario(
  options: {
    auditAfterUpdateCheck?: boolean;
    auditHistory?: boolean;
    customMonitorSameSkill?: boolean;
    detailSkillSizeBytes?: number;
    includeCustomInstallTarget?: boolean;
    localModifiedAfterCheck?: boolean;
    longCommitHashes?: boolean;
    multiAgentSameSkill?: boolean;
    sameCommitApply?: boolean;
    securityFindingOnApply?: boolean;
    sourceConnectionFails?: boolean;
    sshSourceConnectionFails?: boolean;
    slowBind?: boolean;
    slowDiff?: boolean;
    slowRemotePreview?: boolean;
    upToDateAfterCheck?: boolean;
    updatedSkillSizeBytes?: number;
    updateCheckStatuses?: DesktopUpdateCheckResult["status"][];
  } = {},
) {
  let source: DesktopSource = {
    id: "source-e2e-skill",
    source_type: "git",
    url: "file:///tmp/metis-e2e-repo",
    repo_path: "skills/e2e-skill",
    ref_: "main",
    current_commit: options.longCommitHashes ? "1234567890abcdef" : "aaa111",
    remote_commit: "old999",
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
  let currentSkillSizeBytes = options.detailSkillSizeBytes ?? 0;
  let updateCheckIndex = 0;
  let updateCheckAuditAvailable = false;
  let backups: DesktopBackupSummary[] = [backup("backup-pre-update", "pre-update", "aaa111")];
  let indexedSkills: DesktopSkill[] = [];
  const claudeMemorySource: DesktopSource = {
    ...source,
    id: "source-shared-example-skill",
    repo_path: "skills/shared-example-skill",
    current_commit: "799ae9",
    remote_commit: "799ae9",
  };
  const claudeMemorySkill: DesktopSkill = {
    ...skill,
    id: "claude-memory",
    agent_id: "claude-code",
    agent_name: "Claude Code",
    name: "shared-example-skill",
    description: "Python team memory",
    install_path: "/Users/example/.claude/skills/shared-example-skill",
    metadata_path: "/Users/example/.claude/skills/shared-example-skill/SKILL.md",
    source_id: claudeMemorySource.id,
    source: claudeMemorySource,
    local_modified: false,
  };
  const codexMemorySkill: DesktopSkill = {
    ...claudeMemorySkill,
    id: "codex-memory",
    agent_id: "codex",
    agent_name: "Codex",
    install_path: "/Users/example/.codex/skills/shared-example-skill",
    metadata_path: "/Users/example/.codex/skills/shared-example-skill/SKILL.md",
    local_modified: false,
  };
  const customMemorySkill: DesktopSkill = {
    ...claudeMemorySkill,
    id: "custom-team-memory",
    agent_id: "custom-team-memory",
    agent_name: "团队记忆",
    install_path: "/tmp/team-memory-skills/shared-example-skill",
    metadata_path: "/tmp/team-memory-skills/shared-example-skill/SKILL.md",
    source_id: null,
    source: null,
    local_modified: false,
  };
  const calls = new Map<string, number>();

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
        {
          path: "/Users/me/.config/codex/skills",
          scope: "user",
          exists: false,
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
    {
      agent_id: "openclaw",
      agent_name: "OpenClaw",
      enabled: true,
      paths: [
        {
          path: "/Users/me/.openclaw/skills",
          scope: "user",
          exists: true,
          readable: true,
          writable: true,
        },
      ],
    },
    {
      agent_id: "hermes",
      agent_name: "Hermes",
      enabled: true,
      paths: [
        {
          path: "/Users/me/.hermes/skills",
          scope: "user",
          exists: false,
          readable: false,
          writable: false,
        },
      ],
    },
  ];
  let settings: DesktopSettings = {
    custom_scan_paths: [],
    custom_monitored_paths: options.includeCustomInstallTarget
      ? [
          {
            id: "team-memory",
            name: "团队记忆",
            path: "/tmp/team-memory-skills",
          },
        ]
      : [],
    team_policy_path: null,
  };

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
        case "open_external_url":
          return null;
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
          indexedSkills = options.customMonitorSameSkill
            ? [claudeMemorySkill, codexMemorySkill, customMemorySkill]
            : options.multiAgentSameSkill
              ? [claudeMemorySkill, codexMemorySkill]
              : [skill];
          return { skills: indexedSkills, warnings: [] };
        case "get_skill_size":
          return {
            skill_id: (args as { skillId: string }).skillId,
            file_count: currentSkillSizeBytes > 0 ? 3 : 0,
            total_size_bytes: currentSkillSizeBytes,
          };
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
        case "test_source_connection": {
          const request = args as {
            request: {
              url: string;
              repo_path: string;
              ref_: string;
            };
          };
          if (
            options.sourceConnectionFails ||
            (options.sshSourceConnectionFails && request.request.url.startsWith("git@"))
          ) {
            throw JSON.stringify({
              category: "authentication",
              title: "认证失败",
              message: "Metis 访问不了这个仓库",
              suggestion: "请确认你有访问权限，或先在本机 Git 工具中完成登录。",
              debug_detail: "authentication failed: could not read Username",
            });
          }
          return {
            ok: true,
            message: "连接成功，可以保存来源。",
            skill_name: "e2e-skill",
            description: "E2E skill",
            commit: "abc123",
            repo_path: request.request.repo_path,
          } satisfies DesktopSourceConnectionTestResult;
        }
        case "test_git_environment":
          return {
            ok: true,
            message: "本机 Git 可以正常访问公开仓库。",
            url: "https://github.com/wylycool/metis.git",
            commit: "abc123",
          };
        case "preview_remote_skill_source":
          if (options.slowRemotePreview) {
            await delay(80);
          }
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
            ...(options.includeCustomInstallTarget
              ? [
                  {
                    agent_id: "custom-team-memory",
                    agent_name: "团队记忆",
                    root_path: "/tmp/team-memory-skills",
                    install_path: "/tmp/team-memory-skills/remote",
                    status: "NotInstalled",
                    local_modified: false,
                    skill_id: null,
                    source_id: null,
                    root_available: true,
                    root_status: "available",
                  },
                ]
              : []),
          ];
        case "install_remote_skill_to_targets": {
          const request = args as {
            request: {
              targets: Array<{
                agent_id: string;
                install_path: string;
              }>;
            };
          };
          return {
            targets: request.request.targets.map((target) => ({
              agent_id: target.agent_id,
              install_path: target.install_path,
              status: target.agent_id.startsWith("custom-") ? "Updated" : "Installed",
              reason: null,
              skill_id: `${target.agent_id}-remote`,
              backup_id: null,
            })),
          };
        }
        case "check_skill_updates":
          const nextStatus =
            options.updateCheckStatuses?.[updateCheckIndex++] ??
            (options.upToDateAfterCheck === true ? "UpToDate" : "UpdateAvailable");
          updateCheckAuditAvailable = true;
          if (options.multiAgentSameSkill) {
            const request = args as { request: { skill_ids: string[] } };
            return request.request.skill_ids.map((skillId) =>
              skillId === "codex-memory"
                ? updateResult(codexMemorySkill, claudeMemorySource)
                : updateResult(claudeMemorySkill, claudeMemorySource, false, "UpToDate"),
            );
          }
          return [
            updateResult(
              skill,
              source,
              options.localModifiedAfterCheck === true,
              nextStatus,
              options.longCommitHashes ? "abcdef1234567890" : undefined,
            ),
          ];
        case "get_skill_diff":
          if (options.slowDiff) {
            await delay(80);
          }
          return diffDetail();
        case "apply_skill_update": {
          if (options.multiAgentSameSkill) {
            const request = args as { skillId: string };
            const target = request.skillId === "codex-memory" ? codexMemorySkill : claudeMemorySkill;
            return {
              skill_id: target.id,
              previous_commit: "799ae9",
              new_commit: "799ae9",
              backup_id: "backup-pre-update",
              security_findings: [],
              warnings: [],
            } satisfies DesktopApplyUpdateResult;
          }
          const result: DesktopApplyUpdateResult = {
            skill_id: "e2e-skill",
            previous_commit: options.longCommitHashes ? "1234567890abcdef" : "aaa111",
            new_commit: options.longCommitHashes
              ? "abcdef1234567890"
              : options.sameCommitApply
                ? "aaa111"
                : "bbb222",
            backup_id: "backup-pre-update",
            security_findings: options.securityFindingOnApply
              ? [
                  {
                    severity: "Warning",
                    rule_id: "network-exec",
                    message: "需要留意的脚本下载后执行",
                    relative_path: "install.sh",
                    line: 1,
                  },
                ]
              : [],
            warnings: [],
          };
          source = {
            ...source,
            current_commit: options.longCommitHashes ? "abcdef1234567890" : "bbb222",
            remote_commit: options.longCommitHashes ? "abcdef1234567890" : "bbb222",
          };
          skill = {
            ...skill,
            description: "Updated skill",
            source_id: source.id,
            source,
            local_modified: false,
          };
          currentSkillSizeBytes = options.updatedSkillSizeBytes ?? currentSkillSizeBytes;
          backups = [backup("backup-pre-update", "pre-update", "aaa111")];
          indexedSkills = [skill];
          return result;
        }
        case "list_skill_audit_events":
          if (options.auditAfterUpdateCheck && updateCheckAuditAvailable) {
            return [
              {
                id: "audit-check-new",
                skill_id: "e2e-skill",
                action: "UpdateChecked",
                detail: "update checked",
                commit_before: "aaa111",
                commit_after: "bbb222",
                status: "success",
                risk_summary: null,
                created_at: "2026-07-04T14:18:00Z",
              },
            ];
          }
          return options.auditHistory
            ? [
                {
                  id: "audit-new",
                  skill_id: "e2e-skill",
                  action: "UpdateApplied",
                  detail: "update applied",
                  commit_before: "aaa111",
                  commit_after: "bbb222",
                  status: "success",
                  risk_summary: "[]",
                  created_at: "2026-07-01T10:05:00Z",
                },
                {
                  id: "audit-old",
                  skill_id: "e2e-skill",
                  action: "UpdateChecked",
                  detail: "update checked",
                  commit_before: "aaa111",
                  commit_after: "bbb222",
                  status: "success",
                  risk_summary: null,
                  created_at: "2026-07-01T10:00:00Z",
                },
              ]
            : [];
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

function createBetaReadinessScenario(
  options: {
    trustedSources?: boolean;
    autoUpdateSources?: boolean;
  } = {},
) {
  const trustedEnabled = options.trustedSources ?? true;
  const autoUpdateEnabled = options.autoUpdateSources ?? true;
  const trustedSource: DesktopSource = {
    id: "source-trusted-skill",
    source_type: "git",
    url: "file:///tmp/metis-trusted-repo",
    repo_path: "skills/trusted-skill",
    ref_: "main",
    current_commit: "aaa111",
    remote_commit: "bbb222",
    last_checked_at: "2026-06-20T10:00:00Z",
    trusted: trustedEnabled,
    auto_update: autoUpdateEnabled,
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
    auto_update: autoUpdateEnabled,
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
        case "test_git_environment":
          return {
            ok: true,
            message: "本机 Git 可以正常访问公开仓库。",
            url: "https://github.com/wylycool/metis.git",
            commit: "abc123",
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
        case "bind_skill_source": {
          const request = args as {
            request: {
              skill_id: string;
              url: string;
              repo_path: string;
              ref_: string;
              credential_ref?: string | null;
              trusted: boolean;
              auto_update: boolean;
            };
          };
          let updatedSource: DesktopSource | null = null;
          skills = skills.map((skill) => {
            if (skill.id !== request.request.skill_id || !skill.source) {
              return skill;
            }
            updatedSource = {
              ...skill.source,
              url: request.request.url,
              repo_path: request.request.repo_path,
              ref_: request.request.ref_,
              credential_ref: request.request.credential_ref ?? null,
              trusted: request.request.trusted,
              auto_update: request.request.auto_update,
            };
            return {
              ...skill,
              source: updatedSource,
            };
          });
          return updatedSource;
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
    const extraSource: DesktopSource = {
      ...(index % 2 === 0 ? codexSource : claudeSource),
      id: `source-extra-skill-${index}`,
      repo_path: `skills/extra-skill-${index}`,
    };
    skills.push(
      agentDetailSkill(
        `extra-skill-${index}`,
        index % 2 === 0 ? "codex" : "claude-code",
        index % 2 === 0 ? "Codex" : "Claude Code",
        extraSource,
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

function createHomeSortScenario() {
  const middleSource: DesktopSource = {
    id: "source-middle-tool",
    source_type: "git",
    url: "file:///tmp/metis-middle-tool",
    repo_path: "skills/middle-tool",
    ref_: "main",
    current_commit: "bbb222",
    remote_commit: "bbb222",
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
  ];
  const skills: DesktopSkill[] = [
    {
      ...agentDetailSkill("zeta-tool", "codex", "Codex", null),
      name: "zeta-tool",
      last_scanned_at: "2026-06-23T09:00:00Z",
      local_updated_at: "2026-06-21T09:00:00Z",
    },
    {
      ...agentDetailSkill("middle-tool", "codex", "Codex", middleSource),
      name: "middle-tool",
      last_scanned_at: "2026-06-22T09:00:00Z",
      local_updated_at: "2026-06-22T09:00:00Z",
    },
    {
      ...agentDetailSkill("alpha-tool", "codex", "Codex", null),
      name: "alpha-tool",
      last_scanned_at: "2026-06-21T09:00:00Z",
      local_updated_at: "2026-06-23T09:00:00Z",
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

function createMissingLocalUpdatedAtScenario() {
  let scanCount = 0;
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
  ];
  const indexedSkills: DesktopSkill[] = [
    {
      ...agentDetailSkill("zeta-tool", "codex", "Codex", null),
      name: "zeta-tool",
      last_scanned_at: "2026-06-23T09:00:00Z",
      local_updated_at: null,
    },
    {
      ...agentDetailSkill("alpha-tool", "codex", "Codex", null),
      name: "alpha-tool",
      last_scanned_at: "2026-06-21T09:00:00Z",
      local_updated_at: null,
    },
  ];
  const scannedSkills: DesktopSkill[] = [
    {
      ...indexedSkills[0],
      local_updated_at: "2026-06-21T09:00:00Z",
    },
    {
      ...indexedSkills[1],
      local_updated_at: "2026-06-23T09:00:00Z",
    },
  ];

  return {
    scanCalls: () => scanCount,
    async invoke(command: string, _args?: unknown) {
      switch (command) {
        case "list_agents":
          return agents;
        case "list_indexed_skills":
          return indexedSkills;
        case "scan_skills":
          scanCount += 1;
          return { skills: scannedSkills, warnings: [] };
        case "get_desktop_settings":
          return { custom_scan_paths: [] };
        default:
          throw new Error(`Unexpected invoke command: ${command}`);
      }
    },
  };
}

function homeSkillRowIds() {
  return screen
    .getAllByTestId(/^skill-row-/)
    .map((row) => row.getAttribute("data-testid"));
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

function statValue(label: string) {
  const stats = within(screen.getByTestId("skill-dashboard-stats"));
  const statCard = stats.getByText(label).closest("article");
  return statCard?.querySelector("strong")?.textContent ?? "";
}

function updateResult(
  skill: DesktopSkill,
  source: DesktopSource,
  localModified = false,
  status: DesktopUpdateCheckResult["status"] = "UpdateAvailable",
  remoteCommit?: string,
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
      remote_commit: status === "UpdateAvailable" ? remoteCommit ?? "bbb222" : source.current_commit,
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
        path: "skills/shared-example-skill/SKILL.md",
        old_path: null,
        status: "Modified",
        patch:
          "diff --git a/skills/shared-example-skill/SKILL.md b/skills/shared-example-skill/SKILL.md\nindex 77f0ae8..cc01af1 100644\n--- a/skills/shared-example-skill/SKILL.md\n+++ b/skills/shared-example-skill/SKILL.md\n@@ -1,3 +1,3 @@\n-description: Old skill\n+description: Updated skill",
      },
      {
        path: "skills/shared-example-skill/references/mysql-tables.md",
        old_path: null,
        status: "Modified",
        patch:
          "diff --git a/skills/shared-example-skill/references/mysql-tables.md b/skills/shared-example-skill/references/mysql-tables.md\nindex 1111111..2222222 100644\n--- a/skills/shared-example-skill/references/mysql-tables.md\n+++ b/skills/shared-example-skill/references/mysql-tables.md\n@@ -1,2 +1,3 @@\n MySQL tables\n+table: example_records",
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
    created_at: "2026-07-04T14:14:00Z",
    reason,
    file_count: 5,
    total_size_bytes: 15155,
  };
}
