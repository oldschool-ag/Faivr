-- ST1 plans (Codex review): a subscription that joins a plan keeps the price it had before, so
-- months before the plan are still invoiced as they were.
ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS pre_plan_monthly_cents integer CHECK (pre_plan_monthly_cents IS NULL OR pre_plan_monthly_cents >= 0);
