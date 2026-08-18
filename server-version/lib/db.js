// Persistence layer using Node's built-in node:sqlite (no external dependency).
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'experiment.db');

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS studies (
    id TEXT PRIMARY KEY,
    name TEXT,
    fake_ingroup_count INTEGER,
    fake_outgroup_count INTEGER,
    math_duration_sec INTEGER,
    difficulty TEXT,
    outcome_bias TEXT DEFAULT 'random',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    study_id TEXT,
    label INTEGER,
    group_label TEXT,
    roster_json TEXT,
    correct_count INTEGER DEFAULT 0,
    phase TEXT DEFAULT 'intro',
    game_start_at TEXT,
    game_end_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS math_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    problem TEXT,
    given_answer TEXT,
    correct INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    target_id TEXT,
    target_label TEXT,
    phase TEXT,
    tokens TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS survey_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    phase TEXT,
    identification INTEGER,
    ingroup_feeling INTEGER,
    outgroup_feeling INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_runs_study ON runs(study_id);
  CREATE INDEX IF NOT EXISTS idx_math_run ON math_events(run_id);
  CREATE INDEX IF NOT EXISTS idx_alloc_run ON allocations(run_id);
  CREATE INDEX IF NOT EXISTS idx_survey_run ON survey_responses(run_id);
`);

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}
function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}
function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

module.exports = { db, run, get, all, DB_PATH };
