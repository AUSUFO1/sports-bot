-- Tracker columns. odds_taken stays NOT NULL from 0001, so 0 means "no odds were known when the pick was logged".
ALTER TABLE picks_log ADD COLUMN league_id TEXT;
ALTER TABLE picks_log ADD COLUMN kickoff_utc TEXT;
ALTER TABLE picks_log ADD COLUMN kind TEXT;
ALTER TABLE picks_log ADD COLUMN confidence TEXT;
ALTER TABLE picks_log ADD COLUMN ev REAL;
ALTER TABLE picks_log ADD COLUMN pred_score TEXT;
ALTER TABLE picks_log ADD COLUMN final_score TEXT;
ALTER TABLE picks_log ADD COLUMN settled_at TEXT;
-- A pick is logged once and never rewritten, so history cannot be changed with hindsight.
CREATE UNIQUE INDEX idx_picks_unique ON picks_log(match_id, market, selection);
CREATE INDEX idx_picks_kickoff ON picks_log(kickoff_utc);
