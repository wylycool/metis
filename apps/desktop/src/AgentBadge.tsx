type AgentIdentity = {
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
        const normalizedId = normalizeAgentId(agent.agent_id || agent.agent_name);
        const descriptor = badgeDescriptor(normalizedId, agent.agent_name);
        return (
          <span
            className={`agent-badge ${descriptor.className}`}
            data-testid={`agent-badge-${normalizedId}`}
            key={normalizedId}
            title={agent.agent_name}
          >
            {descriptor.logo ? (
              <AgentBadgeLogo kind={descriptor.logo} />
            ) : (
              <span className="agent-badge-letter">{descriptor.label}</span>
            )}
          </span>
        );
      })}
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
          <path d="M7.2 16.8h8.7a3.1 3.1 0 0 0 .8-6 4.7 4.7 0 0 0-8.9-1.5A3.8 3.8 0 0 0 7.2 16.8Z" />
          <path d="m8.8 10.3 2.2 2.1-2.2 2.1" />
          <path d="M13.2 14.4h3.2" />
        </g>
      )}
      {kind === "claude-code" && (
        <>
          <path d="M12 4.5v15M4.5 12h15" />
          <path d="m7.2 7.2 9.6 9.6M16.8 7.2l-9.6 9.6" />
        </>
      )}
      {kind === "cursor" && (
        <g data-testid="agent-logo-cursor-hollow-square">
          <rect height="14" rx="3.2" width="14" x="5" y="5" />
          <rect height="6.2" rx="0.8" width="5.2" x="9.4" y="8.8" />
        </g>
      )}
      {kind === "openclaw" && (
        <g data-testid="agent-logo-openclaw-round-mark">
          <circle cx="12" cy="12" r="5.7" />
          <path d="M7.4 10.4c-1.4-.1-2.4.7-2.4 1.8s.9 2 2.3 2" />
          <path d="M16.6 10.4c1.4-.1 2.4.7 2.4 1.8s-.9 2-2.3 2" />
          <path d="M9 6.4 7.4 4.8M15 6.4l1.6-1.6" />
          <circle cx="10" cy="11.4" fill="currentColor" r="0.7" stroke="none" />
          <circle cx="14" cy="11.4" fill="currentColor" r="0.7" stroke="none" />
        </g>
      )}
      {kind === "hermes" && (
        <g data-testid="agent-logo-hermes-profile-headset">
          <path d="M16.4 7.4c-1.8-1.8-5.4-2.1-7.4-.2-1.8 1.6-2.1 4.6-.9 6.6" />
          <path d="M8 13.4c1.7 1.8 3.7 2.6 6.4 2.5" />
          <path d="M7.9 10.4c2.1-.7 4.3-.9 6.8-.4" />
          <path d="M16.3 7.7c1.4 1.6 1.7 4 .8 6.5" />
          <path d="M17.1 10.2h1.5v4h-1.5" />
          <path d="M11.2 16.2v2.2" />
        </g>
      )}
      {kind === "opencode" && (
        <g data-testid="agent-logo-opencode-terminal-mark">
          <rect height="12" rx="2" width="15" x="4.5" y="6" />
          <path d="m8.2 10 2.2 2-2.2 2" />
          <path d="M12.7 14h3.2" />
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
