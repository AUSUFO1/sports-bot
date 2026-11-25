-- Malin's picks of the day: chosen once each morning, locked, and settled on their own record.
CREATE TABLE IF NOT EXISTS daily_picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,            -- local day (WAT, UTC+1), YYYY-MM-DD
  rank INTEGER NOT NULL,        -- 1 = strongest
  match_id TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  prob REAL NOT NULL,           -- final probability when chosen
  our_prob REAL,                -- our own model's probability when chosen
  best_odds REAL NOT NULL,      -- best price on offer when chosen
  kickoff_utc TEXT NOT NULL,
  model_version TEXT,
  created_at TEXT NOT NULL,
  result TEXT,                  -- win | loss | void, NULL while waiting
  final_score TEXT,
  settled_at TEXT,
  UNIQUE (day, match_id)
);
CREATE INDEX IF NOT EXISTS idx_daily_day ON daily_picks(day);
CREATE INDEX IF NOT EXISTS idx_daily_open ON daily_picks(result, match_id);
