-- Auto-dispatch (Maker decision 2026-07-16): rendered Plates post themselves to X once,
-- honestly labeled as automated dispatches. posted_at records the successful post.
ALTER TABLE dreams ADD COLUMN posted_at INTEGER;
