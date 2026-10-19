ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS copy_number integer NOT NULL DEFAULT 1 CHECK(copy_number > 0);

ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS requested_installation_id uuid;

ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS billing_description text;

UPDATE company_os_bundle_subscriptions AS subscription
SET billing_description = bundle.name
FROM company_os_function_bundles AS bundle
WHERE subscription.bundle_id = bundle.id
  AND subscription.billing_description IS NULL;

ALTER TABLE company_os_bundle_subscriptions
  ALTER COLUMN billing_description SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS company_os_bundle_subscriptions_live_copy_idx
  ON company_os_bundle_subscriptions(tenant_id,instance_id,bundle_id,copy_number)
  WHERE subscription_state <> 'cancelled';

CREATE UNIQUE INDEX IF NOT EXISTS company_os_bundle_subscriptions_live_installation_idx
  ON company_os_bundle_subscriptions(tenant_id,instance_id,bundle_id,requested_installation_id)
  WHERE requested_installation_id IS NOT NULL AND subscription_state <> 'cancelled';
