-- ST1 plans: what Old School invoices per box. A plan (box on loan, setup, updates, safety
-- copies, support, an AI allowance) with the functions it includes at CHF 0; add-on functions at
-- their list price; one-time lines (AI top-ups). Every value is data the CEO enters with the
-- store admin command; nothing is priced in code. A box's plan keeps the terms it was given.
CREATE TABLE IF NOT EXISTS company_os_plans (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL,
  monthly_price_cents integer NOT NULL CHECK (monthly_price_cents >= 0),
  currency text NOT NULL DEFAULT 'chf',
  prices_exclude_vat boolean NOT NULL,
  ai_allowance_cents integer NOT NULL DEFAULT 0 CHECK (ai_allowance_cents >= 0),
  free_months integer NOT NULL DEFAULT 0 CHECK (free_months >= 0 AND free_months <= 24),
  includes jsonb NOT NULL DEFAULT '[]'::jsonb,
  early_bird boolean NOT NULL DEFAULT false,
  box_limit integer CHECK (box_limit IS NULL OR box_limit > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_os_plan_functions (
  plan_id text NOT NULL REFERENCES company_os_plans(id),
  bundle_id text NOT NULL REFERENCES company_os_function_bundles(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, bundle_id)
);

CREATE TABLE IF NOT EXISTS company_os_box_plans (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  plan_id text NOT NULL REFERENCES company_os_plans(id),
  plan_name text NOT NULL,
  monthly_price_cents integer NOT NULL CHECK (monthly_price_cents >= 0),
  currency text NOT NULL,
  prices_exclude_vat boolean NOT NULL,
  ai_allowance_cents integer NOT NULL CHECK (ai_allowance_cents >= 0),
  free_months integer NOT NULL CHECK (free_months >= 0),
  includes jsonb NOT NULL,
  early_bird boolean NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  granted_by text NOT NULL,
  ended_by text,
  end_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_os_box_plans_box_idx
  ON company_os_box_plans(tenant_id, instance_id, created_at);

CREATE INDEX IF NOT EXISTS company_os_box_plans_plan_idx
  ON company_os_box_plans(plan_id);

ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS box_plan_id uuid REFERENCES company_os_box_plans(id);

ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS invoice_monthly_cents integer CHECK (invoice_monthly_cents IS NULL OR invoice_monthly_cents >= 0);

ALTER TABLE company_os_bundle_subscriptions
  ADD COLUMN IF NOT EXISTS included_in_plan boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS company_os_invoice_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  box_plan_id uuid REFERENCES company_os_box_plans(id),
  invoice_month date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ai_top_up', 'ai_use_above_allowance')),
  description text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_os_invoice_items_month_idx
  ON company_os_invoice_items(invoice_month, tenant_id, instance_id);

CREATE TABLE IF NOT EXISTS company_os_plan_audit (
  id uuid PRIMARY KEY,
  plan_id text,
  box_plan_id uuid,
  action text NOT NULL CHECK (action IN ('plan_defined', 'plan_function_changed', 'plan_assigned', 'plan_ended', 'invoice_line_added')),
  administrator text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
