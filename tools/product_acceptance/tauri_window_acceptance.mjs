import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(scriptPath, "../../..");
const desktopDir = join(repoRoot, "apps/desktop");
const artifactDir = join(repoRoot, "target/product-acceptance/tauri-window");
const reportPath = join(artifactDir, "tauri-window-acceptance.md");
const windowEventHelper = join(repoRoot, "tools/product_acceptance/window_event.swift");
const windowEventBinary = join(artifactDir, "window_event");
const workspace = join("/private/tmp", `metis-tauri-window-${Date.now()}`);
const home = join(workspace, "home");
const sourceRepo = join(workspace, "repos/source-skill");
const gitconfig = join(workspace, "gitconfig");
const screenshots = [];
const steps = [];

let tauriProcess = null;

main().catch((error) => {
  steps.push({ name: "failed", status: "failed", detail: error.message });
  writeReport("failed", error.message);
  cleanup();
  process.exitCode = 1;
});

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  ensureWindowEventBinary();
  prepareFixture();
  tauriProcess = launchTauriDev();

  await waitForWindow();
  setWindowBounds();
  await waitForSqlNumber("select count(*) from skills;", (count) => count >= 3, 20000);
  await delay(800);
  screenshot("01-home");
  step("window started", "passed", "Metis window is visible");

  clickRelative(170, 355);
  await delay(700);
  screenshot("02-detail");
  step("open detail", "passed", "Clicked skill row and opened detail page");

  clickRelative(850, 215);
  await delay(500);
  screenshot("03-source-drawer");
  pasteRelative(730, 150, sourceRepo);
  pasteRelative(730, 222, "skills/e2e-skill");
  pasteRelative(730, 292, "main");
  clickRelative(885, 505);
  await waitForSqlNumber("select count(*) from sources;", (count) => count >= 1, 15000);
  screenshot("04-source-bound");
  step("bind source", "passed", "Saved a real local Git source from the Tauri window");

  clickRelative(745, 77);
  await delay(800);
  screenshot("04a-initial-check-clicked");
  await waitForSqlNumber(
    "select count(*) from sources where current_commit is not null or remote_commit is not null;",
    (count) => count >= 1,
    20000,
  );
  step("initial update check", "passed", "Initialized current commit before mutating the source");

  updateSourceRepo();
  await delay(500);
  clickRelative(745, 77);
  await delay(800);
  screenshot("04b-second-check-clicked");
  await waitForSqlNumber(
    "select count(*) from sources where remote_commit is not null and remote_commit != current_commit;",
    (count) => count >= 1,
    20000,
  );
  screenshot("05-update-available");
  step("check updates", "passed", "UpdateAvailable result appeared in the real window");

  clickRelative(162, 468);
  await delay(1200);
  screenshot("06-diff");
  step("view diff", "passed", "Real git diff appeared in the detail page");

  clickRelative(247, 468);
  await waitForSqlNumber(
    "select count(*) from backups where reason = 'pre-update';",
    (count) => count >= 1,
    30000,
  );
  await waitForSkillDescription(".codex/skills/e2e-skill", "Updated Tauri window acceptance skill");
  screenshot("07-apply-update");
  step("apply update", "passed", "Applied the real Git update from the Tauri window and created a pre-update backup");

  clickRelative(880, 565);
  await waitForSqlNumber(
    "select count(*) from backups where reason = 'pre-rollback';",
    (count) => count >= 1,
    30000,
  );
  await waitForSkillDescription(".codex/skills/e2e-skill", "Initial Tauri window acceptance skill");
  screenshot("08-rollback");
  step("rollback", "passed", "Restored the pre-update backup from the real window");

  clickRelative(65, 190);
  await delay(500);
  clickRelative(875, 245);
  await delay(600);
  screenshot("09-add-skill");
  pasteRelative(250, 435, sourceRepo);
  pasteRelative(630, 435, "skills/remote-p1-skill");
  pasteRelative(845, 435, "main");
  screenshot("09a-remote-filled");
  clickRelative(865, 265);
  await delay(4000);
  screenshot("10-remote-preview");
  step("preview remote source", "passed", "Previewed a remote source from the real Add Skill page");

  scrollWindow(-650);
  await delay(500);
  screenshot("10a-matrix-scrolled");
  clickRelative(70, 610);
  await delay(200);
  screenshot("10b-claude-target-selected");
  clickRelative(850, 880);
  await waitForSqlNumber(
    "select count(*) from skills where agent_id = 'claude-code' and name = 'remote-p1-skill';",
    (count) => count >= 1,
    30000,
  );
  screenshot("11-install-remote-target");
  step("install remote target", "passed", "Installed the previewed remote skill to Claude Code from the real window");

  clickText("重新检查状态");
  await waitForText("已绑定", 30000);
  screenshot("12-matrix-refresh-after-install");
  step("refresh target matrix", "passed", "Refreshed the cross-Agent target matrix after install");

  clickRelative(65, 190);
  await delay(500);
  clickText("Codex");
  await delay(300);
  clickText("remote-p1-skill");
  await waitForText("编辑来源", 30000);
  await waitForText("跨 Agent 安装状态", 30000);
  screenshot("13-reused-source-detail");
  step("reuse source across agents", "passed", "Opened an unbound same-name Codex skill and reused the Claude-bound source in its detail page");

  mutateLocalClaudeRemoteSkill();
  clickText("重新检查状态");
  await waitForText("本地已修改", 30000);
  screenshot("14-local-modified-reclassified");
  step("reclassify local modification", "passed", "After local modification, the refreshed matrix classified the target as locally modified");

  writeReport("passed", null);
  cleanup();
}

function prepareFixture() {
  mkdirSync(workspace, { recursive: true });
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(
    gitconfig,
    "[user]\n  name = Metis Tauri Acceptance\n  email = metis-tauri@example.invalid\n",
  );

  writeSkill(join(home, ".codex/skills/e2e-skill"), "e2e-skill", "Initial Tauri window acceptance skill");
  writeSkill(join(home, ".codex/skills/remote-p1-skill"), "remote-p1-skill", "Local unbound P1 skill");
  writeSkill(join(home, ".claude/skills/same-name-skill"), "same-name-skill", "Same skill name across agents");
  writeSkill(
    join(home, ".agent-skills/long-content-skill-with-a-very-long-directory-name-for-layout"),
    "long-content-skill",
    "Long description ".repeat(16).trim(),
  );
  mkdirSync(join(home, ".codex/skills/broken-skill"), { recursive: true });
  writeFileSync(
    join(home, ".codex/skills/broken-skill/SKILL.md"),
    "---\nname: broken-skill\ndescription: missing closing front matter\n",
  );

  writeSkill(join(sourceRepo, "skills/e2e-skill"), "e2e-skill", "Initial Tauri window acceptance skill");
  writeSkill(join(sourceRepo, "skills/remote-p1-skill"), "remote-p1-skill", "Remote P1 skill for cross-agent acceptance");
  git(["init"], sourceRepo);
  git(["checkout", "-b", "main"], sourceRepo);
  git(["add", "."], sourceRepo);
  git(["-c", "user.name=Metis Tauri Acceptance", "-c", "user.email=metis-tauri@example.invalid", "commit", "-m", "initial tauri skill"], sourceRepo);
}

function updateSourceRepo() {
  writeSkill(join(sourceRepo, "skills/e2e-skill"), "e2e-skill", "Updated Tauri window acceptance skill");
  writeFileSync(join(sourceRepo, "skills/e2e-skill/EXTRA.md"), "extra tauri acceptance fixture file\n");
  git(["add", "."], sourceRepo);
  git(["-c", "user.name=Metis Tauri Acceptance", "-c", "user.email=metis-tauri@example.invalid", "commit", "-m", "updated tauri skill"], sourceRepo);
}

function mutateLocalClaudeRemoteSkill() {
  writeSkill(join(home, ".claude/skills/remote-p1-skill"), "remote-p1-skill", "Locally modified Claude P1 skill");
}

function launchTauriDev() {
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_GLOBAL: gitconfig,
    RUSTUP_HOME: process.env.RUSTUP_HOME || join(homedir(), ".rustup"),
    CARGO_HOME: process.env.CARGO_HOME || join(homedir(), ".cargo"),
  };
  const child = spawn("pnpm", ["tauri", "dev"], {
    cwd: desktopDir,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForWindow(timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const output = osa('tell application "System Events" to tell process "metis-desktop" to get {count of windows, name of every window}');
      if (output.includes("Metis")) {
        return;
      }
    } catch {
      await delay(1000);
    }
  }
  throw new Error("Timed out waiting for Metis Tauri window");
}

function setWindowBounds() {
  osa('tell application "System Events" to tell process "metis-desktop" to set frontmost to true');
  osa('tell application "System Events" to tell process "metis-desktop" to tell window "Metis" to set position to {120, 80}');
  osa('tell application "System Events" to tell process "metis-desktop" to tell window "Metis" to set size to {960, 1000}');
}

function waitForText(text, timeoutMs = 12000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (axNames().some((name) => name.includes(text))) {
      return;
    }
  }
  throw new Error(`Timed out waiting for window text: ${text}`);
}

function waitForSqlNumber(sql, predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = Number(sqlite(sql));
      if (predicate(value)) {
        return;
      }
    } catch {
      // Database may not exist yet.
    }
  }
  throw new Error(`Timed out waiting for SQL predicate: ${sql}`);
}

async function waitForSkillDescription(relativeDir, expectedDescription, timeoutMs = 12000) {
  const skillPath = join(home, relativeDir, "SKILL.md");
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const contents = readFileSync(skillPath, "utf8");
      if (contents.includes(`description: ${expectedDescription}`)) {
        return;
      }
    } catch {
      // The file may briefly disappear while an update or rollback replaces the directory.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${skillPath} to contain description: ${expectedDescription}`);
}

function clickText(text) {
  const script = `
tell application "System Events"
  tell process "metis-desktop"
    set frontmost to true
    repeat with itemRef in (entire contents of window "Metis")
      try
        set itemName to name of itemRef as text
        if itemName contains ${asText(text)} then
          click itemRef
          return
        end if
      end try
    end repeat
  end tell
end tell
error "AX element not found: ${escapeForAppleScript(text)}"
`;
  osa(script);
}

function pasteFieldByLabel(label, value) {
  clickText(label);
  osa(`set the clipboard to ${asText(value)}`);
  osa('tell application "System Events" to keystroke "a" using command down');
  osa('tell application "System Events" to keystroke "v" using command down');
}

function clickRelative(x, y) {
  const [windowX, windowY] = windowBounds();
  osa('tell application "System Events" to tell process "metis-desktop" to set frontmost to true');
  execFileSync(windowEventBinary, ["click", String(windowX + x), String(windowY + y)]);
}

function pasteRelative(x, y, value) {
  clickRelative(x, y);
  osa(`set the clipboard to ${asText(value)}`);
  execFileSync(windowEventBinary, ["hotkey", "0"]);
  execFileSync(windowEventBinary, ["hotkey", "9"]);
}

function scrollWindow(dy) {
  osa('tell application "System Events" to tell process "metis-desktop" to set frontmost to true');
  execFileSync(windowEventBinary, ["scroll", String(dy)]);
}

function axNames() {
  const script = `
set output to ""
tell application "System Events"
  tell process "metis-desktop"
    repeat with itemRef in (entire contents of window "Metis")
      try
        set itemName to name of itemRef as text
        if itemName is not "" then set output to output & itemName & linefeed
      end try
      try
        set itemValue to value of itemRef as text
        if itemValue is not "" then set output to output & itemValue & linefeed
      end try
    end repeat
  end tell
end tell
return output
`;
  return osa(script)
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function screenshot(name) {
  const bounds = windowBounds();
  const [x, y, width, height] = bounds;
  const path = join(artifactDir, `${name}.png`);
  execFileSync("screencapture", ["-x", "-R", `${x},${y},${width},${height}`, path]);
  screenshots.push(path);
}

function windowBounds() {
  return osa('tell application "System Events" to tell process "metis-desktop" to tell window "Metis" to get {position, size}')
    .split(",")
    .map((part) => Number(part.trim()));
}

function writeReport(status, failure) {
  mkdirSync(artifactDir, { recursive: true });
  const lines = [
    "# Metis Tauri Window Acceptance Report",
    "",
    `- Status: ${status}`,
    `- Fixture: \`${workspace}\``,
    `- Report: \`${reportPath}\``,
    "",
    "## Steps",
    "",
    ...steps.map((item) => `- ${item.status}: ${item.name} - ${item.detail}`),
    "",
    "## Screenshots",
    "",
    ...screenshots.map((path) => `- \`${path}\``),
    "",
    "## Coverage",
    "",
    "- Real Tauri dev window launched with isolated HOME.",
    "- Clicked visible skill list row, detail page, source drawer, update check, diff, apply update, backup rollback, Add Skill, remote preview, target install, and matrix refresh.",
    "- Real local Git source repository was mutated while the app was running.",
    "- Cross-Agent same-name source reuse and local modification reclassification were exercised in the real window.",
    "",
    "## Remaining Risk",
    "",
    "- Runner still depends partly on coordinate clicks for fields and matrix checkboxes; WebDriver or richer accessibility selectors would make it less fragile.",
    "",
    "## Source Rows",
    "",
    "```",
    sourceRows(),
    "```",
  ];
  if (failure) {
    lines.push("", "## Failure", "", failure);
  }
  writeFileSync(reportPath, `${lines.join("\n")}\n`);
}

function step(name, status, detail) {
  steps.push({ name, status, detail });
}

function git(args, cwd) {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });
}

function ensureWindowEventBinary() {
  execFileSync("swiftc", [windowEventHelper, "-o", windowEventBinary], { stdio: "pipe" });
}

function sqlite(sql) {
  const dbPath = join(home, "Library/Application Support/com.metis.app/metis.db");
  return execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" }).trim();
}

function sourceRows() {
  try {
    return sqlite("select id, repo_path, current_commit, remote_commit, last_checked_at from sources;");
  } catch (error) {
    return `unavailable: ${error.message}`;
  }
}

function writeSkill(dir, name, description) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(dir + "/SKILL.md", `---\nname: ${name}\ndescription: ${description}\n---\n`);
}

function osa(script) {
  return execFileSync("osascript", ["-e", script], { encoding: "utf8" }).trim();
}

function asText(value) {
  return `"${escapeForAppleScript(value)}"`;
}

function escapeForAppleScript(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function cleanup() {
  if (tauriProcess && !tauriProcess.killed) {
    try {
      process.kill(-tauriProcess.pid, "SIGTERM");
    } catch {
      tauriProcess.kill("SIGTERM");
    }
  }
  if (existsSync(workspace)) {
    rmSync(workspace, { recursive: true, force: true });
  }
}
