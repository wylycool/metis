export type AgentIdentity = {
  agent_id: string;
  agent_name: string;
};

type AgentBadgeStackProps = {
  agents: AgentIdentity[];
  testId: string;
};

type BadgeDescriptor = {
  label: string;
  className: string;
  logo?: AgentLogoKind;
};

type AgentLogoKind =
  | "claude-code"
  | "codex"
  | "cursor"
  | "generic"
  | "hermes"
  | "openclaw"
  | "opencode";

const AGENT_BADGES: Record<string, BadgeDescriptor> = {
  "claude-code": { label: "C", className: "agent-badge-claude-code", logo: "claude-code" },
  codex: { label: "C", className: "agent-badge-codex", logo: "codex" },
  cursor: { label: "C", className: "agent-badge-cursor", logo: "cursor" },
  generic: { label: "G", className: "agent-badge-generic", logo: "generic" },
  hermes: { label: "H", className: "agent-badge-hermes", logo: "hermes" },
  openclaw: { label: "O", className: "agent-badge-openclaw", logo: "openclaw" },
  opencode: { label: "O", className: "agent-badge-opencode", logo: "opencode" },
};

export function AgentBadgeStack({ agents, testId }: AgentBadgeStackProps) {
  const uniqueAgents = uniqueAgentIdentities(agents);
  const label = uniqueAgents.map((agent) => agent.agent_name).join("、");

  return (
    <span
      aria-label={`存在于 ${label || "未知 Agent"}`}
      className="skill-agent-stack redesign-agent-stack"
      data-testid={testId}
    >
      {uniqueAgents.map((agent) => {
        return (
          <AgentBadge agent={agent} key={normalizeAgentId(agent.agent_id || agent.agent_name)} />
        );
      })}
    </span>
  );
}

export function AgentBadge({ agent, testId }: { agent: AgentIdentity; testId?: string }) {
  const normalizedId = normalizeAgentId(agent.agent_id || agent.agent_name);
  const descriptor = badgeDescriptor(normalizedId, agent.agent_name);

  return (
    <span
      className={`agent-badge ${descriptor.className}`}
      data-testid={testId ?? `agent-badge-${normalizedId}`}
      title={agent.agent_name}
    >
      {descriptor.logo ? (
        <AgentBadgeLogo kind={descriptor.logo} />
      ) : (
        <span className="agent-badge-letter">{descriptor.label}</span>
      )}
    </span>
  );
}

function AgentBadgeLogo({ kind }: { kind: AgentLogoKind }) {
  return (
    <svg
      aria-hidden="true"
      className="agent-badge-logo"
      data-testid={`agent-logo-${kind}`}
      viewBox="0 0 24 24"
    >
      {kind === "codex" && (
        <g data-testid="agent-logo-codex-terminal-cloud">
          <path
            className="agent-logo-codex-cloud"
            d="M7.1 17.2h9.2a3.2 3.2 0 0 0 .8-6.3A4.9 4.9 0 0 0 7.7 9a4.1 4.1 0 0 0-.6 8.2Z"
            opacity="0.95"
          />
          <path
            className="agent-logo-codex-terminal"
            d="m8.5 10.1 2.2 2.1-2.2 2.1"
            strokeWidth="1.9"
          />
          <path
            className="agent-logo-codex-terminal"
            d="M13.2 14.2h3.1"
            strokeWidth="1.9"
          />
        </g>
      )}
      {kind === "claude-code" && (
        <>
          <path d="M12 4.4v15.2M4.4 12h15.2" strokeWidth="2.1" />
          <path d="m7.1 7.1 9.8 9.8M16.9 7.1l-9.8 9.8" strokeWidth="2.1" />
        </>
      )}
      {kind === "cursor" && (
        <g data-testid="agent-logo-cursor-hollow-square">
          <rect height="14.8" rx="3.2" width="14.8" x="4.6" y="4.6" strokeWidth="2" />
          <rect
            className="agent-logo-fill"
            height="6.4"
            rx="0.8"
            width="5.4"
            x="9.3"
            y="8.8"
          />
        </g>
      )}
      {kind === "openclaw" && (
        <g data-testid="agent-logo-openclaw-round-mark">
          <circle className="agent-logo-fill" cx="12" cy="12.1" r="5.8" opacity="0.92" />
          <path d="M7.1 10.6c-1.3 0-2.2.8-2.2 1.8 0 1.1.9 1.9 2.3 1.9" stroke="#ef4444" strokeWidth="1.8" />
          <path d="M16.9 10.6c1.3 0 2.2.8 2.2 1.8 0 1.1-.9 1.9-2.3 1.9" stroke="#ef4444" strokeWidth="1.8" />
          <path d="M9 6.6 7.4 5M15 6.6 16.6 5" stroke="#ef4444" strokeWidth="1.7" />
          <circle className="agent-logo-eye" cx="10" cy="11.5" r="0.85" />
          <circle className="agent-logo-eye" cx="14" cy="11.5" r="0.85" />
        </g>
      )}
      {kind === "hermes" && (
        <g data-testid="agent-logo-hermes-profile-headset">
          <path
            className="agent-logo-fill"
            d="M7.4 15.2c1.1-6 5.3-8.9 10.1-7.7-2.2 1.1-3.1 3.1-3.1 6.2 0 1.8-1.5 3.1-3.4 3.1-1.4 0-2.5-.5-3.6-1.6Z"
          />
          <path d="M16.4 8.6c1.2 1.4 1.5 3.6.7 5.8" stroke="#f8fafc" strokeWidth="1.3" />
          <path d="M17.1 10.2h1.5v4h-1.5" stroke="#111827" strokeWidth="1.5" />
          <path d="M10.8 16.2v2.1" stroke="#111827" strokeWidth="1.5" />
        </g>
      )}
      {kind === "opencode" && (
        <g data-testid="agent-logo-opencode-terminal-mark">
          <rect height="12.2" rx="2.2" width="15.2" x="4.4" y="5.9" strokeWidth="1.8" />
          <path d="m8 9.8 2.3 2.2L8 14.2" strokeWidth="2" />
          <path d="M12.8 14.2h3.4" strokeWidth="2" />
        </g>
      )}
      {kind === "generic" && (
        <g data-testid="agent-logo-generic-path-folder">
          <path d="M5 8.2h14v9.4H5z" />
          <path d="M5 8.2l2.3-2.4h4.2l1.5 2.4" />
          <path d="M8.2 12h7.6M8.2 15h4.8" />
        </g>
      )}
    </svg>
  );
}

export function normalizeAgentId(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function badgeDescriptor(agentId: string, agentName: string) {
  return (
    AGENT_BADGES[agentId] ?? {
      label: (agentName.trim()[0] ?? "A").toUpperCase(),
      className: "agent-badge-default",
    }
  );
}

function uniqueAgentIdentities(agents: AgentIdentity[]) {
  const seen = new Set<string>();
  const unique: AgentIdentity[] = [];

  for (const agent of agents) {
    const id = normalizeAgentId(agent.agent_id || agent.agent_name);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(agent);
  }

  return unique;
}
