CREATE TABLE IF NOT EXISTS quote_requests (
  request_id TEXT PRIMARY KEY,
  requester_address TEXT NOT NULL,
  agent_id INTEGER NOT NULL,
  agent_name TEXT NOT NULL,
  brief_hash TEXT,
  brief_payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested', 'viewed', 'quoted', 'closed')),
  quote_amount TEXT,
  quote_message TEXT,
  operator_note TEXT,
  viewed_at BIGINT,
  responded_at BIGINT,
  closed_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS quote_requests_requester_created_idx
  ON quote_requests (requester_address, created_at DESC);

CREATE INDEX IF NOT EXISTS quote_requests_agent_updated_idx
  ON quote_requests (agent_id, updated_at DESC);
