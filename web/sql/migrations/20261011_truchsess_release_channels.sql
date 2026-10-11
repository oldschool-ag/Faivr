CREATE TABLE IF NOT EXISTS company_os_release_channels (
  channel text PRIMARY KEY,
  pinned_tag text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (channel = 'stable')
);
