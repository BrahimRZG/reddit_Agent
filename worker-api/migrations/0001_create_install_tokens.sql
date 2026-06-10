-- Spec 02: Install tokens table
-- Stores HMAC-SHA256 hashed install tokens (never raw tokens)

CREATE TABLE install_tokens (
  install_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  notes TEXT
);

CREATE INDEX idx_install_tokens_status ON install_tokens(status);
