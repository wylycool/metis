import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AgentBadge, AgentBadgeStack, normalizeAgentId, type AgentIdentity } from "./AgentBadge";
import { CrystalSkillLogo } from "./CrystalSkillLogo";
import { GitHubIcon } from "./GitHubIcon";
import { textInputAssistanceProps } from "./inputAssistance";
import { MetisBrandWordmark } from "./MetisBrandWordmark";
import { METIS_GITHUB_URL } from "./projectLinks";

type PreviewRoute = { kind: "home" } | { kind: "detail"; skillId: string } | { kind: "settings" };
type PreviewTheme = "frost" | "sage" | "dawn" | "graphite";
type PreviewOperation = "check" | "diff" | "backups";

type PreviewSkill = {
  id: string;
  name: string;
  agent: string;
  description: string;
  status: "latest" | "update";
  localCommit: string;
  remoteCommit: string;
  diffSummary: string;
  sourceUrl: string;
  sourcePath: string;
  sourceRef: string;
  trusted: boolean;
  autoUpdate: boolean;
  agents: string[];
  accentStart: string;
  accentEnd: string;
};

type AgentPath = {
  id: string;
  name: string;
  path: string;
  status: "ready" | "missing";
};

const previewThemes: Array<{ id: PreviewTheme; label: string }> = [
  { id: "frost", label: "Frost" },
  { id: "sage", label: "Sage" },
  { id: "dawn", label: "Dawn" },
  { id: "graphite", label: "Graphite" },
];

const previewSkills: PreviewSkill[] = [
  {
    id: "memory-weaver",
    name: "memory-weaver",
    agent: "Codex",
    description:
      "Keeps durable project memory tidy across local agent skill folders and flags stale source bindings before they drift.",
    status: "update",
    localCommit: "a3f8c2e",
    remoteCommit: "b9d4f1a",
    diffSummary: "+12 -3 lines in 2 files",
    sourceUrl: "git@github.com:acme/agent-skills.git",
    sourcePath: "skills/memory-weaver",
    sourceRef: "main",
    trusted: true,
    autoUpdate: false,
    agents: ["codex", "claude-code", "opencode"],
    accentStart: "#496ee8",
    accentEnd: "#7f5be8",
  },
  {
    id: "release-sentinel",
    name: "release-sentinel",
    agent: "Claude Code",
    description:
      "Checks release readiness, changelog consistency, artifact handoff notes, and missing smoke evidence.",
    status: "latest",
    localCommit: "6c912aa",
    remoteCommit: "6c912aa",
    diffSummary: "+0 -0 lines in 0 files",
    sourceUrl: "git@github.com:acme/agent-skills.git",
    sourcePath: "skills/release-sentinel",
    sourceRef: "main",
    trusted: true,
    autoUpdate: true,
    agents: ["claude-code", "generic"],
    accentStart: "#f06498",
    accentEnd: "#c94f7d",
  },
  {
    id: "schema-cartographer",
    name: "schema-cartographer",
    agent: "opencode",
    description:
      "Maps table changes, migration edges, and database review risk into compact handoff notes.",
    status: "latest",
    localCommit: "dd04f8a",
    remoteCommit: "dd04f8a",
    diffSummary: "+0 -0 lines in 0 files",
    sourceUrl: "git@github.com:acme/agent-skills.git",
    sourcePath: "skills/schema-cartographer",
    sourceRef: "main",
    trusted: false,
    autoUpdate: false,
    agents: ["opencode", "hermes"],
    accentStart: "#2db8a0",
    accentEnd: "#159a86",
  },
  {
    id: "ux-pressure-test",
    name: "ux-pressure-test",
    agent: "OpenClaw",
    description:
      "Runs compact UI critiques before a desktop surface is committed, including overflow and copy density checks.",
    status: "update",
    localCommit: "78b90e1",
    remoteCommit: "84de4c9",
    diffSummary: "+24 -8 lines in 3 files",
    sourceUrl: "git@github.com:acme/agent-skills.git",
    sourcePath: "skills/ux-pressure-test",
    sourceRef: "main",
    trusted: true,
    autoUpdate: false,
    agents: ["openclaw", "codex"],
    accentStart: "#f0ad47",
    accentEnd: "#d98225",
  },
  {
    id: "incident-lens",
    name: "incident-lens",
    agent: "Hermes",
    description:
      "Collects logs and turns them into readable incident narratives with timelines and owner prompts.",
    status: "latest",
    localCommit: "239aa70",
    remoteCommit: "239aa70",
    diffSummary: "+0 -0 lines in 0 files",
    sourceUrl: "",
    sourcePath: "",
    sourceRef: "",
    trusted: false,
    autoUpdate: false,
    agents: ["hermes"],
    accentStart: "#4c9fdb",
    accentEnd: "#2f75bf",
  },
  {
    id: "policy-needle",
    name: "policy-needle",
    agent: "Generic",
    description:
      "Finds governance drift between local installs, trusted source policy, and team manifests.",
    status: "latest",
    localCommit: "c8810f2",
    remoteCommit: "c8810f2",
    diffSummary: "+0 -0 lines in 0 files",
    sourceUrl: "git@github.com:acme/agent-skills.git",
    sourcePath: "skills/policy-needle",
    sourceRef: "main",
    trusted: true,
    autoUpdate: true,
    agents: ["generic", "codex", "claude-code"],
    accentStart: "#41bf80",
    accentEnd: "#1e9667",
  },
  {
    id: "agent-palette-lab",
    name: "agent-palette-lab",
    agent: "All Agents",
    description:
      "Preview-only card for checking the full overlapping badge palette across every supported agent.",
    status: "latest",
    localCommit: "9f2a011",
    remoteCommit: "9f2a011",
    diffSummary: "+0 -0 lines in 0 files",
    sourceUrl: "git@github.com:acme/agent-skills.git",
    sourcePath: "skills/agent-palette-lab",
    sourceRef: "main",
    trusted: true,
    autoUpdate: false,
    agents: ["codex", "claude-code", "cursor", "qoder", "gemini-cli", "openclaw", "hermes", "opencode", "generic"],
    accentStart: "#8fa8ff",
    accentEnd: "#69cdbd",
  },
];

const agentPaths: AgentPath[] = [
  { id: "codex", name: "Codex", path: "~/.codex/skills", status: "ready" },
  { id: "claude-code", name: "Claude Code", path: "~/.claude/skills", status: "ready" },
  { id: "openclaw", name: "OpenClaw", path: "~/Library/Application Support/OpenClaw/skills", status: "missing" },
  { id: "hermes", name: "Hermes", path: "~/.hermes/skills", status: "ready" },
  { id: "opencode", name: "opencode", path: "~/.config/opencode/skills", status: "ready" },
  { id: "cursor", name: "Cursor", path: "~/.cursor/skills", status: "ready" },
  { id: "qoder", name: "Qoder", path: "~/.qoder/skills", status: "ready" },
  { id: "gemini-cli", name: "Gemini CLI", path: "~/.gemini/skills", status: "ready" },
  { id: "generic", name: "Generic", path: "~/agent-skills", status: "ready" },
];

export function UiRedesignPreview() {
  const [route, setRoute] = useState<PreviewRoute>({ kind: "home" });
  const [theme, setTheme] = useState<PreviewTheme>("frost");
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [activeOperation, setActiveOperation] = useState<PreviewOperation>("check");
  const [customPaths, setCustomPaths] = useState(["~/work/metis-lab/skills"]);
  const selectedSkill = useMemo(
    () =>
      route.kind === "detail"
        ? previewSkills.find((skill) => skill.id === route.skillId) ?? previewSkills[0]
        : null,
    [route],
  );

  function showToast(message: string) {
    setToast(message);
  }

  function openSkill(skillId: string) {
    setActiveOperation("check");
    setSourceDrawerOpen(false);
    setRoute({ kind: "detail", skillId });
  }

  return (
    <div className="redesign-preview-shell" data-testid="ui-redesign-preview" data-theme={theme}>
      <div className="redesign-app-window" data-testid="redesign-app-window">
        <RedesignSidebar
          route={route}
          onHome={() => setRoute({ kind: "home" })}
          onSettings={() => setRoute({ kind: "settings" })}
        />
        <main className="redesign-main">
          <RedesignThemeSwitcher activeTheme={theme} onChange={setTheme} />
          {route.kind === "home" && (
            <RedesignHome
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onOpenSkill={openSkill}
              onToast={showToast}
            />
          )}
          {selectedSkill && (
            <RedesignDetail
              activeOperation={activeOperation}
              onBack={() => setRoute({ kind: "home" })}
              onOpenDrawer={() => setSourceDrawerOpen(true)}
              onOperation={setActiveOperation}
              onToast={showToast}
              skill={selectedSkill}
            />
          )}
          {route.kind === "settings" && (
            <RedesignSettings
              customPaths={customPaths}
              onAddPath={() => {
                setCustomPaths([...customPaths, "~/Library/Application Support/Metis/custom-skills"]);
                showToast("已添加额外扫描路径");
              }}
            />
          )}
        </main>
      </div>
      {sourceDrawerOpen && selectedSkill && (
        <SourceDrawer
          onCancel={() => setSourceDrawerOpen(false)}
          onSave={() => {
            setSourceDrawerOpen(false);
            showToast("来源设置已保存");
          }}
          skill={selectedSkill}
        />
      )}
      {sourceDrawerOpen && <button className="redesign-drawer-scrim" aria-label="关闭来源抽屉" onClick={() => setSourceDrawerOpen(false)} />}
      {toast && <div className="redesign-toast" data-testid="redesign-toast">{toast}</div>}
    </div>
  );
}

function RedesignSidebar({
  route,
  onHome,
  onSettings,
}: {
  route: PreviewRoute;
  onHome: () => void;
  onSettings: () => void;
}) {
  return (
    <aside className="redesign-sidebar">
      <div className="redesign-brand-row" data-testid="redesign-brand-row">
        <a
          className="redesign-brand"
          data-testid="redesign-brand-logo"
          href={METIS_GITHUB_URL}
          rel="noreferrer"
          target="_blank"
        >
          <span className="redesign-logo-mark" aria-hidden="true">
            <CrystalSkillLogo testId="redesign-brand-crystal-logo" />
          </span>
          <span>
            <MetisBrandWordmark testId="redesign-brand-wordmark" />
            <small>Skill Manager</small>
          </span>
        </a>
      </div>
      <nav className="redesign-side-nav" aria-label="Preview navigation">
        <button className={route.kind !== "settings" ? "active" : ""} onClick={onHome}>
          <LayersIcon /> Skills
        </button>
        <button onClick={onHome}>
          <RefreshIcon /> Updates
        </button>
        <button
          className={route.kind === "settings" ? "active" : ""}
          data-testid="redesign-nav-settings"
          onClick={onSettings}
        >
          <SlidersIcon /> Settings
        </button>
      </nav>
      <div className="redesign-sidebar-footer" data-testid="redesign-sidebar-footer">
        <a
          className="redesign-github-link"
          data-testid="redesign-github-link"
          href={METIS_GITHUB_URL}
          rel="noreferrer"
          target="_blank"
          aria-label="打开 Metis GitHub 仓库"
          title="GitHub"
        >
          <GitHubIcon />
        </a>
      </div>
    </aside>
  );
}

function RedesignThemeSwitcher({
  activeTheme,
  onChange,
}: {
  activeTheme: PreviewTheme;
  onChange: (theme: PreviewTheme) => void;
}) {
  return (
    <div className="redesign-theme-switcher" aria-label="Preview background themes">
      {previewThemes.map((theme) => (
        <button
          aria-pressed={activeTheme === theme.id}
          className={activeTheme === theme.id ? "active" : ""}
          data-testid={`redesign-theme-${theme.id}`}
          key={theme.id}
          onClick={() => onChange(theme.id)}
        >
          <span className="redesign-theme-swatch" aria-hidden="true" />
          {theme.label}
        </button>
      ))}
    </div>
  );
}

function RedesignHome({
  searchQuery,
  onSearchChange,
  onOpenSkill,
  onToast,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onOpenSkill: (skillId: string) => void;
  onToast: (message: string) => void;
}) {
  const filteredSkills = previewSkills.filter((skill) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return true;
    }
    return `${skill.name} ${skill.agent} ${skill.description}`.toLowerCase().includes(query);
  });
  const updateCount = previewSkills.filter((skill) => skill.status === "update").length;
  const latestCount = previewSkills.filter((skill) => skill.status === "latest").length;

  return (
    <section className="redesign-home" data-testid="redesign-home">
      <header className="redesign-page-topbar">
        <div>
          <p>Skill Dashboard</p>
          <h1>本机 Skill 工作台</h1>
        </div>
        <label className="redesign-search-field">
          <SearchIcon />
          <input
            {...textInputAssistanceProps}
            data-testid="redesign-search-input"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索 skill、agent 或来源"
            value={searchQuery}
          />
          <span>{filteredSkills.length} results</span>
        </label>
        <div className="redesign-top-actions">
          <button data-testid="redesign-check-updates" onClick={() => onToast("检查完成：2 个 skill 待更新")}>
            检查更新
          </button>
          <button data-testid="redesign-rescan" onClick={() => onToast("已重新扫描本机 skill 路径")}>
            重新扫描
          </button>
        </div>
      </header>

      <div className="redesign-home-stats">
        <StatCard testId="redesign-stat-total" tone="mint" label="全部 Skill" value="48" />
        <StatCard testId="redesign-stat-updates" tone="warm" label="待更新" value={String(updateCount)} />
        <StatCard testId="redesign-stat-latest" tone="blue" label="已最新" value={String(latestCount)} />
        <StatCard testId="redesign-stat-trusted" tone="rose" label="可信来源" value="31" />
      </div>

      <div className="redesign-section-heading">
        <div>
          <p>Skill inventory</p>
          <h2>跨 Agent 安装概览</h2>
        </div>
        <span>{filteredSkills.length} of 48 visible</span>
      </div>

      <div className="redesign-skill-grid" data-testid="redesign-skill-grid">
        {filteredSkills.map((skill) => (
          <button
            className="redesign-skill-card"
            data-testid={`redesign-skill-card-${skill.id}`}
            key={skill.id}
            onClick={() => onOpenSkill(skill.id)}
            style={accentStyle(skill)}
          >
            <span className="redesign-card-accent" aria-hidden="true" />
            <span className={`redesign-card-status ${skill.status}`}>
              {skill.status === "update" ? "待更新" : "已最新"}
            </span>
            <strong>{skill.name}</strong>
            <small>{skill.agent}</small>
            <p>{skill.description}</p>
            <span className="redesign-card-footer">
              <span>{skill.sourcePath || "未绑定来源"}</span>
              <AgentStack skill={skill} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function StatCard({
  testId,
  tone,
  label,
  value,
}: {
  testId: string;
  tone: "mint" | "warm" | "blue" | "rose";
  label: string;
  value: string;
}) {
  return (
    <div className={`redesign-stat-card ${tone}`} data-testid={testId}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RedesignDetail({
  activeOperation,
  onBack,
  onOpenDrawer,
  onOperation,
  onToast,
  skill,
}: {
  activeOperation: PreviewOperation;
  onBack: () => void;
  onOpenDrawer: () => void;
  onOperation: (operation: PreviewOperation) => void;
  onToast: (message: string) => void;
  skill: PreviewSkill;
}) {
  return (
    <section
      className="redesign-detail"
      data-testid={`redesign-skill-detail-${skill.id}`}
      style={accentStyle(skill)}
    >
      <button className="redesign-back-button" data-testid="redesign-back-home" onClick={onBack}>
        返回
      </button>

      <header className="redesign-detail-summary" data-testid="redesign-detail-summary">
        <div>
          <span className="redesign-detail-kicker">Skill detail</span>
          <h1>{skill.name}</h1>
          <p>{skill.description}</p>
        </div>
        <div className="redesign-source-summary">
          <span>来源</span>
          <strong>{skill.sourceUrl || "未绑定来源"}</strong>
          <small>{skill.sourcePath ? `${skill.sourcePath} · ${skill.sourceRef}` : ""}</small>
          <button data-testid="redesign-open-source-drawer" onClick={onOpenDrawer}>
            {skill.sourceUrl ? "修改来源" : "添加来源"}
          </button>
        </div>
      </header>

      <DetailAgentPaths skill={skill} />

      <section className="redesign-update-workbench" data-testid="redesign-update-workbench">
        <div aria-label="Skill 版本操作" className="redesign-operation-tabs" role="group">
          <button
            aria-busy="false"
            className="operation-button operation-button--check"
            data-testid="redesign-action-check"
            onClick={() => {
              onOperation("check");
              onToast("检查完成：远端 b9d4f1a 可用");
            }}
          >
            检查更新
          </button>
          <button
            aria-busy="false"
            aria-controls="redesign-preview-diff-panel"
            aria-expanded={activeOperation === "diff"}
            className={`operation-button operation-button--diff ${
              activeOperation === "diff" ? "active" : ""
            }`}
            data-testid="redesign-action-diff"
            onClick={() => onOperation("diff")}
          >
            查看 diff
          </button>
          <button
            aria-busy="false"
            aria-controls="redesign-preview-backup-panel"
            aria-expanded={activeOperation === "backups"}
            className={`operation-button operation-button--backup ${
              activeOperation === "backups" ? "active" : ""
            }`}
            data-testid="redesign-action-backups"
            onClick={() => onOperation("backups")}
          >
            备份/回滚
          </button>
        </div>
        {activeOperation === "check" && <CheckPanel />}
        {activeOperation === "diff" && <DiffViewer />}
        {activeOperation === "backups" && <BackupPanel onRollback={() => onToast("已回滚到备份版本，回滚前状态已自动备份")} />}
      </section>
    </section>
  );
}

function CheckPanel() {
  return (
    <div className="redesign-check-panel" data-testid="redesign-check-panel">
      <div>
        <span>检查结果</span>
        <strong>需要更新</strong>
      </div>
      <div className="redesign-check-diff-summary">
        <span>差异</span>
        <DiffSummaryChips added={1} modified={2} />
      </div>
      <section className="redesign-diff-summary-showcase" aria-label="差异排版示例">
        <DiffSummaryExample title="只有修改" modified={2} />
        <DiffSummaryExample title="新增 + 修改" added={1} modified={2} />
        <DiffSummaryExample title="新增 + 修改 + 删除" added={2} modified={3} deleted={1} />
        <DiffSummaryExample title="只有删除" deleted={1} />
        <DiffSummaryExample title="无变化" empty />
      </section>
    </div>
  );
}

function DiffSummaryExample({
  added = 0,
  deleted = 0,
  empty = false,
  modified = 0,
  title,
}: {
  added?: number;
  deleted?: number;
  empty?: boolean;
  modified?: number;
  title: string;
}) {
  return (
    <article className="redesign-diff-summary-example">
      <span>{title}</span>
      <DiffSummaryChips added={added} deleted={deleted} empty={empty} modified={modified} />
    </article>
  );
}

function DiffSummaryChips({
  added = 0,
  deleted = 0,
  empty = false,
  modified = 0,
}: {
  added?: number;
  deleted?: number;
  empty?: boolean;
  modified?: number;
}) {
  return (
    <div className="redesign-diff-summary-chips">
      {added > 0 && <b className="added">新增 {added} 个文件</b>}
      {modified > 0 && <b className="modified">修改 {modified} 个文件</b>}
      {deleted > 0 && <b className="deleted">删除 {deleted} 个文件</b>}
      {empty && <b className="empty">无需查看 diff</b>}
    </div>
  );
}

function DetailAgentPaths({ skill }: { skill: PreviewSkill }) {
  const installedAgents = skill.agents.map(previewAgentIdentity);
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <section className="redesign-detail-agent-panel" data-testid={`redesign-detail-agent-panel-${skill.id}`}>
      <button
        aria-controls={`redesign-detail-agent-paths-${skill.id}`}
        aria-expanded={isExpanded}
        className="redesign-detail-agent-toggle"
        data-testid={`redesign-detail-agent-toggle-${skill.id}`}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span>
          <small>安装位置</small>
          <strong>{installedAgents.length} 个 Agent 已安装此 skill</strong>
        </span>
        <span className="redesign-detail-agent-toggle-action">
          {isExpanded ? "收起" : "展开"}
          <span aria-hidden="true">{isExpanded ? "↑" : "↓"}</span>
        </span>
      </button>
      {isExpanded && (
        <div
          className="redesign-detail-agent-paths"
          data-testid={`redesign-detail-agent-paths-${skill.id}`}
          id={`redesign-detail-agent-paths-${skill.id}`}
        >
          {installedAgents.map((agent) => {
            const agentId = normalizeAgentId(agent.agent_id || agent.agent_name);
            return (
              <div
                className="redesign-detail-agent-path-row"
                data-testid={`redesign-detail-agent-path-${skill.id}-${agentId}`}
                key={agentId}
              >
                <AgentBadge agent={agent} />
                <span>{agent.agent_name}</span>
                <code>{previewAgentInstallPath(agent, skill.name)}</code>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DiffViewer() {
  return (
    <div
      className="redesign-diff-viewer"
      data-testid="redesign-diff-viewer"
      id="redesign-preview-diff-panel"
    >
      <div className="redesign-diff-files">
        <button className="active">SKILL.md</button>
        <button>references/usage.md</button>
      </div>
      <div className="redesign-diff-code">
        <div className="redesign-diff-line muted">@@ -1,7 +1,9 @@</div>
        <div className="redesign-diff-line removed">-description: Keeps durable project memory tidy.</div>
        <div className="redesign-diff-line added">+description: Keeps durable project memory tidy across local agent skill folders.</div>
        <div className="redesign-diff-line added">+triggers: memory, project notes, continuity</div>
        <div className="redesign-diff-line">  Use when project context should survive between sessions.</div>
      </div>
    </div>
  );
}

function BackupPanel({ onRollback }: { onRollback: () => void }) {
  return (
    <div
      className="redesign-backup-panel"
      data-testid="redesign-backup-panel"
      id="redesign-preview-backup-panel"
    >
      <div>
        <strong>pre-update-2026-06-30</strong>
        <span>7 files · 18 KB · before applying b9d4f1a</span>
        <button data-testid="redesign-rollback-latest" onClick={onRollback}>回滚</button>
      </div>
      <div>
        <strong>manual-snapshot-2026-06-28</strong>
        <span>7 files · 17 KB · user snapshot</span>
        <button>查看</button>
      </div>
    </div>
  );
}

function SourceDrawer({
  onCancel,
  onSave,
  skill,
}: {
  onCancel: () => void;
  onSave: () => void;
  skill: PreviewSkill;
}) {
  return (
    <aside className="redesign-source-drawer" data-testid="redesign-source-drawer">
      <header>
        <span>Source binding</span>
        <h2>{skill.name}</h2>
      </header>
      <label>
        Git URL
        <input {...textInputAssistanceProps} data-testid="redesign-source-url" defaultValue={skill.sourceUrl || "git@github.com:acme/agent-skills.git"} />
      </label>
      <label>
        Repo path
        <input {...textInputAssistanceProps} data-testid="redesign-source-repo-path" defaultValue={skill.sourcePath || `skills/${skill.name}`} />
      </label>
      <label>
        Ref
        <input {...textInputAssistanceProps} data-testid="redesign-source-ref" defaultValue={skill.sourceRef || "main"} />
      </label>
      <label className="redesign-checkbox-row">
        <input data-testid="redesign-source-trusted" defaultChecked={skill.trusted} type="checkbox" />
        Trusted
      </label>
      <label className="redesign-checkbox-row">
        <input data-testid="redesign-source-auto-update" defaultChecked={skill.autoUpdate} type="checkbox" />
        Auto update
      </label>
      <footer>
        <button onClick={onCancel}>取消</button>
        <button data-testid="redesign-save-source" onClick={onSave}>保存</button>
      </footer>
    </aside>
  );
}

function RedesignSettings({
  customPaths,
  onAddPath,
}: {
  customPaths: string[];
  onAddPath: () => void;
}) {
  const [agentPathDrafts, setAgentPathDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(agentPaths.map((agent) => [agent.id, agent.path])),
  );
  const [editingAgentPathId, setEditingAgentPathId] = useState<string | null>(null);
  const agentPathInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!editingAgentPathId) {
      return;
    }
    const input = agentPathInputRefs.current[editingAgentPathId];
    input?.focus();
    input?.select();
  }, [editingAgentPathId]);

  return (
    <section className="redesign-settings-page" data-testid="redesign-settings-page">
      <header className="redesign-page-topbar">
        <div>
          <p>Settings</p>
          <h1>Agent 路径设置</h1>
        </div>
      </header>
      <section className="settings-section path-management-section">
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
        <div className="settings-agent-path-table redesign-agent-path-table">
          {agentPaths.map((agent) => {
            const currentPath = agentPathDrafts[agent.id] ?? agent.path;
            const isEditing = editingAgentPathId === agent.id;
            const isDirty = currentPath.trim() !== agent.path.trim();
            const statusLabel = isDirty
              ? "路径有待保存修改"
              : agent.status === "ready"
                ? "路径可读写"
                : "路径不存在";
            return (
              <div
                className={`settings-agent-path-row redesign-agent-path-row${
                  !isDirty && agent.status === "missing" ? " missing" : ""
                }${isDirty ? " is-dirty" : ""}`}
                data-testid={`redesign-agent-path-${agent.id}`}
                key={agent.id}
              >
                <span
                  aria-label={`${agent.name}，${statusLabel}`}
                  className={isDirty ? "pending" : agent.status}
                >
                  {agent.name}
                </span>
                <input
                  {...textInputAssistanceProps}
                  aria-label={`${agent.name} Skill 路径`}
                  readOnly={!isEditing}
                  ref={(input) => {
                    agentPathInputRefs.current[agent.id] = input;
                  }}
                  value={currentPath}
                  onChange={(event) =>
                    setAgentPathDrafts((current) => ({
                      ...current,
                      [agent.id]: event.target.value,
                    }))
                  }
                />
                <div className="agent-path-row-actions">
                  {isDirty && <small className="agent-path-pending-badge">待保存</small>}
                  <button
                    className="ghost-button compact agent-path-edit-button"
                    data-testid={`redesign-agent-path-${isEditing ? "cancel" : "edit"}-${agent.id}`}
                    onClick={() => {
                      if (isEditing) {
                        setAgentPathDrafts((current) => ({ ...current, [agent.id]: agent.path }));
                        setEditingAgentPathId(null);
                        return;
                      }
                      setEditingAgentPathId(agent.id);
                    }}
                    type="button"
                  >
                    {isEditing ? "取消" : "修改"}
                  </button>
                </div>
              </div>
            );
          })}
          {customPaths.map((path) => (
            <label className="settings-agent-path-row redesign-agent-path-row custom" key={path}>
              <span>Custom</span>
              <input {...textInputAssistanceProps} defaultValue={path} />
              <small>额外路径</small>
            </label>
          ))}
        </div>
      </section>
      <button className="redesign-add-path" data-testid="redesign-add-custom-path" onClick={onAddPath}>
        添加指定路径
      </button>
    </section>
  );
}

function AgentStack({ skill }: { skill: PreviewSkill }) {
  return <AgentBadgeStack agents={skill.agents.map(previewAgentIdentity)} testId={`redesign-agent-stack-${skill.id}`} />;
}

function previewAgentIdentity(agentId: string): AgentIdentity {
  const names: Record<string, string> = {
    "claude-code": "Claude Code",
    codex: "Codex",
    cursor: "Cursor",
    "gemini-cli": "Gemini CLI",
    generic: "Generic Agent Skills",
    hermes: "Hermes",
    openclaw: "OpenClaw",
    opencode: "opencode",
    qoder: "Qoder",
  };
  return { agent_id: agentId, agent_name: names[agentId] ?? agentId };
}

function previewAgentInstallPath(agent: AgentIdentity, skillName: string) {
  const agentId = normalizeAgentId(agent.agent_id || agent.agent_name);
  const basePath = agentPaths.find((candidate) => candidate.id === agentId)?.path ?? "~/agent-skills";
  return `${basePath}/${skillName}`;
}

function accentStyle(skill: PreviewSkill): CSSProperties {
  return {
    "--redesign-accent-start": skill.accentStart,
    "--redesign-accent-end": skill.accentEnd,
  } as CSSProperties;
}

function LayersIcon() {
  return (
    <svg aria-hidden="true" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="m12 3-8 4.5 8 4.5 8-4.5L12 3Z" />
      <path d="m4 12 8 4.5 8-4.5" />
      <path d="m4 16.5 8 4.5 8-4.5" />
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

function SlidersIcon() {
  return (
    <svg aria-hidden="true" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 4h-7" />
      <path d="M10 4H3" />
      <path d="M14 2v4" />
      <path d="M21 12h-9" />
      <path d="M8 12H3" />
      <path d="M8 10v4" />
      <path d="M21 20h-5" />
      <path d="M12 20H3" />
      <path d="M16 18v4" />
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
