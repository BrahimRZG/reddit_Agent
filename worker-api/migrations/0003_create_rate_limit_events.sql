-- Spec 02: Per-install rate limiting events
-- Sliding window: 60 allowed requests per 60 seconds per install_id

CREATE TABLE rate_limit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  install_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL
);

CREATE INDEX idx_rate_limit_composite ON rate_limit_events(install_id, endpoint, timestamp);
