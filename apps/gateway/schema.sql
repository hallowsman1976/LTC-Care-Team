CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  session_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS security_events (
  event_id TEXT PRIMARY KEY,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_security (
  user_id TEXT PRIMARY KEY,
  totp_secret_ciphertext TEXT NOT NULL,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  recovery_codes_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

