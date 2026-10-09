ALTER TABLE company_os_package_versions
  ADD COLUMN IF NOT EXISTS release_notes text CHECK(release_notes IS NULL OR char_length(release_notes) <= 1000);
