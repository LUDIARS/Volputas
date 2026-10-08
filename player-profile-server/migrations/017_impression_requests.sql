CREATE TABLE IF NOT EXISTS impression_collection_requests (
  requester TEXT NOT NULL,
  request_id TEXT NOT NULL,
  theme TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'completed', 'cancelled')),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (requester, request_id)
);
CREATE INDEX IF NOT EXISTS impression_collection_requests_queue
  ON impression_collection_requests (status, accepted_at);
