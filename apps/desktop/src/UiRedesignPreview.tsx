import { useMemo, useState, type CSSProperties } from "react";

type PreviewRoute = { kind: "home" } | { kind: "detail"; skillId: string };
type PreviewTheme = "frost" | "sage" | "dawn" | "graphite";

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
  accentStart: string;
  accentEnd: string;
};

const previewSkills: PreviewSkill[] = [
  {
    id: "memory-weaver",
    name: "memory-weaver",
    agent: "Codex",
    description: "Keeps durable project memory tidy across local agent skill folders.",
    status: "update",
    localCommit: "a3f8c2e",
    remoteCommit: "b9d4f1a",
    diffSummary: "+12  -3  lines in 2 files",
    sourceUrl: "git@github.com:acme/agent-skills.git",
    sourcePath: "skills/memory-weaver",
    sourceRef: "main",
    accentStart: "#8a68d8",
    accentEnd: "#6a48b8",
  },
  {
    id: "release-sentinel",
    name: "release-sentinel",
    agent: "Claude Code",
    description: "Checks release readiness, changelog consistency, and artifact handoff notes.",
    status: "latest",
    localCommit: "6c912aa",
    remoteCommit: "6c912aa",
    diffSummary: "+0  -0  lines in 0 files",
    sourceUrl: "git@github.com:acme/agent-skills.git",
    sourcePath: "skills/release-sentinel",
    sourceRef: "main",
    accentStart: "#e06888",
    accentEnd: "#c04868",
  },
  {
    id: "schema-cartographer",
    name: "schema-cartographer",
    agent: "opencode",
    description: "Maps table changes, migration edges, and database review risk.",
    status: "latest",
    localCommit: "dd04f8a",
    remoteCommit: "dd04f8a",
    diffSummary: "+0  -0  lines in 0 files",
    sourceUrl: "git@github.com:acme/agent-skills.git",
    sourcePath: "skills/schema-cartographer",
    sourceRef: "main",
    accentStart: "#38b8a8",
    accentEnd: "#209890",
  },
  {
    id: "ux-pressure-test",
    name: "ux-pressure-test",
    agent: "OpenClaw",
    description: "Runs compact UI critiques before a desktop surface is committed.",
    status: "update",
    localCommit: "78b90e1",
    remoteCommit: "84de4c9",
    diffSummary: "+24  -8  lines in 3 files",
    sourceUrl: "git@github.com:acme/agent-skills.git",
    sourcePath: "skills/ux-pressure-test",
    sourceRef: "main",
    accentStart: "#f0a840",
    accentEnd: "#d08820",
  },
  {
    id: "incident-lens",
    name: "incident-lens",
    agent: "Hermes",
    description: "Collects logs and turns them into readable incident narratives.",
    status: "latest",
    localCommit: "239aa70",
    remoteCommit: "239aa70",
    diffSummary: "+0  -0  lines in 0 files",
    sourceUrl: "git@github.com:acme/agent-skills.git",
    sourcePath: "skills/incident-lens",
    sourceRef: "main",
    accentStart: "#5098e0",
    accentEnd: "#3078c0",
  },
  {
    id: "policy-needle",
    name: "policy-needle",
    agent: "Generic",
    description: "Finds governance drift between local installs and team manifests.",
    status: "latest",
    localCommit: "c8810f2",
    remoteCommit: "c8810f2",
    diffSummary: "+0  -0  lines in 0 files",
    sourceUrl: "git@github.com:acme/agent-skills.git",
    sourcePath: "skills/policy-needle",
    sourceRef: "main",
    accentStart: "#40c090",
    accentEnd: "#209870",
  },
];

const previewAgents = ["All", "Codex", "Claude", "opencode", "Hermes"];
const previewThemes: Array<{ id: PreviewTheme; label: string }> = [
  { id: "frost", label: "Frost" },
  { id: "sage", label: "Sage" },
  { id: "dawn", label: "Dawn" },
  { id: "graphite", label: "Graphite" },
];

const previewMatrix = [
  { agent: "codex", status: "latest", active: true },
  { agent: "claude-code", status: "latest", active: true },
  { agent: "opencode", status: "not installed", active: false },
  { agent: "openclaw", status: "update", active: true },
];

export function UiRedesignPreview() {
  const [route, setRoute] = useState<PreviewRoute>({ kind: "home" });
  const [theme, setTheme] = useState<PreviewTheme>("frost");
  const selectedSkill = useMemo(
    () =>
      route.kind === "detail"
        ? previewSkills.find((skill) => skill.id === route.skillId) ?? previewSkills[0]
        : null,
    [route],
  );

  return (
    <div className="redesign-preview-shell" data-testid="ui-redesign-preview" data-theme={theme}>
      <RedesignRail />
      <main className="redesign-main">
        <RedesignThemeSwitcher activeTheme={theme} onChange={setTheme} />
        {route.kind === "home" && (
          <RedesignHome onOpenSkill={(skillId) => setRoute({ kind: "detail", skillId })} />
        )}
        {selectedSkill && (
          <RedesignDetail skill={selectedSkill} onBack={() => setRoute({ kind: "home" })} />
        )}
      </main>
    </div>
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

function RedesignRail() {
  return (
    <aside className="redesign-rail" data-testid="redesign-rail" aria-label="Preview navigation">
      <div className="redesign-rail-logo" aria-label="Metis preview logo">
        <span />
      </div>
      <nav className="redesign-rail-nav">
        <button className="active" aria-label="Skills preview">
          <GridIcon />
        </button>
        <button aria-label="Governance preview">
          <TargetIcon />
        </button>
      </nav>
      <button className="redesign-rail-settings" aria-label="Settings preview">
        <GearIcon />
      </button>
    </aside>
  );
}

function RedesignHome({ onOpenSkill }: { onOpenSkill: (skillId: string) => void }) {
  const latestCount = previewSkills.filter((skill) => skill.status === "latest").length;
  const updateCount = previewSkills.filter((skill) => skill.status === "update").length;

  return (
    <section className="redesign-home" data-testid="redesign-home">
      <div className="redesign-stage" data-testid="redesign-stage">
        <header className="redesign-masthead" data-testid="redesign-masthead">
          <div>
            <p>Local Skill Command Center</p>
            <h1 className="redesign-masthead-title">Metis Skill Atlas</h1>
            <span>Scan, compare, update, and govern every agent skill from one calm desktop bridge.</span>
          </div>
          <div className="redesign-status-numbers" aria-label="Status counts">
            <span className="latest" /> {latestCount * 6 + 2}
            <span className="update" /> {updateCount * 5}
          </div>
        </header>

        <div className="redesign-hero-stats" data-testid="redesign-hero-stats">
          <div>
            <span>Total Skills</span>
            <strong>48</strong>
          </div>
          <div>
            <span>Agents</span>
            <strong>6</strong>
          </div>
          <div>
            <span>Trusted Sources</span>
            <strong>31</strong>
          </div>
          <div>
            <span>Needs Review</span>
            <strong>10</strong>
          </div>
        </div>

        <div className="redesign-topbar">
          <button className="redesign-search-button" aria-label="Search skills">
            <SearchIcon />
          </button>
          <div className="redesign-agent-pills" aria-label="Agent filters">
            {previewAgents.map((agent, index) => (
              <button className={index === 0 ? "active" : ""} key={agent}>
                <span aria-hidden="true" />
                {agent}
              </button>
            ))}
          </div>
        </div>

        <div className="redesign-home-grid">
          <div className="redesign-orb-zone">
            <div className="redesign-orb" data-testid="redesign-orb">
              48
            </div>
          </div>
          <div className="redesign-skill-list" data-testid="redesign-skill-list">
            {previewSkills.map((skill) => (
              <button
                className="redesign-skill-row"
                data-testid={`redesign-skill-row-${skill.id}`}
                key={skill.id}
                onClick={() => onOpenSkill(skill.id)}
                style={accentStyle(skill)}
              >
                <span className="redesign-skill-accent" aria-hidden="true" />
                <span className="redesign-skill-copy">
                  <strong>{skill.name}</strong>
                  <small>{skill.agent}</small>
                </span>
                <span className={`redesign-status-dot ${skill.status}`} aria-hidden="true" />
              </button>
            ))}
            <p className="redesign-more-skills">+ 42 more</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function RedesignDetail({ skill, onBack }: { skill: PreviewSkill; onBack: () => void }) {
  return (
    <section
      className="redesign-detail"
      data-testid={`redesign-skill-detail-${skill.id}`}
      style={accentStyle(skill)}
    >
      <header className="redesign-detail-hero" data-testid="redesign-detail-hero">
        <div className="redesign-detail-header">
          <button className="redesign-back-button" aria-label="Back to preview home" onClick={onBack}>
            <span aria-hidden="true">{"<"}</span>
          </button>
          <span className="redesign-detail-diamond" aria-hidden="true" />
          <strong>{skill.name}</strong>
          <small>{skill.agent}</small>
        </div>
        <span className={`redesign-detail-status ${skill.status}`}>
          {skill.status === "latest" ? "latest" : "update"}
        </span>
        <div className="redesign-detail-hero-copy">
          <p>Skill Source Bridge</p>
          <h2>{skill.description}</h2>
        </div>
      </header>

      <div className="redesign-detail-layout">
        <div className="redesign-detail-flow">
          <section className="redesign-version-card" data-testid="redesign-version-card">
            <p>Versions</p>
            <div>
              <span>Local</span>
              <strong>{skill.localCommit}</strong>
            </div>
            <div>
              <span>Remote</span>
              <strong>{skill.remoteCommit}</strong>
            </div>
            <code>{skill.diffSummary}</code>
          </section>

          <section className="redesign-source-card" data-testid="redesign-source-card">
            <p>Source</p>
            <code>{skill.sourceUrl}</code>
            <div>
              <span>ref / {skill.sourceRef}</span>
              <span>path / {skill.sourcePath}</span>
              <span>trusted / on</span>
              <span>auto-update / manual</span>
            </div>
          </section>

          <section className="redesign-action-card">
            <button className="redesign-apply-button">Apply Update</button>
            <div>
              <button>View Diff</button>
              <button>Backup</button>
              <button className="danger">Unbind</button>
            </div>
          </section>
        </div>

        <aside className="redesign-install-matrix" data-testid="redesign-install-matrix">
          <p>Agent Install Matrix</p>
          {previewMatrix.map((row) => (
            <div className="redesign-install-matrix-row" key={row.agent}>
              <span className={row.active ? row.status : "inactive"} aria-hidden="true" />
              <strong>{row.agent}</strong>
              <small>{row.status}</small>
            </div>
          ))}
        </aside>
      </div>

      <section className="redesign-migration-notes">
        <h3>后续真实改造切入点</h3>
        <p>
          先把当前 `SkillsWorkspace` 的 list/detail route 拆成可替换容器，再迁移 CSS token 与
          SkillRow/SkillDetailPage 的结构，最后接入真实搜索激活态和跨 Agent 矩阵。
        </p>
      </section>
    </section>
  );
}

function accentStyle(skill: PreviewSkill): CSSProperties {
  return {
    "--redesign-accent-start": skill.accentStart,
    "--redesign-accent-end": skill.accentEnd,
  } as CSSProperties;
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

function TargetIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" />
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
