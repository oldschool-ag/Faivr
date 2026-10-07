-- Default private. Applying this migration never publishes an existing entry.
ALTER TABLE company_os_function_bundles ADD COLUMN IF NOT EXISTS public_listing boolean NOT NULL DEFAULT false;
ALTER TABLE company_os_packages ADD COLUMN IF NOT EXISTS public_listing boolean NOT NULL DEFAULT false;
