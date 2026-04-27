-- Track when each user was last active (for online presence badge)
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Index for fast lookup of recently active users
CREATE INDEX IF NOT EXISTS idx_user_profiles_last_seen
  ON user_profiles (clinic_id, last_seen_at DESC)
  WHERE deleted_at IS NULL;
