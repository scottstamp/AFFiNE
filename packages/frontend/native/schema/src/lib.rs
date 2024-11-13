use std::borrow::Cow;

use sqlx::migrate::{Migration, MigrationType, Migrator};

type SimpleMigration = (
  /* name */ &'static str,
  /* up */ &'static str,
  /* down */ Option<&'static str>,
);

// ORDER MATTERS
const MIGRATIONS: &[SimpleMigration] = &[
  // v1 db init
  (
    "init",
    r#"
CREATE TABLE IF NOT EXISTS "updates" (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  data BLOB NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  doc_id TEXT
);
CREATE TABLE IF NOT EXISTS "blobs" (
  key TEXT PRIMARY KEY NOT NULL,
  data BLOB NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS "version_info" (
  version NUMBER NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS "server_clock" (
  key TEXT PRIMARY KEY NOT NULL,
  data BLOB NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS "sync_metadata" (
  key TEXT PRIMARY KEY NOT NULL,
  data BLOB NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_id ON updates(doc_id);
"#,
    None,
  ),
  // v2 db init
  (
    "v2_init",
    r#"
CREATE TABLE "v2_meta" (
  space_id VARCHAR PRIMARY KEY NOT NULL
);

CREATE TABLE "v2_snapshots" (
  doc_id VARCHAR PRIMARY KEY NOT NULL,
  data BLOB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE "v2_updates" (
  doc_id VARCHAR NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (doc_id, created_at)
);

CREATE TABLE "v2_clocks" (
  doc_id VARCHAR PRIMARY KEY NOT NULL,
  timestamp TIMESTAMP NOT NULL
);

CREATE TABLE "v2_blobs" (
  key VARCHAR PRIMARY KEY NOT NULL,
  data BLOB NOT NULL,
  mime VARCHAR NOT NULL,
  size INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  deleted_at TIMESTAMP
);

CREATE TABLE "v2_peer_clocks" (
  peer VARCHAR NOT NULL,
  doc_id VARCHAR NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  pushed_timestamp TIMESTAMP NOT NULL,
  PRIMARY KEY (peer, doc_id)
);
CREATE INDEX v2_peer_clocks_doc_id ON v2_peer_clocks (doc_id);
 "#,
    None,
  ),
];

pub fn get_migrator() -> Migrator {
  let mut migrations = vec![];

  MIGRATIONS.iter().for_each(|&(name, up, down)| {
    migrations.push(Migration::new(
      migrations.len() as i64 + 1,
      Cow::from(name),
      if down.is_some() {
        MigrationType::ReversibleUp
      } else {
        MigrationType::Simple
      },
      Cow::from(up),
      false,
    ));

    if let Some(down) = down {
      migrations.push(Migration::new(
        migrations.len() as i64 + 1,
        Cow::from(name),
        MigrationType::ReversibleDown,
        Cow::from(down),
        false,
      ));
    }
  });

  Migrator {
    migrations: Cow::Owned(migrations),
    ..Migrator::DEFAULT
  }
}
