-- Import into a new batch, validate it, then switch the single active pointer.
CREATE TABLE price_batches (
  id TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL,
  quote_count INTEGER NOT NULL CHECK (quote_count > 0)
);
CREATE TABLE active_price_batch (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  batch_id TEXT NOT NULL REFERENCES price_batches(id)
);
CREATE TABLE price_quotes (
  batch_id TEXT NOT NULL REFERENCES price_batches(id) ON DELETE CASCADE,
  lookup_key TEXT NOT NULL,
  source TEXT NOT NULL,
  currency TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  PRIMARY KEY (batch_id, lookup_key, source, currency)
);
