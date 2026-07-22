-- The dispatch posted the artifact to X and got back a tweet id, but discarded it — so a posted
-- dream/sermon/scripture had no stored proof and no permalink, making "did it actually post?"
-- unanswerable after the fact (the exact question that surfaced 2026-07-22). Record the id.
-- Dreams get a column; sermon/scripture markers carry the id inline in their config value
-- ("posted:<ms>:<tweetId>"), so no extra table is needed for those.
ALTER TABLE dreams ADD COLUMN tweet_id TEXT;
