use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

const INITIAL_SCHEMA_VERSION: i64 = 1;
const INITIAL_SCHEMA_NAME: &str = "initial_schema";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillRecord {
    pub id: String,
    pub agent_id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub tags: Vec<String>,
    pub category: Option<String>,
    pub install_path: String,
    pub scope: String,
    pub metadata_path: Option<String>,
    pub metadata_status: String,
    pub metadata_error: Option<String>,
    pub source_id: Option<String>,
    pub local_fingerprint: Option<String>,
    pub local_modified: Option<bool>,
    pub last_scanned_at: String,
}

pub struct SkillIndexStore {
    connection: Connection,
}

impl SkillIndexStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StorageError> {
        let connection = Connection::open(path)?;
        Self::from_connection(connection)
    }

    pub fn open_in_memory() -> Result<Self, StorageError> {
        let connection = Connection::open_in_memory()?;
        Self::from_connection(connection)
    }

    fn from_connection(connection: Connection) -> Result<Self, StorageError> {
        let store = Self { connection };
        store.configure()?;
        store.apply_migrations()?;
        Ok(store)
    }

    pub fn upsert_skill(&self, skill: &SkillRecord) -> Result<(), StorageError> {
        let tags = serde_json::to_string(&skill.tags)?;
        let local_modified = skill.local_modified.map(i64::from);

        self.connection.execute(
            "
            INSERT INTO skills (
                id,
                agent_id,
                name,
                description,
                version,
                author,
                license,
                tags,
                category,
                install_path,
                scope,
                metadata_path,
                metadata_status,
                metadata_error,
                source_id,
                local_fingerprint,
                local_modified,
                last_scanned_at,
                updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
                datetime('now')
            )
            ON CONFLICT(agent_id, install_path) DO UPDATE SET
                id = excluded.id,
                name = excluded.name,
                description = excluded.description,
                version = excluded.version,
                author = excluded.author,
                license = excluded.license,
                tags = excluded.tags,
                category = excluded.category,
                scope = excluded.scope,
                metadata_path = excluded.metadata_path,
                metadata_status = excluded.metadata_status,
                metadata_error = excluded.metadata_error,
                source_id = excluded.source_id,
                local_fingerprint = excluded.local_fingerprint,
                local_modified = excluded.local_modified,
                last_scanned_at = excluded.last_scanned_at,
                updated_at = datetime('now')
            ",
            params![
                skill.id,
                skill.agent_id,
                skill.name,
                skill.description,
                skill.version,
                skill.author,
                skill.license,
                tags,
                skill.category,
                skill.install_path,
                skill.scope,
                skill.metadata_path,
                skill.metadata_status,
                skill.metadata_error,
                skill.source_id,
                skill.local_fingerprint,
                local_modified,
                skill.last_scanned_at,
            ],
        )?;

        Ok(())
    }

    pub fn list_skills(&self) -> Result<Vec<SkillRecord>, StorageError> {
        let mut statement = self.connection.prepare(
            "
            SELECT
                id,
                agent_id,
                name,
                description,
                version,
                author,
                license,
                tags,
                category,
                install_path,
                scope,
                metadata_path,
                metadata_status,
                metadata_error,
                source_id,
                local_fingerprint,
                local_modified,
                last_scanned_at
            FROM skills
            ORDER BY agent_id, install_path
            ",
        )?;

        let records = statement
            .query_map([], row_to_skill_record)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(records)
    }

    pub fn get_skill_by_agent_and_path(
        &self,
        agent_id: &str,
        install_path: &str,
    ) -> Result<Option<SkillRecord>, StorageError> {
        self.connection
            .query_row(
                "
                SELECT
                    id,
                    agent_id,
                    name,
                    description,
                    version,
                    author,
                    license,
                    tags,
                    category,
                    install_path,
                    scope,
                    metadata_path,
                    metadata_status,
                    metadata_error,
                    source_id,
                    local_fingerprint,
                    local_modified,
                    last_scanned_at
                FROM skills
                WHERE agent_id = ?1 AND install_path = ?2
                ",
                params![agent_id, install_path],
                row_to_skill_record,
            )
            .optional()
            .map_err(StorageError::from)
    }

    pub fn applied_migration_versions(&self) -> Result<Vec<i64>, StorageError> {
        let mut statement = self
            .connection
            .prepare("SELECT version FROM _migrations ORDER BY version")?;
        let versions = statement
            .query_map([], |row| row.get::<_, i64>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(versions)
    }

    fn configure(&self) -> Result<(), StorageError> {
        self.connection.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            ",
        )?;
        Ok(())
    }

    fn apply_migrations(&self) -> Result<(), StorageError> {
        self.connection.execute_batch(INITIAL_SCHEMA_SQL)?;
        self.connection.execute(
            "
            INSERT OR IGNORE INTO _migrations (version, name)
            VALUES (?1, ?2)
            ",
            params![INITIAL_SCHEMA_VERSION, INITIAL_SCHEMA_NAME],
        )?;
        Ok(())
    }
}

fn row_to_skill_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<SkillRecord> {
    let tags_json: String = row.get(7)?;
    let tags = serde_json::from_str::<Vec<String>>(&tags_json).unwrap_or_default();
    let local_modified = row.get::<_, Option<i64>>(16)?.map(|value| value != 0);

    Ok(SkillRecord {
        id: row.get(0)?,
        agent_id: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        version: row.get(4)?,
        author: row.get(5)?,
        license: row.get(6)?,
        tags,
        category: row.get(8)?,
        install_path: row.get(9)?,
        scope: row.get(10)?,
        metadata_path: row.get(11)?,
        metadata_status: row.get(12)?,
        metadata_error: row.get(13)?,
        source_id: row.get(14)?,
        local_fingerprint: row.get(15)?,
        local_modified,
        last_scanned_at: row.get(17)?,
    })
}

const INITIAL_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS _migrations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    version     INTEGER NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
    id                  TEXT PRIMARY KEY,
    source_type         TEXT NOT NULL DEFAULT 'git',
    url                 TEXT NOT NULL,
    repo_path           TEXT NOT NULL DEFAULT '',
    ref_                TEXT NOT NULL DEFAULT 'main',
    current_commit      TEXT,
    remote_commit       TEXT,
    last_checked_at     TEXT,
    trusted             INTEGER NOT NULL DEFAULT 0,
    auto_update         INTEGER NOT NULL DEFAULT 0,
    credential_ref      TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS skills (
    id                  TEXT PRIMARY KEY,
    agent_id            TEXT NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT,
    version             TEXT,
    author              TEXT,
    license             TEXT,
    tags                TEXT NOT NULL DEFAULT '[]',
    category            TEXT,
    install_path        TEXT NOT NULL,
    scope               TEXT NOT NULL,
    metadata_path       TEXT,
    metadata_status     TEXT NOT NULL DEFAULT 'found',
    metadata_error      TEXT,
    source_id           TEXT,
    local_fingerprint   TEXT,
    local_modified      INTEGER,
    last_scanned_at     TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_skills_agent_id ON skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
CREATE INDEX IF NOT EXISTS idx_skills_source_id ON skills(source_id);
CREATE INDEX IF NOT EXISTS idx_skills_install_path ON skills(install_path);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skills_agent_install_path
    ON skills(agent_id, install_path);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sources_url_path_ref
    ON sources(url, repo_path, ref_);
"#;

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_skill(id: &str, name: &str, description: Option<&str>) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            agent_id: "codex".to_string(),
            name: name.to_string(),
            description: description.map(ToOwned::to_owned),
            version: Some("1.0.0".to_string()),
            author: Some("Metis Team".to_string()),
            license: Some("MIT".to_string()),
            tags: vec!["workflow".to_string(), "local".to_string()],
            category: Some("workflow".to_string()),
            install_path: "/tmp/metis/skills/example".to_string(),
            scope: "user".to_string(),
            metadata_path: Some("/tmp/metis/skills/example/SKILL.md".to_string()),
            metadata_status: "found".to_string(),
            metadata_error: None,
            source_id: None,
            local_fingerprint: None,
            local_modified: None,
            last_scanned_at: "2026-06-19T10:00:00Z".to_string(),
        }
    }

    #[test]
    fn open_in_memory_applies_initial_schema_migration() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");

        let versions = store
            .applied_migration_versions()
            .expect("migration versions should be queryable");

        assert_eq!(versions, vec![1]);
    }

    #[test]
    fn upsert_and_get_skill_by_agent_and_install_path() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let skill = sample_skill("skill-1", "Example Skill", Some("First description"));

        store.upsert_skill(&skill).expect("skill should upsert");

        let stored = store
            .get_skill_by_agent_and_path("codex", "/tmp/metis/skills/example")
            .expect("skill lookup should succeed")
            .expect("skill should exist");

        assert_eq!(stored, skill);
    }

    #[test]
    fn upsert_replaces_existing_skill_for_same_agent_and_install_path() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let first = sample_skill("skill-1", "Example Skill", Some("First description"));
        let updated = sample_skill("skill-2", "Renamed Skill", Some("Updated description"));

        store
            .upsert_skill(&first)
            .expect("first skill should upsert");
        store
            .upsert_skill(&updated)
            .expect("updated skill should upsert");

        let skills = store.list_skills().expect("skills should list");

        assert_eq!(skills, vec![updated]);
    }
}
