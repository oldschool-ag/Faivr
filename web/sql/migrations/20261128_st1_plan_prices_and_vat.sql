-- allow-destructive: ST1 plan corrections of 26 Nov 2026 (CEO): price steps by customer number replace the early-bird box limit, so the early-bird columns from 20261127 (same unmerged change, no production rows) are removed and the plan audit check is widened.
--
-- Prices stay data: a plan's monthly price by customer number (customers 1 to 50 one price, from
-- customer 51 another; a box keeps the price it got), the Swiss VAT rate by the day it applies
-- from, and an administrator's mark on a box that never counts as a paying customer (a test box,
-- Old School's own box).
CREATE TABLE IF NOT EXISTS company_os_plan_prices (
  plan_id text NOT NULL REFERENCES company_os_plans(id),
  from_customer integer NOT NULL CHECK (from_customer >= 1),
  monthly_price_cents integer NOT NULL CHECK (monthly_price_cents >= 0),
  PRIMARY KEY (plan_id, from_customer)
);

CREATE TABLE IF NOT EXISTS company_os_vat_rates (
  effective_from date PRIMARY KEY,
  rate_basis_points integer NOT NULL CHECK (rate_basis_points >= 0 AND rate_basis_points <= 10000),
  set_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_os_box_marks (
  tenant_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  mark text NOT NULL CHECK (mark IN ('test', 'old_school')),
  note text,
  set_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, instance_id)
);

ALTER TABLE company_os_box_plans
  ADD COLUMN IF NOT EXISTS customer_number integer CHECK (customer_number IS NULL OR customer_number > 0);

ALTER TABLE company_os_box_plans DROP COLUMN IF EXISTS early_bird;

ALTER TABLE company_os_plans DROP COLUMN IF EXISTS early_bird;

ALTER TABLE company_os_plans DROP COLUMN IF EXISTS box_limit;

ALTER TABLE company_os_plans DROP COLUMN IF EXISTS monthly_price_cents;

ALTER TABLE company_os_plan_audit DROP CONSTRAINT IF EXISTS company_os_plan_audit_action_check;

ALTER TABLE company_os_plan_audit
  ADD CONSTRAINT company_os_plan_audit_action_check
  CHECK (action IN ('plan_defined', 'plan_function_changed', 'plan_assigned', 'plan_ended', 'invoice_line_added', 'vat_rate_set', 'box_marked'));
