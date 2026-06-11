-- Spec 02: Nonce replay protection
-- Each nonce is single-use; entries retained 10 minutes then purged

CREATE TABLE nonce_log (
  nonce TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_nonce_log_created_at ON nonce_log(created_at);
