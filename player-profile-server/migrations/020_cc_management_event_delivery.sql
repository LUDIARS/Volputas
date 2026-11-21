CREATE TABLE IF NOT EXISTS cc_management_event_delivery (
  origin       TEXT NOT NULL CHECK (origin IN ('ai', 'human')),
  source_id    TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('pending', 'delivered', 'refused')),
  http_status  INTEGER,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (origin, source_id)
);
