-- allow-destructive: remove only a legacy uniqueness index so multiple bundles may reference the same immutable image blob.
CREATE TABLE IF NOT EXISTS company_os_bundle_image_blobs (
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  media_type text NOT NULL CHECK (media_type = 'image/webp'),
  width integer NOT NULL CHECK (width > 0 AND width <= 256),
  height integer NOT NULL CHECK (height > 0 AND height <= 256),
  byte_length integer NOT NULL CHECK (byte_length > 0 AND byte_length <= 61440),
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(content_sha256)
);

INSERT INTO company_os_bundle_image_blobs(content_sha256, media_type, width, height, byte_length, bytes, created_at)
SELECT content_sha256, media_type, width, height, byte_length, bytes, created_at
FROM company_os_bundle_images
ON CONFLICT (content_sha256) DO NOTHING;

DROP INDEX IF EXISTS company_os_bundle_images_content_sha256_idx;

ALTER TABLE company_os_bundle_images
  ALTER COLUMN media_type DROP NOT NULL,
  ALTER COLUMN width DROP NOT NULL,
  ALTER COLUMN height DROP NOT NULL,
  ALTER COLUMN byte_length DROP NOT NULL,
  ALTER COLUMN bytes DROP NOT NULL;

ALTER TABLE company_os_bundle_images
  ADD CONSTRAINT company_os_bundle_images_content_sha256_fkey
  FOREIGN KEY (content_sha256)
  REFERENCES company_os_bundle_image_blobs(content_sha256);
