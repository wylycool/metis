use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamPolicy {
    pub version: String,
    #[serde(default)]
    pub trusted_sources: Vec<TrustedSourcePolicy>,
    #[serde(default)]
    pub update_policy: UpdatePolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrustedSourcePolicy {
    pub url: String,
    #[serde(default)]
    pub repo_path: Option<String>,
    #[serde(default, rename = "ref")]
    pub ref_: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdatePolicy {
    #[serde(default = "default_allow_auto_update")]
    pub allow_auto_update: bool,
    #[serde(default = "default_require_trusted_source")]
    pub require_trusted_source: bool,
}

impl Default for UpdatePolicy {
    fn default() -> Self {
        Self {
            allow_auto_update: true,
            require_trusted_source: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourcePolicyEvaluation {
    pub trusted: bool,
    pub auto_update_allowed: bool,
    pub matched_source_url: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("policy parse error: {0}")]
    Parse(#[from] serde_json::Error),
}

pub fn parse_team_policy_from_str(contents: &str) -> Result<TeamPolicy, ConfigError> {
    serde_json::from_str(contents).map_err(ConfigError::from)
}

pub fn evaluate_source_policy(
    policy: &TeamPolicy,
    url: &str,
    repo_path: &str,
    ref_: &str,
) -> SourcePolicyEvaluation {
    let matched_source = policy
        .trusted_sources
        .iter()
        .find(|source| trusted_source_matches(source, url, repo_path, ref_));
    let trusted = matched_source.is_some();
    let auto_update_allowed = policy.update_policy.allow_auto_update
        && (!policy.update_policy.require_trusted_source || trusted);

    SourcePolicyEvaluation {
        trusted,
        auto_update_allowed,
        matched_source_url: matched_source.map(|source| source.url.clone()),
    }
}

fn trusted_source_matches(
    source: &TrustedSourcePolicy,
    url: &str,
    repo_path: &str,
    ref_: &str,
) -> bool {
    source.url == url
        && optional_match(source.repo_path.as_deref(), repo_path)
        && optional_match(source.ref_.as_deref(), ref_)
}

fn optional_match(expected: Option<&str>, actual: &str) -> bool {
    match expected.map(str::trim) {
        Some(value) if !value.is_empty() => value == actual,
        _ => true,
    }
}

fn default_allow_auto_update() -> bool {
    true
}

fn default_require_trusted_source() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn team_policy_matches_trusted_sources_with_optional_path_and_ref() {
        let policy = parse_team_policy_from_str(
            r#"{
                "version": "1",
                "trusted_sources": [
                    {
                        "url": "https://github.com/example/team-skills.git",
                        "repo_path": "skills/team",
                        "ref": "main"
                    },
                    {
                        "url": "ssh://git.example.com/platform/skills.git"
                    }
                ],
                "update_policy": {
                    "allow_auto_update": true,
                    "require_trusted_source": true
                }
            }"#,
        )
        .expect("policy should parse");

        let exact = evaluate_source_policy(
            &policy,
            "https://github.com/example/team-skills.git",
            "skills/team",
            "main",
        );
        let wildcard = evaluate_source_policy(
            &policy,
            "ssh://git.example.com/platform/skills.git",
            "any/path",
            "feature",
        );
        let untrusted = evaluate_source_policy(
            &policy,
            "https://github.com/example/personal.git",
            "skills/team",
            "main",
        );

        assert_eq!(policy.version, "1");
        assert_eq!(policy.trusted_sources.len(), 2);
        assert!(exact.trusted);
        assert!(exact.auto_update_allowed);
        assert!(wildcard.trusted);
        assert!(wildcard.auto_update_allowed);
        assert!(!untrusted.trusted);
        assert!(!untrusted.auto_update_allowed);
    }

    #[test]
    fn team_policy_can_disable_all_auto_updates() {
        let policy = parse_team_policy_from_str(
            r#"{
                "version": "1",
                "trusted_sources": [
                    {"url": "file:///tmp/team-skills"}
                ],
                "update_policy": {
                    "allow_auto_update": false,
                    "require_trusted_source": true
                }
            }"#,
        )
        .expect("policy should parse");

        let evaluation =
            evaluate_source_policy(&policy, "file:///tmp/team-skills", "skills/one", "main");

        assert!(evaluation.trusted);
        assert!(!evaluation.auto_update_allowed);
    }
}
