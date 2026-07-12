CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,        -- "wallet:<addr>" or "ip:<addr>"
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
