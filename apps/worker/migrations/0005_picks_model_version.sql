-- Which model version produced each logged pick, so History can tell old picks from new ones.
-- Rows logged before this column existed stay NULL (they came from poisson-v1 or the first poisson-dc-v2 builds).
ALTER TABLE picks_log ADD COLUMN model_version TEXT;
