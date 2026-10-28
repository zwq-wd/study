-- 0001_init.sql —— 见开发文档 §8.2
-- 版本只增不改：要改 schema 请新建 0002_*.sql 并把 Rust 侧 version 升到 2。

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE words (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  headword            TEXT    NOT NULL,           -- 展示形式，保留输入的大小写
  norm                TEXT    NOT NULL UNIQUE,    -- 归一化键
  phonetic            TEXT,
  source              TEXT,                       -- 仅作标签，不参与调度
  note                TEXT,
  example_json        TEXT,

  status              TEXT    NOT NULL DEFAULT 'learning',  -- learning|graduated|suspended

  fsrs_state          INTEGER NOT NULL DEFAULT 0,
  fsrs_due            INTEGER,
  fsrs_due_day        TEXT,
  fsrs_stability      REAL    NOT NULL DEFAULT 0,
  fsrs_difficulty     REAL    NOT NULL DEFAULT 0,
  fsrs_reps           INTEGER NOT NULL DEFAULT 0,
  fsrs_lapses         INTEGER NOT NULL DEFAULT 0,
  fsrs_scheduled_days INTEGER NOT NULL DEFAULT 0,
  fsrs_last_review    INTEGER,

  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX idx_words_due    ON words(status, fsrs_due_day);
CREATE INDEX idx_words_norm   ON words(norm);
CREATE INDEX idx_words_status ON words(status);

CREATE TABLE senses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id    INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  meaning_cn TEXT    NOT NULL,
  layer      INTEGER NOT NULL DEFAULT 1,        -- 1 = 当初录入  2 = 事后补充
  origin     TEXT    NOT NULL DEFAULT 'manual', -- manual|ai
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_senses_word ON senses(word_id, layer, sort);

CREATE TABLE review_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id          INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  rating           INTEGER NOT NULL,   -- 1 Again / 3 Good
  state_before     INTEGER NOT NULL,
  state_after      INTEGER NOT NULL,
  due_after        INTEGER,
  stability_after  REAL,
  difficulty_after REAL,
  elapsed_days     INTEGER,
  reviewed_at      INTEGER NOT NULL,
  session_id       TEXT
);

CREATE INDEX idx_logs_word ON review_logs(word_id, reviewed_at);
CREATE INDEX idx_logs_time ON review_logs(reviewed_at);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  planned    INTEGER NOT NULL,
  shown      INTEGER NOT NULL DEFAULT 0,
  again      INTEGER NOT NULL DEFAULT 0,
  deferred   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT INTO meta(key, value) VALUES ('schema_version', '1');
