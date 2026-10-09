-- Apply this migration before deploying the F7 API, then verify with:
-- SELECT column_name FROM information_schema.columns WHERE table_name='company_os_package_versions' AND column_name='release_notes';
-- The deployment is not ready until that read-only verification returns release_notes.
ALTER TABLE company_os_package_versions
  ADD COLUMN IF NOT EXISTS release_notes text CHECK(release_notes IS NULL OR char_length(release_notes) <= 1000);
