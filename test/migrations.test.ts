import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { Store } from "../src/db/store.js";
import { CURRENT_SCHEMA_VERSION } from "../src/db/migrations.js";
import Database from "better-sqlite3";

let tempDir: string;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("database migrations", () => {
  test("applies forward migrations and records user_version", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "migrations-test-"));
    const dbPath = path.join(tempDir, "state.sqlite3");
    const store = new Store(dbPath);
    store.close();

    const db = new Database(dbPath);
    const version = db.pragma("user_version", { simple: true });
    expect(version).toBe(CURRENT_SCHEMA_VERSION);
    expect(db.prepare("select name from sqlite_master where type='table' and name='metrics'").get()).toBeTruthy();
    db.close();
  });

  test("creates a backup before applying pending migrations", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "migrations-backup-"));
    const dbPath = path.join(tempDir, "state.sqlite3");
    const legacy = new Database(dbPath);
    legacy.exec(`
      create table sessions (session_id text primary key, repo text not null, base_ref text not null, status text not null,
        brief_json text not null, brief_revision integer not null, created_at text not null, updated_at text not null, metadata_json text not null);
      create table task_groups (group_id text primary key, session_id text not null, title text not null, status text not null,
        expected_brief_revision integer not null, created_at text not null, updated_at text not null);
      create table tasks (task_id text primary key, session_id text not null, group_id text not null, status text not null,
        mode text not null, goal text not null, adapter text not null, profile text not null, envelope_json text not null,
        latest_attempt_id text, attempt_count integer not null, created_at text not null, updated_at text not null);
      create table attempts (attempt_id text primary key, task_id text not null, attempt_number integer not null, status text not null,
        worktree_path text, log_path text, result_path text, result_json text, error text, created_at text not null, updated_at text not null,
        started_at text, finished_at text);
      create table artifacts (artifact_id text primary key, session_id text, group_id text, task_id text, attempt_id text, type text not null,
        mime_type text not null, summary text not null, created_at text not null, resource_uri text not null unique, size_bytes integer,
        hash text, preview text, path text, metadata_json text not null);
      create table events (event_id text primary key, type text not null, created_at text not null, session_id text, group_id text,
        task_id text, attempt_id text, artifact_id text, severity text, message text, data_json text);
    `);
    legacy.pragma("user_version = 1");
    legacy.close();

    const store = new Store(dbPath);
    store.close();

    const entries = await import("node:fs/promises").then((fs) => fs.readdir(tempDir));
    expect(entries.some((entry) => entry.includes(".backup-"))).toBe(true);
  });
});
