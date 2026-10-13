CREATE TABLE IF NOT EXISTS company_os_bundle_images (
  bundle_id text PRIMARY KEY REFERENCES company_os_function_bundles(id),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  media_type text NOT NULL CHECK (media_type = 'image/webp'),
  width integer NOT NULL CHECK (width > 0 AND width <= 256),
  height integer NOT NULL CHECK (height > 0 AND height <= 256),
  byte_length integer NOT NULL CHECK (byte_length > 0 AND byte_length <= 61440),
  bytes bytea NOT NULL,
  source text NOT NULL CHECK (source IN ('upload','polar')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_os_bundle_images_content_sha256_idx ON company_os_bundle_images(content_sha256);
