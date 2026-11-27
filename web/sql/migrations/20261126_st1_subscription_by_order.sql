-- ST1: a subscription by order. Old School grants a box a function by invoice (billing_provider
-- 'invoice'); no billing provider is asked. An administrator can also end a subscription with a
-- grace period without the provider (invoice and sandbox subscriptions). Every grant and end
-- writes an audit line that names the administrator.
ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS billing_starts_at timestamptz;

ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS billing_ends_at timestamptz;

ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS granted_by text;

ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS admin_ended_at timestamptz;

ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS admin_ended_by text;

-- the sweep that starts and ends subscriptions on their dates reads only these rows
CREATE INDEX IF NOT EXISTS company_os_bundle_subscriptions_order_dates_idx
  ON company_os_bundle_subscriptions(subscription_state)
  WHERE billing_provider = 'invoice' OR admin_ended_at IS NOT NULL;

-- a function Old School sells only by order: listed, never checked out at the provider
ALTER TABLE company_os_function_bundles
  ADD COLUMN IF NOT EXISTS sold_by_order boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS company_os_subscription_audit (
  id uuid PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES company_os_bundle_subscriptions(id),
  action text NOT NULL CHECK (action IN ('granted_by_order','ended_by_admin','ended')),
  administrator text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_os_subscription_audit_subscription_idx
  ON company_os_subscription_audit(subscription_id, created_at);
