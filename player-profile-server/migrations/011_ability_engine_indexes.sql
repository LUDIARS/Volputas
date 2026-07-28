-- Migration 010: Supporting indexes for the ability-estimation engine.
-- The abilityEngine (ludellus-tuning-log-design.md §8) scans a user's
-- ludellus.trial_result / ludellus.calibration_result events for one game over a
-- time window; the content-stats calibration (§7.2) scans all trial_result
-- events for a window grouped by item. These composite indexes back both paths.
-- Pure read-path optimisation — no data is created or altered here.

-- Per-user + per-game session lookup (abilityEngine session filter).
CREATE INDEX IF NOT EXISTS idx_play_sessions_user_game
  ON play_sessions(user_id, game_id);

-- Windowed scan by event type (abilityEngine window filter + §7.2 global
-- content calibration, which selects trial_result events by type over a window).
CREATE INDEX IF NOT EXISTS idx_play_events_type_occurred
  ON play_events(event_type, occurred_at);
