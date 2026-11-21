CREATE TABLE leagues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_ids TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES leagues(id),
  name TEXT NOT NULL,
  aliases TEXT
);
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES leagues(id),
  season TEXT NOT NULL,
  kickoff_utc TEXT NOT NULL,
  home_team_id TEXT NOT NULL REFERENCES teams(id),
  away_team_id TEXT NOT NULL REFERENCES teams(id),
  status TEXT NOT NULL,
  home_goals INTEGER,
  away_goals INTEGER,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE INDEX idx_matches_kickoff ON matches(kickoff_utc);
CREATE TABLE odds_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL REFERENCES matches(id),
  bookmaker TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  decimal_odds REAL NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE TABLE reports (
  match_id TEXT PRIMARY KEY REFERENCES matches(id),
  report_json TEXT NOT NULL,
  model_version TEXT NOT NULL,
  data_freshness TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE ai_analyses (
  match_id TEXT NOT NULL,
  report_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (match_id, report_hash)
);
CREATE TABLE picks_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  model_prob REAL NOT NULL,
  odds_taken REAL NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL
);
