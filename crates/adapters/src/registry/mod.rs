use crate::claude_code::ClaudeCodeAdapter;
use crate::codex::CodexAdapter;
use crate::cursor::CursorAdapter;
use crate::gemini_cli::GeminiCliAdapter;
use crate::generic::GenericAgentSkillsAdapter;
use crate::hermes::HermesAdapter;
use crate::openclaw::OpenClawAdapter;
use crate::opencode::OpencodeAdapter;
use crate::qoder::QoderAdapter;
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

    /// 跨 Agent 同步只面向内置明确支持安装根的 Agent，不包含 Generic 自定义目录。
    pub fn sync_target_adapters(&self) -> Vec<&dyn AgentAdapter> {
        self.adapters
            .iter()
            .filter(|adapter| adapter.agent_id() != "generic")
            .map(|adapter| adapter.as_ref())
            .collect()
    }

    /// 构建内置 adapter 注册表
    pub fn with_builtin_adapters() -> Self {
        let mut registry = Self::new();
        registry.register(Box::new(CodexAdapter::new()));
        registry.register(Box::new(ClaudeCodeAdapter::new()));
        registry.register(Box::new(OpenClawAdapter::new()));
        registry.register(Box::new(HermesAdapter::new()));
        registry.register(Box::new(OpencodeAdapter::new()));
        registry.register(Box::new(CursorAdapter::new()));
        registry.register(Box::new(QoderAdapter::new()));
        registry.register(Box::new(GeminiCliAdapter::new()));
        registry.register(Box::new(GenericAgentSkillsAdapter::new(vec![])));
        registry
    }
}

impl Default for AdapterRegistry {
    fn default() -> Self {
        Self::with_builtin_adapters()
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
                "cursor",
                "qoder",
                "gemini-cli",
                "generic"
            ]
        );
    }

    #[test]
    fn sync_target_adapters_exclude_generic_custom_paths() {
        let registry = AdapterRegistry::default();
        let agent_ids = registry
            .sync_target_adapters()
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
                "cursor",
                "qoder",
                "gemini-cli"
            ]
        );
    }
}
