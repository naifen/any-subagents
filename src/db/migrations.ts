import { copyFileSync, existsSync } from "node:fs";
import type Database from "better-sqlite3";

export const CURRENT_SCHEMA_VERSION = 4;

export const backupDatabase = (dbPath: string): string => {
  const backupPath = `${dbPath}.backup-${Date.now()}`;
  if (existsSync(dbPath)) {
    copyFileSync(dbPath, backupPath);
  }
  return backupPath;
};

export const runMigrations = (db: Database.Database, dbPath: string): void => {
  let version = db.pragma("user_version", { simple: true }) as number;
  const pending = CURRENT_SCHEMA_VERSION - version;
  if (pending > 0 && existsSync(dbPath)) {
    backupDatabase(dbPath);
  }

  while (version < CURRENT_SCHEMA_VERSION) {
    const next = version + 1;
    applyMigration(db, next);
    db.pragma(`user_version = ${next}`);
    version = next;
  }
};

const applyMigration = (db: Database.Database, version: number): void => {
  switch (version) {
    case 1:
      db.exec(`
        create table if not exists sessions (
          session_id text primary key,
          repo text not null,
          base_ref text not null,
          status text not null,
          brief_json text not null,
          brief_revision integer not null,
          created_at text not null,
          updated_at text not null,
          metadata_json text not null
        );

        create table if not exists task_groups (
          group_id text primary key,
          session_id text not null references sessions(session_id) on delete cascade,
          title text not null,
          status text not null,
          expected_brief_revision integer not null,
          created_at text not null,
          updated_at text not null
        );

        create table if not exists tasks (
          task_id text primary key,
          session_id text not null references sessions(session_id) on delete cascade,
          group_id text not null references task_groups(group_id) on delete cascade,
          status text not null,
          mode text not null,
          goal text not null,
          adapter text not null,
          profile text not null,
          envelope_json text not null,
          latest_attempt_id text,
          attempt_count integer not null,
          created_at text not null,
          updated_at text not null
        );

        create table if not exists attempts (
          attempt_id text primary key,
          task_id text not null references tasks(task_id) on delete cascade,
          attempt_number integer not null,
          status text not null,
          worktree_path text,
          log_path text,
          result_path text,
          result_json text,
          error text,
          created_at text not null,
          updated_at text not null,
          started_at text,
          finished_at text
        );

        create table if not exists artifacts (
          artifact_id text primary key,
          session_id text,
          group_id text,
          task_id text,
          attempt_id text,
          type text not null,
          mime_type text not null,
          summary text not null,
          created_at text not null,
          resource_uri text not null unique,
          size_bytes integer,
          hash text,
          preview text,
          path text,
          metadata_json text not null
        );

        create table if not exists events (
          event_id text primary key,
          type text not null,
          created_at text not null,
          session_id text,
          group_id text,
          task_id text,
          attempt_id text,
          artifact_id text,
          severity text,
          message text,
          data_json text
        );
      `);
      break;
    case 2:
      db.exec(`
        create table if not exists metrics (
          metric_id text primary key,
          name text not null,
          value real not null,
          unit text,
          created_at text not null,
          session_id text,
          group_id text,
          task_id text,
          attempt_id text,
          labels_json text not null
        );
        create index if not exists metrics_name_created_at on metrics(name, created_at);
      `);
      break;
    case 3: {
      const existing = new Set(
        (db.prepare("PRAGMA table_info(attempts)").all() as Array<{ name: string }>).map((row) => row.name)
      );
      for (const column of [
        "requested_model text",
        "effective_model text",
        "requested_reasoning_level text",
        "effective_reasoning_level text",
        "requested_permissions_json text",
        "effective_permissions_json text",
        "requested_sandbox_json text",
        "effective_sandbox_json text",
        "network_policy text",
        "package_install_policy text"
      ]) {
        const name = column.split(" ")[0]!;
        if (!existing.has(name)) {
          db.exec(`alter table attempts add column ${column}`);
        }
      }
      break;
    }
    case 4: {
      const existing = new Set(
        (db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>).map((row) => row.name)
      );
      if (!existing.has("priority")) {
        db.exec("alter table sessions add column priority integer");
      }
      break;
    }
    default: {
      throw new Error(`Unknown migration version: ${String(version)}`);
    }
  }
};
