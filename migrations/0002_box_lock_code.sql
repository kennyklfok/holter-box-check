CREATE TABLE IF NOT EXISTS box_lock_code (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  iv_hex TEXT NOT NULL,
  ciphertext_hex TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
