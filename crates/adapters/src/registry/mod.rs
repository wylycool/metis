use crate::claude_code::ClaudeCodeAdapter;
use crate::codex::CodexAdapter;
use crate::generic::GenericAgentSkillsAdapter;
use crate::hermes::HermesAdapter;
use crate::openclaw::OpenClawAdapter;
use crate::opencode::OpencodeAdapter;
use crate::traits::AgentAdapter;

/// 管理所有已注册的 Adapter
pub struct AdapterRegistry {
    adapters: Vec<Box<dyn AgentAdapter>>,
}

impl AdapterRegistry {
    pub fn new() -> Self {
        Self { adapters: vec![] }
    }

    /// 注册一个 adapter
    pub fn register(&mut self, adapter: Box<dyn AgentAdapter>) {
        self.adapters.push(adapter);
    }

    /// 获取所有 adapter
    pub fn all(&self) -> &[Box<dyn AgentAdapter>] {
        &self.adapters
    }

    /// 按 agent_id 查找
    pub fn get(&self, agent_id: &str) -> Option<&dyn AgentAdapter> {
        self.adapters
            .iter()
            .find(|a| a.agent_id() == agent_id)
            .map(|a| a.as_ref())
    }

    /// 获取已启用的 adapter 列表（按 enabled_agents 过滤）
    pub fn enabled(&self, enabled_agents: &[String]) -> Vec<&dyn AgentAdapter> {
        self.adapters
            .iter()
            .filter(|a| enabled_agents.contains(&a.agent_id().to_string()))
            .map(|a| a.as_ref())
            .collect()
    }

    /// 构建默认注册表（内置 adapter）
    pub fn default() -> Self {
        let mut registry = Self::new();
        registry.register(Box::new(CodexAdapter::new()));
        registry.register(Box::new(ClaudeCodeAdapter::new()));
        registry.register(Box::new(OpenClawAdapter::new()));
        registry.register(Box::new(HermesAdapter::new()));
        registry.register(Box::new(OpencodeAdapter::new()));
        registry.register(Box::new(GenericAgentSkillsAdapter::new(vec![])));
        registry
    }
}

impl Default for AdapterRegistry {
    fn default() -> Self {
        Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_registry_contains_all_mvp_adapters() {
        let registry = AdapterRegistry::default();
        let agent_ids = registry
            .all()
            .iter()
            .map(|adapter| adapter.agent_id())
            .collect::<Vec<_>>();

        assert_eq!(
            agent_ids,
            vec![
                "codex",
                "claude-code",
                "openclaw",
                "hermes",
                "opencode",
                "generic"
            ]
        );
    }
}
