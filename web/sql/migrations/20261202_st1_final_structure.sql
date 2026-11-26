-- allow-destructive: CEO final price structure of 26 Nov 2026: a box price with an early-bird discount on the first workflow replaces the box price steps (company_os_plan_prices) and the AI credits line (ai_credits_cents, ai_allowance_usd_cents, price_note), all created on this same unmerged change, no production rows.
--
-- Per box and month, plus VAT: the box (optional: a customer on own hardware has no box line),
-- each workflow at its list price with its USD AI allowance (allowances add up per box), each
-- single agent at its list price with no allowance, and for early-bird customers a discount on
-- the first workflow, kept for as long as the customer stays. Every value is data.

-- a function bundle is a workflow (with the AI allowance it includes) or a single agent (none)
ALTER TABLE company_os_function_bundles
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'workflow' CHECK (kind IN ('workflow', 'agent'));

ALTER TABLE company_os_function_bundles
  ADD COLUMN IF NOT EXISTS ai_allowance_usd_cents integer NOT NULL DEFAULT 0 CHECK (ai_allowance_usd_cents >= 0);

-- the plan: the box price, the early bird (how many customers, the discount on the first workflow, its note), the top-up rate
ALTER TABLE company_os_plans
  ADD COLUMN IF NOT EXISTS box_price_cents integer NOT NULL DEFAULT 0 CHECK (box_price_cents >= 0);

ALTER TABLE company_os_plans
  ADD COLUMN IF NOT EXISTS early_bird_customers integer NOT NULL DEFAULT 0 CHECK (early_bird_customers >= 0);

ALTER TABLE company_os_plans
  ADD COLUMN IF NOT EXISTS early_bird_discount_bp integer NOT NULL DEFAULT 0 CHECK (early_bird_discount_bp >= 0 AND early_bird_discount_bp <= 10000);

ALTER TABLE company_os_plans
  ADD COLUMN IF NOT EXISTS early_bird_note text;

ALTER TABLE company_os_plans
  ADD COLUMN IF NOT EXISTS top_up_usd_cents_per_chf integer NOT NULL DEFAULT 0 CHECK (top_up_usd_cents_per_chf >= 0);

-- a box's plan keeps what it was given: own hardware (no box line), its early-bird discount, its top-up rate
ALTER TABLE company_os_box_plans
  ADD COLUMN IF NOT EXISTS own_hardware boolean NOT NULL DEFAULT false;

ALTER TABLE company_os_box_plans
  ADD COLUMN IF NOT EXISTS early_bird_discount_bp integer NOT NULL DEFAULT 0 CHECK (early_bird_discount_bp >= 0 AND early_bird_discount_bp <= 10000);

ALTER TABLE company_os_box_plans
  ADD COLUMN IF NOT EXISTS early_bird_note text;

ALTER TABLE company_os_box_plans
  ADD COLUMN IF NOT EXISTS top_up_usd_cents_per_chf integer NOT NULL DEFAULT 0 CHECK (top_up_usd_cents_per_chf >= 0);

-- a subscription keeps its kind and the AI allowance it was granted with, like its price and currency
ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS invoice_kind text CHECK (invoice_kind IS NULL OR invoice_kind IN ('workflow', 'agent'));

ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS invoice_allowance_usd_cents integer CHECK (invoice_allowance_usd_cents IS NULL OR invoice_allowance_usd_cents >= 0);

ALTER TABLE company_os_plans DROP COLUMN IF EXISTS ai_credits_cents;

ALTER TABLE company_os_plans DROP COLUMN IF EXISTS ai_allowance_usd_cents;

ALTER TABLE company_os_box_plans DROP COLUMN IF EXISTS ai_credits_cents;

ALTER TABLE company_os_box_plans DROP COLUMN IF EXISTS ai_allowance_usd_cents;

ALTER TABLE company_os_box_plans DROP COLUMN IF EXISTS price_note;

DROP TABLE IF EXISTS company_os_plan_prices;
