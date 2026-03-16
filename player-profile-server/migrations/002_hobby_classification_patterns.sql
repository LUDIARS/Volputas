-- Migration 002: Hobby Classification Patterns
-- Replace Bartle taxonomy with 3-pattern classification:
--   1. Gamer Pattern (MTG psychographics)
--   2. Mechanics Pattern (Caillois)
--   3. Story Dynamics (Berne life scripts)

-- Add classification_data column to store structured pattern results
ALTER TABLE player_profiles
  ADD COLUMN IF NOT EXISTS classification_data JSONB;

-- Add subtype_data column to store gamer subtype analysis
ALTER TABLE player_profiles
  ADD COLUMN IF NOT EXISTS subtype_data JSONB;

-- Comment on the new structure
COMMENT ON COLUMN player_profiles.classification_data IS
  'Structured classification results: gamer (MTG psychographics), mechanics (Caillois), story (Berne life scripts)';

COMMENT ON COLUMN player_profiles.preference_vector IS
  '12-dimension vector: gamer_timmy, gamer_johnny, gamer_spike, gamer_vorthos, gamer_melvin, mechanics_agon, mechanics_alea, mechanics_ilinx, mechanics_mimicry, story_winner, story_banal, story_loser';
