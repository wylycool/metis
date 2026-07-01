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
        <>
          <path d="M12 4.2 18.6 8v8L12 19.8 5.4 16V8L12 4.2Z" />
          <path d="m8.2 8.8 7.6 6.4M15.8 8.8l-7.6 6.4M12 4.2v15.6" />
        </>
      )}
      {kind === "claude-code" && (
        <>
          <path d="M12 4.5v15M4.5 12h15" />
          <path d="m7.2 7.2 9.6 9.6M16.8 7.2l-9.6 9.6" />
        </>
      )}
      {kind === "cursor" && (
        <>
          <path d="M6.2 4.8 18.5 12l-5.2 1.2-2.5 5.2L6.2 4.8Z" />
          <path d="m12.9 13.1 3.5 3.5" />
        </>
      )}
      {kind === "openclaw" && (
        <>
          <path d="M7.2 5.8c-2 3.2-1.8 6.9.6 10.8" />
          <path d="M12 4.8c-1.5 3.7-1.3 7.7.6 12" />
          <path d="M16.8 5.8c-.8 3.5-.3 6.8 1.6 10" />
        </>
      )}
      {kind === "hermes" && (
        <>
          <path d="M5 14.2c3.2-4.8 7.8-7.3 14-7.4" />
          <path d="M5.2 14.2c4.1-.2 7.4.9 9.8 3.4" />
          <path d="M8.6 10.6h6.7M6.8 13h7" />
        </>
      )}
      {kind === "opencode" && (
        <>
          <path d="m9.4 7-4.2 5 4.2 5" />
          <path d="m14.6 7 4.2 5-4.2 5" />
          <path d="m13 5.8-2 12.4" />
        </>
      )}
      {kind === "generic" && (
        <>
          <path d="M5 8.2h14v9.4H5z" />
          <path d="M5 8.2l2.3-2.4h4.2l1.5 2.4" />
          <path d="M8.2 12h7.6M8.2 15h4.8" />
        </>
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
