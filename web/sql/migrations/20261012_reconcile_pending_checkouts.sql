ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS checkout_abandoned_at timestamptz;

CREATE INDEX IF NOT EXISTS company_os_bundle_subscriptions_pending_checkout_idx
  ON company_os_bundle_subscriptions(updated_at)
  WHERE subscription_state = 'checkout_pending' AND provider_checkout_id IS NOT NULL;
