-- allow-destructive: relax legacy NOT NULL constraints only; all existing columns and image data are preserved.
-- New writes store bytes and metadata in company_os_bundle_image_blobs.
-- Keep the legacy values for compatibility while allowing reference-only rows.
ALTER TABLE company_os_bundle_images
  ALTER COLUMN media_type DROP NOT NULL,
  ALTER COLUMN width DROP NOT NULL,
  ALTER COLUMN height DROP NOT NULL,
  ALTER COLUMN byte_length DROP NOT NULL,
  ALTER COLUMN bytes DROP NOT NULL;

ALTER TABLE company_os_bundle_images
  ADD CONSTRAINT company_os_bundle_images_blob_fk
  FOREIGN KEY (content_sha256)
  REFERENCES company_os_bundle_image_blobs(content_sha256);
