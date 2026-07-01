type AgentIdentity = {
  agent_id: string;
  agent_name: string;
};

type AgentBadgeStackProps = {
  agents: AgentIdentity[];
  testId: string;
};

const AGENT_BADGES: Record<string, { label: string; className: string }> = {
  "claude-code": { label: "C", className: "agent-badge-claude-code" },
  codex: { label: "C", className: "agent-badge-codex" },
  cursor: { label: "C", className: "agent-badge-cursor" },
  generic: { label: "G", className: "agent-badge-generic" },
  hermes: { label: "H", className: "agent-badge-hermes" },
  openclaw: { label: "O", className: "agent-badge-openclaw" },
  opencode: { label: "O", className: "agent-badge-opencode" },
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
            {descriptor.label}
          </span>
        );
      })}
    </span>
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
