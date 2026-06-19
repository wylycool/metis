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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceRecord {
    pub id: String,
    pub source_type: String,
    pub url: String,
    pub repo_path: String,
    pub ref_: String,
    pub current_commit: Option<String>,
    pub remote_commit: Option<String>,
    pub last_checked_at: Option<String>,
    pub trusted: bool,
    pub auto_update: bool,
    pub credential_ref: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileManifestRecord {
    pub id: String,
    pub skill_id: String,
    pub snapshot_type: String,
    pub snapshot_ref: String,
    pub relative_path: String,
    pub file_size: u64,
    pub modified_at: String,
    pub content_hash: String,
    pub is_executable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupRecord {
    pub id: String,
    pub skill_id: String,
    pub source_commit: Option<String>,
    pub backup_path: String,
    pub file_count: u64,
    pub total_size_bytes: u64,
    pub reason: String,
    pub restore_status: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditEventRecord {
    pub id: String,
    pub skill_id: String,
    pub action: String,
    pub detail: Option<String>,
    pub commit_before: Option<String>,
    pub commit_after: Option<String>,
    pub status: String,
    pub risk_summary: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuditEventFilter {
    pub skill_id: Option<String>,
    pub action: Option<String>,
    pub limit: u32,
    pub offset: u32,
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
                source_id = COALESCE(excluded.source_id, source_id),
                local_fingerprint = COALESCE(excluded.local_fingerprint, local_fingerprint),
                local_modified = COALESCE(excluded.local_modified, local_modified),
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

    pub fn get_skill(&self, skill_id: &str) -> Result<Option<SkillRecord>, StorageError> {
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
                WHERE id = ?1
                ",
                params![skill_id],
                row_to_skill_record,
            )
            .optional()
            .map_err(StorageError::from)
    }

    pub fn upsert_source(&self, source: &SourceRecord) -> Result<(), StorageError> {
        self.connection.execute(
            "
            INSERT INTO sources (
                id,
                source_type,
                url,
                repo_path,
                ref_,
                current_commit,
                remote_commit,
                last_checked_at,
                trusted,
                auto_update,
                credential_ref,
                updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                datetime('now')
            )
            ON CONFLICT(url, repo_path, ref_) DO UPDATE SET
                current_commit = excluded.current_commit,
                remote_commit = excluded.remote_commit,
                last_checked_at = excluded.last_checked_at,
                trusted = excluded.trusted,
                auto_update = excluded.auto_update,
                credential_ref = excluded.credential_ref,
                updated_at = datetime('now')
            ",
            params![
                source.id,
                source.source_type,
                source.url,
                source.repo_path,
                source.ref_,
                source.current_commit,
                source.remote_commit,
                source.last_checked_at,
                i64::from(source.trusted),
                i64::from(source.auto_update),
                source.credential_ref,
            ],
        )?;

        Ok(())
    }

    pub fn get_source(&self, source_id: &str) -> Result<Option<SourceRecord>, StorageError> {
        self.connection
            .query_row(
                "
                SELECT
                    id,
                    source_type,
                    url,
                    repo_path,
                    ref_,
                    current_commit,
                    remote_commit,
                    last_checked_at,
                    trusted,
                    auto_update,
                    credential_ref,
                    created_at,
                    updated_at
                FROM sources
                WHERE id = ?1
                ",
                params![source_id],
                row_to_source_record,
            )
            .optional()
            .map_err(StorageError::from)
    }

    pub fn list_sources(&self) -> Result<Vec<SourceRecord>, StorageError> {
        let mut statement = self.connection.prepare(
            "
            SELECT
                id,
                source_type,
                url,
                repo_path,
                ref_,
                current_commit,
                remote_commit,
                last_checked_at,
                trusted,
                auto_update,
                credential_ref,
                created_at,
                updated_at
            FROM sources
            ORDER BY url, repo_path, ref_
            ",
        )?;

        let records = statement
            .query_map([], row_to_source_record)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(records)
    }

    pub fn bind_skill_source(&self, skill_id: &str, source_id: &str) -> Result<(), StorageError> {
        self.connection.execute(
            "
            UPDATE skills
            SET source_id = ?1,
                updated_at = datetime('now')
            WHERE id = ?2
            ",
            params![source_id, skill_id],
        )?;
        Ok(())
    }

    pub fn unbind_skill_source(&self, skill_id: &str) -> Result<(), StorageError> {
        self.connection.execute(
            "
            UPDATE skills
            SET source_id = NULL,
                updated_at = datetime('now')
            WHERE id = ?1
            ",
            params![skill_id],
        )?;
        Ok(())
    }

    pub fn replace_file_manifest(
        &mut self,
        skill_id: &str,
        snapshot_type: &str,
        snapshot_ref: &str,
        entries: &[FileManifestRecord],
    ) -> Result<(), StorageError> {
        let transaction = self.connection.transaction()?;

        transaction.execute(
            "
            DELETE FROM file_manifests
            WHERE skill_id = ?1 AND snapshot_type = ?2 AND snapshot_ref = ?3
            ",
            params![skill_id, snapshot_type, snapshot_ref],
        )?;

        for entry in entries {
            transaction.execute(
                "
                INSERT INTO file_manifests (
                    id,
                    skill_id,
                    snapshot_type,
                    snapshot_ref,
                    relative_path,
                    file_size,
                    modified_at,
                    content_hash,
                    is_executable
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
                )
                ",
                params![
                    entry.id,
                    entry.skill_id,
                    entry.snapshot_type,
                    entry.snapshot_ref,
                    entry.relative_path,
                    entry.file_size as i64,
                    entry.modified_at,
                    entry.content_hash,
                    i64::from(entry.is_executable),
                ],
            )?;
        }

        transaction.commit()?;
        Ok(())
    }

    pub fn list_file_manifest(
        &self,
        skill_id: &str,
        snapshot_type: &str,
        snapshot_ref: &str,
    ) -> Result<Vec<FileManifestRecord>, StorageError> {
        let mut statement = self.connection.prepare(
            "
            SELECT
                id,
                skill_id,
                snapshot_type,
                snapshot_ref,
                relative_path,
                file_size,
                modified_at,
                content_hash,
                is_executable
            FROM file_manifests
            WHERE skill_id = ?1 AND snapshot_type = ?2 AND snapshot_ref = ?3
            ORDER BY relative_path
            ",
        )?;

        let records = statement
            .query_map(params![skill_id, snapshot_type, snapshot_ref], |row| {
                row_to_file_manifest_record(row)
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(records)
    }

    pub fn update_skill_local_fingerprint(
        &self,
        skill_id: &str,
        local_fingerprint: &str,
        local_modified: bool,
    ) -> Result<(), StorageError> {
        self.connection.execute(
            "
            UPDATE skills
            SET local_fingerprint = ?1,
                local_modified = ?2,
                updated_at = datetime('now')
            WHERE id = ?3
            ",
            params![local_fingerprint, i64::from(local_modified), skill_id],
        )?;
        Ok(())
    }

    pub fn update_skill_local_modified(
        &self,
        skill_id: &str,
        local_modified: bool,
    ) -> Result<(), StorageError> {
        self.connection.execute(
            "
            UPDATE skills
            SET local_modified = ?1,
                updated_at = datetime('now')
            WHERE id = ?2
            ",
            params![i64::from(local_modified), skill_id],
        )?;
        Ok(())
    }

    pub fn update_source_check_result(
        &self,
        source_id: &str,
        current_commit: Option<&str>,
        remote_commit: Option<&str>,
        last_checked_at: &str,
    ) -> Result<(), StorageError> {
        self.connection.execute(
            "
            UPDATE sources
            SET current_commit = ?1,
                remote_commit = ?2,
                last_checked_at = ?3,
                updated_at = datetime('now')
            WHERE id = ?4
            ",
            params![current_commit, remote_commit, last_checked_at, source_id],
        )?;
        Ok(())
    }

    pub fn insert_backup(&self, backup: &BackupRecord) -> Result<(), StorageError> {
        self.connection.execute(
            "
            INSERT INTO backups (
                id,
                skill_id,
                source_commit,
                backup_path,
                file_count,
                total_size_bytes,
                reason,
                restore_status,
                created_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, COALESCE(?9, datetime('now'))
            )
            ",
            params![
                backup.id,
                backup.skill_id,
                backup.source_commit,
                backup.backup_path,
                backup.file_count as i64,
                backup.total_size_bytes as i64,
                backup.reason,
                backup.restore_status,
                backup.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_backup(&self, backup_id: &str) -> Result<Option<BackupRecord>, StorageError> {
        self.connection
            .query_row(
                "
                SELECT
                    id,
                    skill_id,
                    source_commit,
                    backup_path,
                    file_count,
                    total_size_bytes,
                    reason,
                    restore_status,
                    created_at
                FROM backups
                WHERE id = ?1
                ",
                params![backup_id],
                row_to_backup_record,
            )
            .optional()
            .map_err(StorageError::from)
    }

    pub fn list_backups(&self, skill_id: &str) -> Result<Vec<BackupRecord>, StorageError> {
        let mut statement = self.connection.prepare(
            "
            SELECT
                id,
                skill_id,
                source_commit,
                backup_path,
                file_count,
                total_size_bytes,
                reason,
                restore_status,
                created_at
            FROM backups
            WHERE skill_id = ?1
            ORDER BY created_at DESC, id DESC
            ",
        )?;

        let records = statement
            .query_map(params![skill_id], row_to_backup_record)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(records)
    }

    pub fn mark_backup_restored(
        &self,
        backup_id: &str,
        restore_status: &str,
    ) -> Result<(), StorageError> {
        self.connection.execute(
            "
            UPDATE backups
            SET restore_status = ?1
            WHERE id = ?2
            ",
            params![restore_status, backup_id],
        )?;
        Ok(())
    }

    pub fn delete_backup(&self, backup_id: &str) -> Result<(), StorageError> {
        self.connection.execute(
            "
            DELETE FROM backups
            WHERE id = ?1
            ",
            params![backup_id],
        )?;
        Ok(())
    }

    pub fn insert_audit_event(&self, event: &AuditEventRecord) -> Result<(), StorageError> {
        self.connection.execute(
            "
            INSERT INTO audit_events (
                id,
                skill_id,
                action,
                detail,
                commit_before,
                commit_after,
                status,
                risk_summary,
                created_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, COALESCE(?9, datetime('now'))
            )
            ",
            params![
                event.id,
                event.skill_id,
                event.action,
                event.detail,
                event.commit_before,
                event.commit_after,
                event.status,
                event.risk_summary,
                event.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_audit_events(
        &self,
        filter: &AuditEventFilter,
    ) -> Result<Vec<AuditEventRecord>, StorageError> {
        let mut statement = self.connection.prepare(
            "
            SELECT
                id,
                skill_id,
                action,
                detail,
                commit_before,
                commit_after,
                status,
                risk_summary,
                created_at
            FROM audit_events
            WHERE (?1 IS NULL OR skill_id = ?1)
              AND (?2 IS NULL OR action = ?2)
            ORDER BY created_at DESC, id DESC
            LIMIT ?3 OFFSET ?4
            ",
        )?;

        let records = statement
            .query_map(
                params![
                    filter.skill_id,
                    filter.action,
                    i64::from(filter.limit),
                    i64::from(filter.offset),
                ],
                row_to_audit_event_record,
            )?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(records)
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

fn row_to_source_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<SourceRecord> {
    Ok(SourceRecord {
        id: row.get(0)?,
        source_type: row.get(1)?,
        url: row.get(2)?,
        repo_path: row.get(3)?,
        ref_: row.get(4)?,
        current_commit: row.get(5)?,
        remote_commit: row.get(6)?,
        last_checked_at: row.get(7)?,
        trusted: row.get::<_, i64>(8)? != 0,
        auto_update: row.get::<_, i64>(9)? != 0,
        credential_ref: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

fn row_to_file_manifest_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileManifestRecord> {
    Ok(FileManifestRecord {
        id: row.get(0)?,
        skill_id: row.get(1)?,
        snapshot_type: row.get(2)?,
        snapshot_ref: row.get(3)?,
        relative_path: row.get(4)?,
        file_size: row.get::<_, i64>(5)? as u64,
        modified_at: row.get(6)?,
        content_hash: row.get(7)?,
        is_executable: row.get::<_, i64>(8)? != 0,
    })
}

fn row_to_backup_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<BackupRecord> {
    Ok(BackupRecord {
        id: row.get(0)?,
        skill_id: row.get(1)?,
        source_commit: row.get(2)?,
        backup_path: row.get(3)?,
        file_count: row.get::<_, i64>(4)? as u64,
        total_size_bytes: row.get::<_, i64>(5)? as u64,
        reason: row.get(6)?,
        restore_status: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn row_to_audit_event_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuditEventRecord> {
    Ok(AuditEventRecord {
        id: row.get(0)?,
        skill_id: row.get(1)?,
        action: row.get(2)?,
        detail: row.get(3)?,
        commit_before: row.get(4)?,
        commit_after: row.get(5)?,
        status: row.get(6)?,
        risk_summary: row.get(7)?,
        created_at: row.get(8)?,
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

CREATE TABLE IF NOT EXISTS backups (
    id                  TEXT PRIMARY KEY,
    skill_id            TEXT NOT NULL,
    source_commit       TEXT,
    backup_path         TEXT NOT NULL,
    file_count          INTEGER NOT NULL DEFAULT 0,
    total_size_bytes    INTEGER NOT NULL DEFAULT 0,
    reason              TEXT NOT NULL DEFAULT 'manual',
    restore_status      TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_backups_skill_id ON backups(skill_id);
CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups(created_at);

CREATE TABLE IF NOT EXISTS file_manifests (
    id                  TEXT PRIMARY KEY,
    skill_id            TEXT NOT NULL,
    snapshot_type       TEXT NOT NULL,
    snapshot_ref        TEXT NOT NULL,
    relative_path       TEXT NOT NULL,
    file_size           INTEGER NOT NULL,
    modified_at         TEXT NOT NULL,
    content_hash        TEXT NOT NULL,
    is_executable       INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_manifests_skill_snapshot
    ON file_manifests(skill_id, snapshot_type, snapshot_ref);
CREATE INDEX IF NOT EXISTS idx_file_manifests_path
    ON file_manifests(skill_id, relative_path);

CREATE TABLE IF NOT EXISTS audit_events (
    id                  TEXT PRIMARY KEY,
    skill_id            TEXT NOT NULL,
    action              TEXT NOT NULL,
    detail              TEXT,
    commit_before       TEXT,
    commit_after        TEXT,
    status              TEXT NOT NULL,
    risk_summary        TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_events_skill_id ON audit_events(skill_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
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

    fn sample_source(id: &str, trusted: bool, auto_update: bool) -> SourceRecord {
        SourceRecord {
            id: id.to_string(),
            source_type: "git".to_string(),
            url: "https://github.com/example/metis-skills.git".to_string(),
            repo_path: "skills/example".to_string(),
            ref_: "main".to_string(),
            current_commit: Some("abc123".to_string()),
            remote_commit: Some("def456".to_string()),
            last_checked_at: Some("2026-06-19T11:00:00Z".to_string()),
            trusted,
            auto_update,
            credential_ref: Some("github-main".to_string()),
            created_at: None,
            updated_at: None,
        }
    }

    fn sample_manifest(
        id: &str,
        skill_id: &str,
        snapshot_type: &str,
        snapshot_ref: &str,
        relative_path: &str,
        content_hash: &str,
    ) -> FileManifestRecord {
        FileManifestRecord {
            id: id.to_string(),
            skill_id: skill_id.to_string(),
            snapshot_type: snapshot_type.to_string(),
            snapshot_ref: snapshot_ref.to_string(),
            relative_path: relative_path.to_string(),
            file_size: 12,
            modified_at: "2026-06-19T10:00:00Z".to_string(),
            content_hash: content_hash.to_string(),
            is_executable: false,
        }
    }

    fn sample_backup(id: &str, skill_id: &str, reason: &str) -> BackupRecord {
        BackupRecord {
            id: id.to_string(),
            skill_id: skill_id.to_string(),
            source_commit: Some("abc123".to_string()),
            backup_path: format!("/tmp/metis/backups/{skill_id}/{id}"),
            file_count: 2,
            total_size_bytes: 42,
            reason: reason.to_string(),
            restore_status: None,
            created_at: Some("2026-06-19T12:00:00Z".to_string()),
        }
    }

    fn sample_audit(id: &str, skill_id: &str, action: &str, status: &str) -> AuditEventRecord {
        AuditEventRecord {
            id: id.to_string(),
            skill_id: skill_id.to_string(),
            action: action.to_string(),
            detail: Some(format!("{action} detail")),
            commit_before: Some("abc123".to_string()),
            commit_after: Some("def456".to_string()),
            status: status.to_string(),
            risk_summary: Some(r#"{"high":0}"#.to_string()),
            created_at: Some("2026-06-19T12:00:00Z".to_string()),
        }
    }

    fn assert_source_business_fields_eq(actual: &SourceRecord, expected: &SourceRecord) {
        assert_eq!(actual.id, expected.id);
        assert_eq!(actual.source_type, expected.source_type);
        assert_eq!(actual.url, expected.url);
        assert_eq!(actual.repo_path, expected.repo_path);
        assert_eq!(actual.ref_, expected.ref_);
        assert_eq!(actual.current_commit, expected.current_commit);
        assert_eq!(actual.remote_commit, expected.remote_commit);
        assert_eq!(actual.last_checked_at, expected.last_checked_at);
        assert_eq!(actual.trusted, expected.trusted);
        assert_eq!(actual.auto_update, expected.auto_update);
        assert_eq!(actual.credential_ref, expected.credential_ref);
        assert!(actual.created_at.is_some());
        assert!(actual.updated_at.is_some());
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

    #[test]
    fn upsert_and_get_source_by_id() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let source = sample_source("source-1", true, false);

        store.upsert_source(&source).expect("source should upsert");

        let stored = store
            .get_source("source-1")
            .expect("source lookup should succeed")
            .expect("source should exist");

        assert_source_business_fields_eq(&stored, &source);
    }

    #[test]
    fn upsert_replaces_existing_source_for_same_url_path_and_ref() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let first = sample_source("source-1", false, false);
        let mut updated = sample_source("source-2", true, true);
        updated.credential_ref = Some("github-updated".to_string());
        let mut expected = updated.clone();
        expected.id = "source-1".to_string();

        store
            .upsert_source(&first)
            .expect("first source should upsert");
        store
            .upsert_source(&updated)
            .expect("updated source should upsert");

        let sources = store.list_sources().expect("sources should list");

        assert_eq!(sources.len(), 1);
        assert_source_business_fields_eq(&sources[0], &expected);
    }

    #[test]
    fn bind_and_unbind_skill_source_updates_skill_record() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let skill = sample_skill("skill-1", "Example Skill", Some("First description"));
        let source = sample_source("source-1", true, false);
        store.upsert_skill(&skill).expect("skill should upsert");
        store.upsert_source(&source).expect("source should upsert");

        store
            .bind_skill_source("skill-1", "source-1")
            .expect("skill source should bind");

        let bound = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        assert_eq!(bound.source_id.as_deref(), Some("source-1"));

        store
            .unbind_skill_source("skill-1")
            .expect("skill source should unbind");

        let unbound = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        assert_eq!(unbound.source_id, None);
    }

    #[test]
    fn upsert_source_preserves_existing_id_when_bound_skill_references_it() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let skill = sample_skill("skill-1", "Example Skill", Some("First description"));
        let source = sample_source("source-1", false, false);
        let updated = sample_source("source-2", true, true);
        store.upsert_skill(&skill).expect("skill should upsert");
        store.upsert_source(&source).expect("source should upsert");
        store
            .bind_skill_source("skill-1", "source-1")
            .expect("skill source should bind");

        store
            .upsert_source(&updated)
            .expect("source should update without changing its primary key");

        let bound = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");
        let sources = store.list_sources().expect("sources should list");

        assert_eq!(bound.source_id.as_deref(), Some("source-1"));
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].id, "source-1");
        assert!(sources[0].trusted);
        assert!(sources[0].auto_update);
    }

    #[test]
    fn replace_and_list_file_manifest_for_snapshot() {
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        let skill = sample_skill("skill-1", "Example Skill", Some("First description"));
        store.upsert_skill(&skill).expect("skill should upsert");
        let entries = vec![
            sample_manifest(
                "entry-1",
                "skill-1",
                "baseline",
                "fingerprint-1",
                "SKILL.md",
                "hash-1",
            ),
            sample_manifest(
                "entry-2",
                "skill-1",
                "baseline",
                "fingerprint-1",
                "src/main.rs",
                "hash-2",
            ),
        ];

        store
            .replace_file_manifest("skill-1", "baseline", "fingerprint-1", &entries)
            .expect("manifest should replace");

        let stored = store
            .list_file_manifest("skill-1", "baseline", "fingerprint-1")
            .expect("manifest should list");

        assert_eq!(stored, entries);
    }

    #[test]
    fn replace_file_manifest_removes_old_entries_for_same_snapshot() {
        let mut store = SkillIndexStore::open_in_memory().expect("store should open");
        let skill = sample_skill("skill-1", "Example Skill", Some("First description"));
        store.upsert_skill(&skill).expect("skill should upsert");
        let first = vec![
            sample_manifest(
                "entry-1",
                "skill-1",
                "baseline",
                "fingerprint-1",
                "a.txt",
                "hash-a",
            ),
            sample_manifest(
                "entry-2",
                "skill-1",
                "baseline",
                "fingerprint-1",
                "b.txt",
                "hash-b",
            ),
        ];
        let second = vec![sample_manifest(
            "entry-3",
            "skill-1",
            "baseline",
            "fingerprint-1",
            "c.txt",
            "hash-c",
        )];

        store
            .replace_file_manifest("skill-1", "baseline", "fingerprint-1", &first)
            .expect("first manifest should replace");
        store
            .replace_file_manifest("skill-1", "baseline", "fingerprint-1", &second)
            .expect("second manifest should replace");

        let stored = store
            .list_file_manifest("skill-1", "baseline", "fingerprint-1")
            .expect("manifest should list");

        assert_eq!(stored, second);
    }

    #[test]
    fn insert_and_get_backup_by_id() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let skill = sample_skill("skill-1", "Example Skill", Some("First description"));
        let backup = sample_backup("backup-1", "skill-1", "manual");
        store.upsert_skill(&skill).expect("skill should upsert");

        store.insert_backup(&backup).expect("backup should insert");

        let stored = store
            .get_backup("backup-1")
            .expect("backup lookup should succeed")
            .expect("backup should exist");

        assert_eq!(stored, backup);
    }

    #[test]
    fn list_backups_returns_records_for_skill_newest_first() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let skill = sample_skill("skill-1", "Example Skill", Some("First description"));
        let older = sample_backup("backup-older", "skill-1", "manual");
        let mut newer = sample_backup("backup-newer", "skill-1", "pre-update");
        newer.created_at = Some("2026-06-19T13:00:00Z".to_string());
        store.upsert_skill(&skill).expect("skill should upsert");
        store
            .insert_backup(&older)
            .expect("older backup should insert");
        store
            .insert_backup(&newer)
            .expect("newer backup should insert");

        let backups = store
            .list_backups("skill-1")
            .expect("backup list should succeed");

        assert_eq!(backups, vec![newer, older]);
    }

    #[test]
    fn mark_backup_restored_updates_restore_status() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let skill = sample_skill("skill-1", "Example Skill", Some("First description"));
        let backup = sample_backup("backup-1", "skill-1", "manual");
        store.upsert_skill(&skill).expect("skill should upsert");
        store.insert_backup(&backup).expect("backup should insert");

        store
            .mark_backup_restored("backup-1", "restored")
            .expect("backup restore status should update");

        let stored = store
            .get_backup("backup-1")
            .expect("backup lookup should succeed")
            .expect("backup should exist");
        assert_eq!(stored.restore_status.as_deref(), Some("restored"));
    }

    #[test]
    fn delete_backup_removes_record() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let skill = sample_skill("skill-1", "Example Skill", Some("First description"));
        let backup = sample_backup("backup-1", "skill-1", "manual");
        store.upsert_skill(&skill).expect("skill should upsert");
        store.insert_backup(&backup).expect("backup should insert");

        store
            .delete_backup("backup-1")
            .expect("backup record should delete");

        let stored = store
            .get_backup("backup-1")
            .expect("backup lookup should succeed");
        assert_eq!(stored, None);
    }

    #[test]
    fn update_skill_local_fingerprint_sets_baseline_fingerprint_and_modified_flag() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let skill = sample_skill("skill-1", "Example Skill", Some("First description"));
        store.upsert_skill(&skill).expect("skill should upsert");

        store
            .update_skill_local_fingerprint("skill-1", "sha256:abc", false)
            .expect("local fingerprint should update");

        let stored = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");

        assert_eq!(stored.local_fingerprint.as_deref(), Some("sha256:abc"));
        assert_eq!(stored.local_modified, Some(false));
    }

    #[test]
    fn update_skill_local_modified_does_not_replace_baseline_fingerprint() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let skill = sample_skill("skill-1", "Example Skill", Some("First description"));
        store.upsert_skill(&skill).expect("skill should upsert");
        store
            .update_skill_local_fingerprint("skill-1", "sha256:baseline", false)
            .expect("local fingerprint should update");

        store
            .update_skill_local_modified("skill-1", true)
            .expect("local modified should update");

        let stored = store
            .get_skill("skill-1")
            .expect("skill lookup should succeed")
            .expect("skill should exist");

        assert_eq!(stored.local_fingerprint.as_deref(), Some("sha256:baseline"));
        assert_eq!(stored.local_modified, Some(true));
    }

    #[test]
    fn update_source_check_result_sets_commits_and_preserves_config_fields() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let source = sample_source("source-1", true, false);
        store.upsert_source(&source).expect("source should upsert");

        store
            .update_source_check_result(
                "source-1",
                Some("abc123"),
                Some("def456"),
                "2026-06-19T12:00:00Z",
            )
            .expect("source check result should update");

        let stored = store
            .get_source("source-1")
            .expect("source lookup should succeed")
            .expect("source should exist");

        assert_eq!(stored.current_commit.as_deref(), Some("abc123"));
        assert_eq!(stored.remote_commit.as_deref(), Some("def456"));
        assert_eq!(
            stored.last_checked_at.as_deref(),
            Some("2026-06-19T12:00:00Z")
        );
        assert!(stored.trusted);
        assert!(!stored.auto_update);
        assert_eq!(stored.credential_ref.as_deref(), Some("github-main"));
    }

    #[test]
    fn insert_and_list_audit_events_with_filters_and_pagination() {
        let store = SkillIndexStore::open_in_memory().expect("store should open");
        let skill = sample_skill("skill-1", "Example Skill", Some("First description"));
        let mut other_skill = sample_skill("skill-2", "Other Skill", Some("Other description"));
        other_skill.install_path = "/tmp/metis/skills/other".to_string();
        store.upsert_skill(&skill).expect("skill should upsert");
        store
            .upsert_skill(&other_skill)
            .expect("other skill should upsert");
        store
            .insert_audit_event(&sample_audit(
                "audit-1",
                "skill-1",
                "source_bound",
                "success",
            ))
            .expect("first audit should insert");
        store
            .insert_audit_event(&sample_audit(
                "audit-2",
                "skill-1",
                "update_checked",
                "success",
            ))
            .expect("second audit should insert");
        store
            .insert_audit_event(&sample_audit(
                "audit-3",
                "skill-2",
                "source_bound",
                "success",
            ))
            .expect("third audit should insert");

        let filtered = store
            .list_audit_events(&AuditEventFilter {
                skill_id: Some("skill-1".to_string()),
                action: Some("source_bound".to_string()),
                limit: 10,
                offset: 0,
            })
            .expect("audit events should list");

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "audit-1");
        assert_eq!(filtered[0].detail.as_deref(), Some("source_bound detail"));
        assert_eq!(filtered[0].risk_summary.as_deref(), Some(r#"{"high":0}"#));

        let paged = store
            .list_audit_events(&AuditEventFilter {
                skill_id: Some("skill-1".to_string()),
                action: None,
                limit: 1,
                offset: 1,
            })
            .expect("paged audit events should list");
        assert_eq!(paged.len(), 1);
        assert_eq!(paged[0].id, "audit-1");
    }
}
