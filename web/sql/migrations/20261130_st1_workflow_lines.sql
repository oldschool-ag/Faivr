-- allow-destructive: CEO price breakdown of 26 Nov 2026: AI use is a priced line (CHF credits with a USD allowance) instead of an allowance included in the plan price, so ai_allowance_cents (created in 20261127 on this same unmerged change, no production rows) is replaced.
--
-- The invoice sells workflows, not boxes. Per box and month: the Truchsess box line (its price by
-- customer number, with a note such as "Free, early bird"), one line per workflow at its list
-- price, and the AI credits line. Every value is data.
--
-- company_os_box_plans.included_bundles (20261129) now holds the workflows granted with the plan
-- when the box got it; they are billed at their list price.

-- the CHF price of the monthly AI credits, and the AI provider allowance in USD the box enforces
ALTER TABLE company_os_plans
  ADD COLUMN IF NOT EXISTS ai_credits_cents integer NOT NULL DEFAULT 0 CHECK (ai_credits_cents >= 0);

ALTER TABLE company_os_plans
  ADD COLUMN IF NOT EXISTS ai_allowance_usd_cents integer NOT NULL DEFAULT 0 CHECK (ai_allowance_usd_cents >= 0);

ALTER TABLE company_os_box_plans
  ADD COLUMN IF NOT EXISTS ai_credits_cents integer NOT NULL DEFAULT 0 CHECK (ai_credits_cents >= 0);

ALTER TABLE company_os_box_plans
  ADD COLUMN IF NOT EXISTS ai_allowance_usd_cents integer NOT NULL DEFAULT 0 CHECK (ai_allowance_usd_cents >= 0);

-- a price step's note on the invoice ("Free, early bird"), kept by the box with its price
ALTER TABLE company_os_plan_prices
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE company_os_box_plans
  ADD COLUMN IF NOT EXISTS price_note text;

-- the USD allowance a one-time AI top-up adds, at the plan's rate
ALTER TABLE company_os_invoice_items
  ADD COLUMN IF NOT EXISTS allowance_usd_cents integer CHECK (allowance_usd_cents IS NULL OR allowance_usd_cents >= 0);

ALTER TABLE company_os_plans DROP COLUMN IF EXISTS ai_allowance_cents;

ALTER TABLE company_os_box_plans DROP COLUMN IF EXISTS ai_allowance_cents;
