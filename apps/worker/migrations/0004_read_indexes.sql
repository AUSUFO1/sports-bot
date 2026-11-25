-- Indexes to keep D1 row reads inside the free plan (5 million a day).
-- On 2026-11-24 three queries scanned whole tables on every run and went over the limit.

-- Report builder: finished results of one league (was a full scan of matches every run).
CREATE INDEX IF NOT EXISTS idx_matches_league_status ON matches(league_id, status, kickoff_utc);

-- Fixtures job and the leagues page: "does this league have teams with no crest".
CREATE INDEX IF NOT EXISTS idx_teams_league ON teams(league_id, crest);

-- Report builder: latest price per bookmaker, market and selection for one match.
CREATE INDEX IF NOT EXISTS idx_odds_latest ON odds_snapshots(match_id, bookmaker, market, selection, captured_at);

-- Settle job: picks still waiting for a result.
CREATE INDEX IF NOT EXISTS idx_picks_open ON picks_log(result, match_id);
