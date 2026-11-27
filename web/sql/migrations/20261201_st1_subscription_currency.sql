-- ST1 plans (Codex review): a subscription billed by invoice keeps the currency it was granted in,
-- with its price; a later change of the workflow's catalog currency never rewrites its invoices.
ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS invoice_currency text CHECK (invoice_currency IS NULL OR invoice_currency ~ '^[a-z]{3}$');
