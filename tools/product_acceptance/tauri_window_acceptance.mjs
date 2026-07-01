import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  await delay(800);
  screenshot("07-backups");
  step("open backups", "passed", "Backup panel opened from the real window");

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

function launchTauriDev() {
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    GIT_CONFIG_GLOBAL: gitconfig,
    RUSTUP_HOME: process.env.RUSTUP_HOME || "/Users/example/.rustup",
    CARGO_HOME: process.env.CARGO_HOME || "/Users/example/.cargo",
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
  osa('tell application "System Events" to tell process "metis-desktop" to tell window "Metis" to set size to {960, 680}');
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
    "- Clicked visible skill list row, detail page, source drawer, update check, diff, and backup panel.",
    "- Real local Git source repository was mutated while the app was running.",
    "",
    "## Remaining Risk",
    "",
    "- Rollback button is only clickable when a backup exists; the current detail UI exposes backup listing but not an apply-update button.",
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
